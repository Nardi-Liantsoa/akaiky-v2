-- Appairage du téléphone de l'enfant (NAR-138). Le téléphone n'est pas un compte
-- utilisateur : il reçoit un identifiant d'appareil lié à une famille et à un
-- enfant, révocable, et ses propres sessions, distinctes de celles des comptes.

-- Jeton d'appairage : 256 bits, haché, 15 minutes, usage unique. Porté par le QR.
CREATE TABLE pairing_tokens (
  token_hash  bytea PRIMARY KEY,
  family_id   uuid NOT NULL,
  child_id    uuid NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE
);
CREATE INDEX pairing_tokens_child ON pairing_tokens(child_id);

-- Téléphone appairé. Révoqué : revoked_at posé, ses sessions effacées.
CREATE TABLE child_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL,
  child_id      uuid NOT NULL,
  model         text CHECK (char_length(model) <= 80),
  os_version    text CHECK (char_length(os_version) <= 40),
  app_version   text CHECK (char_length(app_version) <= 40),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE
);
CREATE INDEX child_devices_child ON child_devices(child_id);

-- Sessions d'appareil : même mécanique que les sessions natives des comptes
-- (server/src/native.js : accès court, renouvellement tourné, ancien jeton
-- accepté une fois, rejeu détecté), mais une table à part. Un jeton d'appareil
-- n'est jamais cherché parmi les sessions de compte, et l'inverse.
CREATE TABLE device_sessions (
  token_hash             bytea PRIMARY KEY,
  id                     uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  device_id              uuid NOT NULL REFERENCES child_devices(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  refresh_hash           bytea NOT NULL UNIQUE,
  previous_refresh_hash  bytea,
  discarded_refresh_hash bytea,
  rotated_at             timestamptz,
  refresh_expires_at     timestamptz NOT NULL
);
CREATE INDEX device_sessions_device ON device_sessions(device_id);
CREATE INDEX device_sessions_previous_refresh ON device_sessions(previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;
CREATE INDEX device_sessions_discarded_refresh ON device_sessions(discarded_refresh_hash) WHERE discarded_refresh_hash IS NOT NULL;

ALTER TABLE security_alerts DROP CONSTRAINT security_alerts_kind_check;
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_kind_check
  CHECK (kind IN ('login_attack', 'registrations_quota', 'auth_emails_quota', 'invitation_emails_quota', 'refresh_replay', 'device_refresh_replay'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT ON pairing_tokens, child_devices, device_sessions TO app_runtime;
    GRANT INSERT, DELETE ON pairing_tokens TO app_runtime;
    GRANT UPDATE (used_at) ON pairing_tokens TO app_runtime;
    GRANT INSERT ON child_devices TO app_runtime;
    GRANT UPDATE (last_seen_at, revoked_at, app_version, os_version) ON child_devices TO app_runtime;
    GRANT INSERT, DELETE ON device_sessions TO app_runtime;
    GRANT UPDATE (token_hash, expires_at, last_seen_at, refresh_hash, previous_refresh_hash, discarded_refresh_hash, rotated_at, refresh_expires_at) ON device_sessions TO app_runtime;
  END IF;
END $$;
