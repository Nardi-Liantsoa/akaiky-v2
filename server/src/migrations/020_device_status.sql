-- État du téléphone de l'enfant (NAR-147) : batterie, réseau, carte SIM, et alertes.
--
--   child_devices  derniers relevés envoyés par le téléphone (POST /api/device/heartbeat).
--                  `status_at` : heure du dernier signal de vie ; NULL tant que le téléphone
--                  n'en a jamais envoyé (aucune alerte « silence » pour lui). À distinguer de
--                  `last_seen_at` (007), dernière requête quelconque du téléphone.
--                  `network` 'unknown' : relevé natif indisponible (app au premier plan).
--   device_alerts  alertes ouvertes puis fermées : batterie faible, carte SIM absente,
--                  téléphone silencieux. Une seule ouverte par téléphone et par type (index
--                  unique partiel) : la famille n'est prévenue qu'une fois. Fermées depuis
--                  90 jours : purgées (purge_expired()).

ALTER TABLE child_devices
  ADD COLUMN battery_pct smallint CHECK (battery_pct BETWEEN 0 AND 100),
  ADD COLUMN charging    boolean,
  ADD COLUMN network     text CHECK (network IN ('wifi', 'mobile', 'none', 'unknown')),
  ADD COLUMN sim_state   text CHECK (sim_state IN ('ready', 'absent', 'locked', 'unknown')),
  ADD COLUMN status_at   timestamptz,
  -- Vrai quand le signal vient de la surveillance native en arrière-plan (NAR-180) ; seuls
  -- ces téléphones peuvent être « silencieux » (l'app au premier plan seule s'arrête
  -- normalement quand l'enfant la quitte : pas de fausse alerte).
  ADD COLUMN background_status boolean NOT NULL DEFAULT false;
-- Tâche « silence » (jobs.js) : téléphones actifs, surveillés en arrière-plan, dont le
-- dernier signal est ancien.
CREATE INDEX child_devices_status_at ON child_devices(status_at)
  WHERE revoked_at IS NULL AND status_at IS NOT NULL AND background_status;

CREATE TABLE device_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL,
  child_id   uuid NOT NULL,
  device_id  uuid NOT NULL REFERENCES child_devices(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('battery_low', 'sim_absent', 'silent')),
  opened_at  timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz,
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE,
  CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
CREATE UNIQUE INDEX device_alerts_open ON device_alerts(device_id, kind) WHERE closed_at IS NULL;
CREATE INDEX device_alerts_child ON device_alerts(child_id) WHERE closed_at IS NULL;
CREATE INDEX device_alerts_closed ON device_alerts(closed_at) WHERE closed_at IS NOT NULL;

-- File push : trois événements de plus (liste fermée, push-texts.js).
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_event_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_event_check
  CHECK (event IN ('message', 'test', 'config', 'battery_low', 'sim_absent', 'silent'));

-- Purge (019_push.sql) : tout ce qu'elle faisait, plus les alertes fermées depuis 90 jours.
CREATE OR REPLACE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
  n_push_tokens int; n_push_outbox int; n_alerts int;
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

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens,
    'pushTokens', n_push_tokens, 'pushOutbox', n_push_outbox, 'deviceAlerts', n_alerts);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
    -- Relevés du téléphone : ces colonnes seulement (jamais la famille ni l'enfant).
    GRANT UPDATE (battery_pct, charging, network, sim_state, status_at, background_status) ON child_devices TO app_runtime;
    -- Alertes : ouverture, puis fermeture seule ; aucun DELETE (purge par purge_expired()).
    GRANT SELECT, INSERT ON device_alerts TO app_runtime;
    GRANT UPDATE (closed_at) ON device_alerts TO app_runtime;
  END IF;
END $$;
