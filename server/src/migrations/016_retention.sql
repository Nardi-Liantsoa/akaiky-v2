-- Durées de conservation (NAR-153, CdC §7.1, RGPD). Une seule fonction, propriété du
-- compte des migrations (SECURITY DEFINER), fait toute la purge avec des durées FIXÉES
-- ICI : le rôle applicatif peut seulement la lancer. Il ne reçoit aucun DELETE sur le
-- journal d'audit ni sur le journal du téléphone, qu'il ne peut donc ni vider ni raccourcir.
--
--   journal du téléphone (appels, déverrouillages)  90 jours après sa réception par le serveur
--                                                    (created_at : un envoi tardif n'est pas purgé aussitôt)
--   messages rapides (et leurs « vu par »)           90 jours
--   journal d'audit                                  1 an ; adresse IP effacée à 90 jours
--   sessions (compte et téléphone)                   30 jours après la fin de tout renouvellement
--                                                    (détection du rejeu d'un ancien jeton)
--   jetons, défis, appareils de confiance            dès leur expiration (+ 1 jour)
--   positions (30 jours)                             avec leur table, NAR-146
--
-- Un tour au plus toutes les 20 heures, quel que soit le nombre d'instances : verrou
-- consultatif (l'autre instance repart aussitôt) et date du dernier tour (job_runs).
CREATE TABLE job_runs (
  job         text PRIMARY KEY,
  started_at  timestamptz,
  finished_at timestamptz,
  result      jsonb
);
INSERT INTO job_runs(job) VALUES ('retention');

-- Index des purges : device_events_created (008) couvre déjà device_events(created_at).
CREATE INDEX IF NOT EXISTS device_events_created ON device_events(created_at);
CREATE INDEX IF NOT EXISTS quick_messages_created ON quick_messages(created_at);

CREATE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
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

  -- Sessions mortes : celle d'un navigateur à son expiration, celle d'une app à la fin de
  -- son renouvellement possible ; celles des téléphones d'enfant de même. Gardées 30 jours
  -- de plus : le rejeu d'un ancien jeton de renouvellement reste détecté.
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

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
  END IF;
END $$;
