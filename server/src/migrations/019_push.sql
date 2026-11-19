-- Notifications push (NAR-141, skill ampy-push). Deux tables :
--
--   push_tokens  jeton FCM d'une installation de l'app, rattaché à SA session : session de
--                compte (app parent) ou téléphone de l'enfant (child_devices). Jamais à un
--                compte désigné par le client. Déconnexion, révocation, réinitialisation du
--                mot de passe : la session disparaît, le jeton avec (cascade). Jeton chiffré
--                (AES-256-GCM, données associées `push_tokens:token:<id>`) ; unicité par index
--                aveugle (HMAC) : un jeton qui réapparaît ailleurs change de propriétaire,
--                il n'est jamais dupliqué. Un seul jeton par session ou par téléphone (index
--                uniques partiels). Non vu depuis 60 jours : purgé.
--   push_outbox  file d'envoi : une ligne par jeton et par événement, sans contenu (type
--                d'événement et identifiant de la ressource seulement ; le texte est construit
--                à l'envoi). Tentatives et prochaine tentative en base. Porte son propriétaire
--                (`owner_key` : 'user:<id>' ou 'device:<id>'), écrit à l'ajout : le plafond
--                horaire survit à la déconnexion et au réenregistrement. Jeton supprimé : la
--                ligne reste (token_id à NULL, le worker l'abandonne) et compte toujours.
--                Envoyée ou abandonnée depuis 7 jours : purgée.

-- Clé de la clé étrangère composite (famille, téléphone) : un jeton de téléphone porte la
-- famille de CE téléphone, jamais une autre.
ALTER TABLE child_devices ADD CONSTRAINT child_devices_family_id_id_key UNIQUE (family_id, id);

CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid REFERENCES sessions(id) ON DELETE CASCADE,
  device_id    uuid,
  family_id    uuid,
  platform     text NOT NULL CHECK (platform IN ('android', 'ios')),
  lang         text NOT NULL DEFAULT 'mg' CHECK (lang IN ('mg', 'fr', 'en')),
  token_enc    bytea NOT NULL,
  token_index  bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, device_id) REFERENCES child_devices(family_id, id) ON DELETE CASCADE,
  -- Exactement un propriétaire : une session de compte, ou un téléphone et sa famille.
  CHECK ((session_id IS NOT NULL AND device_id IS NULL AND family_id IS NULL)
      OR (session_id IS NULL AND device_id IS NOT NULL AND family_id IS NOT NULL))
);
-- Un seul jeton par propriétaire : un jeton rafraîchi remplace le précédent (registerToken).
CREATE UNIQUE INDEX push_tokens_session ON push_tokens(session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX push_tokens_device ON push_tokens(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX push_tokens_seen ON push_tokens(last_seen_at);

CREATE TABLE push_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL : jeton supprimé depuis (déconnexion, jeton mort, changement de propriétaire) ; la
  -- ligne reste pour le plafond, le worker ne l'envoie jamais.
  token_id        uuid REFERENCES push_tokens(id) ON DELETE SET NULL,
  owner_key       text NOT NULL CHECK (owner_key ~ '^(user|device):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  kind            text NOT NULL CHECK (kind IN ('notification', 'data')),
  event           text NOT NULL CHECK (event IN ('message', 'test', 'config')),
  ref             uuid,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Code d'erreur du fournisseur (statut HTTP, code FCM) : jamais le jeton ni le contenu.
  last_error      text CHECK (char_length(last_error) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX push_outbox_due ON push_outbox(status, next_attempt_at);
-- Plafond par compte ou par téléphone (30 par heure, compté par owner_key), mise à NULL
-- à la suppression d'un jeton, purge.
CREATE INDEX push_outbox_owner_created ON push_outbox(owner_key, created_at);
CREATE INDEX push_outbox_token ON push_outbox(token_id) WHERE token_id IS NOT NULL;
CREATE INDEX push_outbox_created ON push_outbox(created_at);

-- Purge (016_retention.sql) : tout ce qu'elle faisait, plus les jetons et la file.
CREATE OR REPLACE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
  n_push_tokens int; n_push_outbox int;
  summary jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('akaiky:retention')) THEN RETURN NULL; END IF;
  UPDATE job_runs SET started_at = now()
   WHERE job = 'retention' AND (started_at IS NULL OR started_at < now() - interval '20 hours');
  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH d AS (DELETE FROM device_events WHERE created_at < now() - interval '90 days' RETURNING 1)
    SELECT count(*) INTO n_events FROM d;
  WITH d AS (DELETE FROM quick_messages WHERE created_at < now() - interval '90 days' RETURNING 1)
    SELECT count(*) INTO n_messages FROM d;
  WITH d AS (DELETE FROM audit_log WHERE at < now() - interval '1 year' RETURNING 1)
    SELECT count(*) INTO n_audit FROM d;
  WITH d AS (UPDATE audit_log SET ip = NULL WHERE ip IS NOT NULL AND at < now() - interval '90 days' RETURNING 1)
    SELECT count(*) INTO n_audit_ip FROM d;

  WITH d AS (
    DELETE FROM sessions WHERE COALESCE(refresh_expires_at, expires_at) < now() - interval '30 days' RETURNING 1
  ) SELECT count(*) INTO n_sessions FROM d;
  WITH d AS (DELETE FROM device_sessions WHERE refresh_expires_at < now() - interval '30 days' RETURNING 1)
    SELECT n_sessions + count(*) INTO n_sessions FROM d;

  WITH d AS (
    DELETE FROM user_tokens WHERE expires_at < now() - interval '1 day' RETURNING 1
  ), p AS (
    DELETE FROM pairing_tokens WHERE expires_at < now() - interval '1 day' RETURNING 1
  ), i AS (
    DELETE FROM invitations WHERE expires_at < now() - interval '1 day' RETURNING 1
  ), m AS (
    DELETE FROM mfa_challenges WHERE expires_at < now() - interval '1 day' RETURNING 1
  ), e AS (
    DELETE FROM mfa_enrollment_invites WHERE expires_at < now() - interval '1 day' RETURNING 1
  ), t AS (
    DELETE FROM trusted_devices WHERE expires_at < now() - interval '1 day' RETURNING 1
  ), q AS (
    DELETE FROM security_quotas WHERE expires_at < now() - interval '1 day' RETURNING 1
  ) SELECT (SELECT count(*) FROM d) + (SELECT count(*) FROM p) + (SELECT count(*) FROM i) + (SELECT count(*) FROM m)
         + (SELECT count(*) FROM e) + (SELECT count(*) FROM t) + (SELECT count(*) FROM q) INTO n_tokens;

  -- Jetons push non vus depuis 60 jours (FCM les tient pour inactifs après un mois) ; leur
  -- file reste (token_id à NULL). Puis la file envoyée, abandonnée ou sans jeton depuis 7 jours.
  WITH d AS (DELETE FROM push_tokens WHERE last_seen_at < now() - interval '60 days' RETURNING 1)
    SELECT count(*) INTO n_push_tokens FROM d;
  WITH d AS (DELETE FROM push_outbox WHERE (status IN ('sent', 'failed') OR token_id IS NULL) AND created_at < now() - interval '7 days' RETURNING 1)
    SELECT count(*) INTO n_push_outbox FROM d;

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens,
    'pushTokens', n_push_tokens, 'pushOutbox', n_push_outbox);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
    GRANT SELECT ON push_tokens, push_outbox TO app_runtime;
    -- Jamais le propriétaire d'un jeton (session, téléphone, famille) ni le jeton lui-même :
    -- un changement de propriétaire est une suppression suivie d'un ajout.
    GRANT INSERT, DELETE ON push_tokens TO app_runtime;
    GRANT UPDATE (platform, lang, last_seen_at) ON push_tokens TO app_runtime;
    -- File : ajout, puis état de l'envoi seulement (ni jeton, ni propriétaire, ni événement, ni
    -- ressource). La mise à NULL de token_id est faite par la clé étrangère, pas par l'API.
    GRANT INSERT ON push_outbox TO app_runtime;
    GRANT UPDATE (status, attempts, next_attempt_at, last_error, sent_at) ON push_outbox TO app_runtime;
  END IF;
END $$;
