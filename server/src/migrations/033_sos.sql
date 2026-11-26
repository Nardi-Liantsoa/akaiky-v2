-- SOS en ligne (NAR-248, tranche 1 de NAR-149 ; CdC §4.3, §5.4).
--
--   sos_alerts   une alerte par SOS déclenché sur un téléphone d'enfant (client_id choisi par le
--                téléphone : un renvoi ne crée jamais une seconde alerte). Ouverte 15 minutes
--                (ends_at), sauf annulation par l'enfant dans les 5 s (cancelled_at) ou prise en
--                charge par un membre (handled_by, handled_at, la première gagne). Aucune donnée
--                libre : dates et identifiants seulement. Purgée 90 jours après son début.
--   sos_events   ce que chaque membre a fait : vu, « j'arrive », pris en charge (une ligne par
--                membre et par sorte, la première heure gardée).
--   positions    les relevés envoyés pendant le SOS (source 'sos', sos_id), mêmes chiffrement et
--                purge à 30 jours que les positions à la demande (030).

CREATE TABLE sos_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL,
  child_id     uuid NOT NULL,
  device_id    uuid NOT NULL REFERENCES child_devices(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  cancelled_at timestamptz,
  handled_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at   timestamptz,
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE,
  UNIQUE (device_id, client_id),
  CHECK (ends_at > started_at),
  CHECK (cancelled_at IS NULL OR handled_at IS NULL),
  CHECK (handled_by IS NULL OR handled_at IS NOT NULL)
);
CREATE INDEX sos_alerts_child ON sos_alerts(child_id, started_at DESC);
CREATE INDEX sos_alerts_started ON sos_alerts(started_at);

CREATE TABLE sos_events (
  sos_id  uuid NOT NULL REFERENCES sos_alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    text NOT NULL CHECK (kind IN ('seen', 'coming', 'handled')),
  at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sos_id, user_id, kind)
);

ALTER TABLE positions ADD CONSTRAINT positions_sos_fk FOREIGN KEY (sos_id) REFERENCES sos_alerts(id) ON DELETE CASCADE;
CREATE INDEX positions_sos ON positions(sos_id, recorded_at DESC) WHERE sos_id IS NOT NULL;

-- File push : alerte SOS et son annulation (liste fermée, push-texts.js) ; plafond horaire à
-- part pour les SOS d'un compte ('user:<id>:sos') : des messages ou alertes de batterie n'en
-- privent jamais un parent.
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_event_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_event_check
  CHECK (event IN ('message', 'test', 'config', 'battery_low', 'sim_absent', 'silent', 'locate', 'sos', 'sos_cancelled'));
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_owner_key_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_owner_key_check
  CHECK (owner_key ~ '^(user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:sos)?|device:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:locate)?)$');

-- Purge (NAR-153) : reprise de 030, plus les alertes SOS de plus de 90 jours.
CREATE OR REPLACE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
  n_push_tokens int; n_push_outbox int; n_alerts int; n_heartbeat int; n_phone int;
  n_positions int; n_location_requests int; n_sos int;
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

  -- Positions (NAR-203, C20) : 30 jours après réception, horloge du serveur (celle du
  -- téléphone peut être fausse). Demandes de position échues depuis un jour.
  WITH d AS (DELETE FROM positions WHERE received_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO n_positions FROM d;
  WITH d AS (DELETE FROM location_requests WHERE watch_until < now() - interval '1 day' RETURNING 1)
    SELECT count(*) INTO n_location_requests FROM d;

  -- Alertes SOS (NAR-248) : 90 jours après leur début, comme le journal du téléphone ; leurs
  -- événements suivent (cascade). Leurs positions sont déjà parties à 30 jours.
  WITH d AS (DELETE FROM sos_alerts WHERE started_at < now() - interval '90 days' RETURNING 1)
    SELECT count(*) INTO n_sos FROM d;

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens,
    'pushTokens', n_push_tokens, 'pushOutbox', n_push_outbox, 'deviceAlerts', n_alerts,
    'heartbeatTokens', n_heartbeat, 'phoneCodes', n_phone,
    'positions', n_positions, 'locationRequests', n_location_requests, 'sosAlerts', n_sos);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON sos_alerts, sos_events TO app_runtime;
    GRANT UPDATE (cancelled_at, handled_by, handled_at) ON sos_alerts TO app_runtime;
  END IF;
END $$;
