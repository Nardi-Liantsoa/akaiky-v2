-- Position de l'enfant à la demande (NAR-203, tranche serveur de NAR-146).
--
--   location_requests  une ligne par membre et par enfant : « je regarde où il est jusqu'à
--                      watch_until ». Réécrite à chaque demande (upsert). Elle sert au réveil
--                      du téléphone (relevé dû tant qu'une demande est plus récente que sa
--                      dernière position) et à l'indicateur « ton parent regarde » de l'enfant.
--   positions          relevés uniques envoyés par le téléphone, jamais de suivi : un relevé
--                      n'est accepté que pendant une demande ouverte (routes/location.js).
--                      Latitude et longitude chiffrées (AES-256-GCM, données associées
--                      `positions:lat:<id>` / `positions:lng:<id>`) ; précision en mètres en
--                      clair (elle ne situe personne). Purgés 30 jours après réception (C20).
--                      `source` 'sos' et `sos_id` : réservés au SOS en ligne (NAR-149).

CREATE TABLE location_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL,
  child_id    uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  watch_until timestamptz NOT NULL,
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE,
  UNIQUE (child_id, user_id),
  CHECK (watch_until > created_at)
);
CREATE INDEX location_requests_watch ON location_requests(child_id, watch_until);
CREATE INDEX location_requests_expired ON location_requests(watch_until);

CREATE TABLE positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL,
  child_id    uuid NOT NULL,
  device_id   uuid NOT NULL REFERENCES child_devices(id) ON DELETE CASCADE,
  lat_enc     bytea NOT NULL,
  lng_enc     bytea NOT NULL,
  accuracy_m  integer NOT NULL CHECK (accuracy_m BETWEEN 0 AND 100000),
  source      text NOT NULL CHECK (source IN ('on_demand', 'sos')),
  sos_id      uuid,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE,
  CHECK (source = 'sos' OR sos_id IS NULL)
);
CREATE INDEX positions_child ON positions(child_id, received_at DESC);
CREATE INDEX positions_device ON positions(device_id, received_at DESC);
CREATE INDEX positions_received ON positions(received_at);

-- File push : réveil silencieux `locate` du téléphone de l'enfant (liste fermée, push-texts.js).
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_event_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_event_check
  CHECK (event IN ('message', 'test', 'config', 'battery_low', 'sim_absent', 'silent', 'locate'));
-- Plafond horaire à part pour les réveils `locate` d'un téléphone ('device:<id>:locate') : une
-- consultation longue n'épuise pas celui de ses autres réveils (`config`).
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_owner_key_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_owner_key_check
  CHECK (owner_key ~ '^(user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|device:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:locate)?)$');

-- Purge (NAR-153) : reprise de 027, plus les positions reçues depuis 30 jours (C20) et les
-- demandes échues depuis un jour.
CREATE OR REPLACE FUNCTION purge_expired() RETURNS jsonb LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n_events int; n_messages int; n_audit int; n_audit_ip int; n_sessions int; n_tokens int;
  n_push_tokens int; n_push_outbox int; n_alerts int; n_heartbeat int; n_phone int;
  n_positions int; n_location_requests int;
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

  summary := jsonb_build_object('deviceEvents', n_events, 'quickMessages', n_messages, 'auditLog', n_audit,
    'auditIpCleared', n_audit_ip, 'sessions', n_sessions, 'tokens', n_tokens,
    'pushTokens', n_push_tokens, 'pushOutbox', n_push_outbox, 'deviceAlerts', n_alerts,
    'heartbeatTokens', n_heartbeat, 'phoneCodes', n_phone,
    'positions', n_positions, 'locationRequests', n_location_requests);
  UPDATE job_runs SET finished_at = now(), result = summary WHERE job = 'retention';
  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Positions : ajout et lecture seuls ; aucune modification, suppression par la purge.
    GRANT SELECT, INSERT ON positions TO app_runtime;
    -- Demandes : posées et prolongées (upsert sur (enfant, membre)) ; jamais déplacées.
    GRANT SELECT, INSERT ON location_requests TO app_runtime;
    GRANT UPDATE (created_at, watch_until) ON location_requests TO app_runtime;
    GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
  END IF;
END $$;
