-- Connexion par téléphone (NAR-136, CdC §5.1) : un compte a une adresse e-mail OU un numéro
-- (E.164, normalisé par server/src/phone.js), jamais aucun des deux. Le numéro est confirmé
-- par un code SMS de 6 chiffres, comme l'adresse par un lien.
-- Additive : `email` perd seulement son NOT NULL ; la version précédente de l'API n'écrit
-- que des comptes à adresse et ne lit jamais `phone`. En retour arrière, un compte à numéro
-- ne se connecte plus (SESSION_RULE d'alors exige l'adresse confirmée) : fermé, pas ouvert.
ALTER TABLE users
  ADD COLUMN phone text UNIQUE CONSTRAINT users_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD COLUMN phone_verified_at timestamptz,
  ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- Code à usage unique envoyé par SMS : seule son empreinte HMAC-SHA256 (clé dérivée de
-- DATA_ENCRYPTION_KEY, numéro et usage en entrée) est gardée ; un seul code valable par
-- numéro et par usage (le nouveau remplace l'ancien), 5 minutes, 5 essais. Aucune route ne
-- lit ni n'écrit un code de l'extérieur. `reset` : récupération du compte (tranche suivante).
CREATE TABLE phone_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  purpose    text NOT NULL CHECK (purpose IN ('confirm', 'reset')),
  code_hash  bytea NOT NULL,
  attempts   integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone, purpose)
);
CREATE INDEX phone_codes_expires ON phone_codes(expires_at);

-- Envois par numéro, persistés (un SMS coûte de l'argent : survivre au redémarrage et à
-- plusieurs instances) : nombre dans la fenêtre d'une heure et dernier envoi (délai minimal).
-- Compté que le numéro ait un compte ou non : la limite ne révèle rien.
CREATE TABLE phone_send_limits (
  phone             text PRIMARY KEY CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  sends             integer NOT NULL CHECK (sends >= 0),
  window_expires_at timestamptz NOT NULL,
  last_sent_at      timestamptz NOT NULL
);
CREATE INDEX phone_send_limits_window ON phone_send_limits(window_expires_at);

-- Quota global des SMS (security_quotas, nom « sms ») : alerte de supervision à saturation.
ALTER TABLE security_alerts DROP CONSTRAINT security_alerts_kind_check;
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_kind_check
  CHECK (kind IN ('login_attack', 'registrations_quota', 'auth_emails_quota', 'invitation_emails_quota', 'refresh_replay', 'device_refresh_replay', 'sms_quota'));

-- Purge (NAR-153) : reprise de 021 avec les codes SMS échus et les compteurs d'envoi
-- (numéros : donnée personnelle) un jour après leur échéance.
CREATE OR REPLACE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
  n_push_tokens int; n_push_outbox int; n_alerts int; n_heartbeat int; n_phone int;
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

  WITH d AS (DELETE FROM push_tokens WHERE last_seen_at < now() - interval '60 days' RETURNING 1)
    SELECT count(*) INTO n_push_tokens FROM d;
  WITH d AS (DELETE FROM push_outbox WHERE (status IN ('sent', 'failed') OR token_id IS NULL) AND created_at < now() - interval '7 days' RETURNING 1)
    SELECT count(*) INTO n_push_outbox FROM d;

  -- Alertes du téléphone fermées depuis 90 jours (NAR-147) ; une alerte ouverte reste.
  WITH d AS (DELETE FROM device_alerts WHERE closed_at < now() - interval '90 days' RETURNING 1)
    SELECT count(*) INTO n_alerts FROM d;

  -- Jetons « signal de vie » (NAR-180) : échus, ou d'un téléphone qui n'a plus aucune
  -- session d'appareil renouvelable (l'écran ne pourrait plus jamais en émettre un).
  WITH d AS (
    UPDATE child_devices c SET heartbeat_token_hash = NULL, heartbeat_token_expires_at = NULL
     WHERE c.heartbeat_token_hash IS NOT NULL
       AND (c.heartbeat_token_expires_at IS NULL OR c.heartbeat_token_expires_at <= now()
            OR NOT EXISTS (SELECT 1 FROM device_sessions s WHERE s.device_id = c.id AND s.refresh_expires_at > now()))
    RETURNING 1
  ) SELECT count(*) INTO n_heartbeat FROM d;

  -- Codes SMS et compteurs d'envoi par numéro (NAR-136).
  WITH c AS (DELETE FROM phone_codes WHERE expires_at < now() - interval '1 day' RETURNING 1),
       l AS (DELETE FROM phone_send_limits WHERE window_expires_at < now() - interval '1 day' RETURNING 1)
    SELECT (SELECT count(*) FROM c) + (SELECT count(*) FROM l) INTO n_phone;

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens,
    'pushTokens', n_push_tokens, 'pushOutbox', n_push_outbox, 'deviceAlerts', n_alerts,
    'heartbeatTokens', n_heartbeat, 'phoneCodes', n_phone);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Le numéro s'écrit à l'inscription seulement : aucun UPDATE (phone), donc aucun moyen de
    -- déplacer un compte sur le numéro d'un autre. Seule la date de confirmation change.
    GRANT INSERT (phone) ON users TO app_runtime;
    GRANT UPDATE (phone_verified_at) ON users TO app_runtime;
    -- Codes : émis (remplacés sur conflit), essais comptés, consommés ; jamais le numéro ni l'usage.
    GRANT SELECT, INSERT, DELETE ON phone_codes TO app_runtime;
    GRANT UPDATE (code_hash, attempts, expires_at, created_at) ON phone_codes TO app_runtime;
    GRANT SELECT, INSERT ON phone_send_limits TO app_runtime;
    GRANT UPDATE (sends, window_expires_at, last_sent_at) ON phone_send_limits TO app_runtime;
    GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
  END IF;
END $$;
