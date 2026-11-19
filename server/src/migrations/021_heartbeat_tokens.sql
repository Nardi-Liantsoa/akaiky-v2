-- Jeton « signal de vie » du téléphone (NAR-180) : identifiant propre au natif en
-- arrière-plan, distinct de la session d'appareil (que seul l'écran renouvelle).
--
--   child_devices.heartbeat_token_hash  empreinte SHA-256 du jeton (256 bits aléatoires),
--                  comme les autres jetons ; un seul par téléphone, remplacé à chaque
--                  émission (POST /api/device/heartbeat-token, session d'appareil). N'ouvre
--                  que POST /api/device/heartbeat (en-tête « Authorization: Heartbeat … »).
--                  NULL : aucun jeton ; remis à NULL à la révocation du téléphone (qui suffit
--                  déjà : seul un téléphone non révoqué est accepté), au rejeu d'un jeton de
--                  renouvellement (session fermée), et par purge_expired().
--   child_devices.heartbeat_token_expires_at  fin de validité : 30 jours après l'émission.
--                  L'app en redemande un à chaque démarrage : un téléphone utilisé le
--                  renouvelle ; un jeton échu est refusé (401), puis effacé par la purge.
-- Additive : aucune donnée existante touchée.

ALTER TABLE child_devices
  ADD COLUMN heartbeat_token_hash bytea,
  ADD COLUMN heartbeat_token_expires_at timestamptz;
CREATE UNIQUE INDEX child_devices_heartbeat_token ON child_devices(heartbeat_token_hash)
  WHERE heartbeat_token_hash IS NOT NULL;

-- Purge (020_device_status.sql) : tout ce qu'elle faisait, plus l'effacement des jetons
-- « signal de vie » échus ou orphelins.
CREATE OR REPLACE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
  n_push_tokens int; n_push_outbox int; n_alerts int; n_heartbeat int;
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

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens,
    'pushTokens', n_push_tokens, 'pushOutbox', n_push_outbox, 'deviceAlerts', n_alerts,
    'heartbeatTokens', n_heartbeat);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Émission, remplacement et effacement du jeton ; jamais la famille ni l'enfant.
    GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
    GRANT UPDATE (heartbeat_token_hash, heartbeat_token_expires_at) ON child_devices TO app_runtime;
  END IF;
END $$;
