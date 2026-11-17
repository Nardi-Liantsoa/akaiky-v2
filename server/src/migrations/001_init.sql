-- Schéma initial : comptes, sessions, jetons, MFA, protections, audit.
-- Les identifiants sont des UUID aléatoires : impossibles à deviner ou à énumérer.
-- Chaque migration donne au rôle applicatif restreint (app_runtime, voir
-- ops/runtime-role.sql) les droits de ce qu'elle crée, s'il existe.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  name              text NOT NULL,
  password_hash     text NOT NULL,
  is_admin          boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  failed_logins     integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Une ligne par session, web (cookie) ou application native (Bearer). Les
-- jetons ne sont jamais stockés : seulement leur empreinte SHA-256.
CREATE TABLE sessions (
  token_hash            bytea PRIMARY KEY,
  id                    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                  text NOT NULL DEFAULT 'cookie' CHECK (kind IN ('cookie', 'bearer')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  mfa_verified_at       timestamptz,
  -- Application native : jeton de renouvellement tourné à chaque usage.
  refresh_hash          bytea UNIQUE,
  previous_refresh_hash bytea,
  -- Jeton émis puis écarté par une réutilisation de son prédécesseur : le
  -- présenter plus tard prouve qu'un tiers a renouvelé à la place de l'app.
  discarded_refresh_hash bytea,
  rotated_at            timestamptz,
  refresh_expires_at    timestamptz,
  label                 text,
  CHECK (kind = 'cookie' OR (refresh_hash IS NOT NULL AND refresh_expires_at IS NOT NULL))
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_previous_refresh ON sessions(previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;
CREATE INDEX sessions_discarded_refresh ON sessions(discarded_refresh_hash) WHERE discarded_refresh_hash IS NOT NULL;

-- Jetons à usage unique : confirmation d'email et réinitialisation.
CREATE TABLE user_tokens (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('confirm', 'reset')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_tokens_user ON user_tokens(user_id, purpose);

-- Journal des actions sensibles (connexions, MFA, actions d'administration).
-- Durée de conservation à définir (RGPD) : l'IP n'y reste pas indéfiniment.
CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action   text NOT NULL,
  target   text,
  ip       text,
  details  jsonb
);
CREATE INDEX audit_log_at ON audit_log(at DESC);

-- Compteurs globaux persistants, indépendants du nombre d'adresses IP.
CREATE TABLE security_quotas (
  name       text PRIMARY KEY,
  hits       integer NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Compartiments bornés : traiter aussi les emails inconnus sans créer une table
-- de taille illimitée à partir d'adresses inventées. Collisions conservatrices.
CREATE TABLE login_guards (
  bucket          integer PRIMARY KEY CHECK (bucket BETWEEN 0 AND 65535),
  failures        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Incidents à remonter à la supervision : type seulement, aucune donnée personnelle.
CREATE TABLE security_alerts (
  kind        text PRIMARY KEY CHECK (kind IN ('login_attack', 'registrations_quota', 'auth_emails_quota', 'refresh_replay')),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1
);

CREATE TABLE trusted_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,
  label           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 days',
  failures        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON trusted_devices(user_id);

-- Graine TOTP chiffrée (AES-256-GCM, identifiant du compte en données associées).
-- MFA_ENCRYPTION_KEY se sauvegarde AVEC la base : sans elle, aucun facteur n'est lisible.
CREATE TABLE mfa_factors (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret       text NOT NULL,
  last_counter bigint NOT NULL DEFAULT -1,
  enabled_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mfa_challenges (
  token_hash     bytea PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  attempts       integer NOT NULL DEFAULT 0,
  device_id      uuid REFERENCES trusted_devices(id) ON DELETE CASCADE,
  remember       boolean NOT NULL DEFAULT false,
  pending_secret text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON mfa_challenges(user_id);
CREATE INDEX ON mfa_challenges(expires_at);
CREATE TABLE mfa_recovery_codes (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at   timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
-- Créées par bin/mfa-invite.js (opérateur) : l'application ne peut pas
-- autoriser elle-même une première activation de MFA administrateur.
CREATE TABLE mfa_enrollment_invites (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- Ressource d'exemple (routes/notes.js) : à remplacer par celles du projet.
CREATE TABLE notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_owner ON notes(owner_id, updated_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_runtime;
    GRANT INSERT (email, name, password_hash) ON users TO app_runtime;
    GRANT UPDATE (name, password_hash, email_verified_at, failed_logins, locked_until) ON users TO app_runtime;
    GRANT INSERT, UPDATE, DELETE ON sessions, user_tokens, notes TO app_runtime;
    GRANT INSERT ON audit_log TO app_runtime;
    GRANT INSERT, UPDATE ON security_quotas, login_guards, security_alerts TO app_runtime;
    GRANT INSERT, UPDATE, DELETE ON trusted_devices, mfa_factors, mfa_challenges, mfa_recovery_codes TO app_runtime;
    GRANT UPDATE (used_at) ON mfa_enrollment_invites TO app_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
  END IF;
END $$;
