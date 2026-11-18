-- Journal du téléphone de l'enfant (NAR-166) : appels sortants pour l'instant
-- (`call_out`) ; appels refusés (NAR-145) et messages (NAR-150) viendront s'y ajouter.
-- Données de mineurs : nom et numéro du contact chiffrés (instantané au moment de
-- l'appel, le contact pouvant être retiré ensuite). Rétention 90 jours (purge : NAR-153).
CREATE TABLE device_events (
  id          uuid PRIMARY KEY,               -- choisi par le téléphone : idempotence
  family_id   uuid NOT NULL,
  child_id    uuid NOT NULL,
  device_id   uuid REFERENCES child_devices(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('call_out')),
  contact_id  uuid REFERENCES allowed_contacts(id) ON DELETE SET NULL,
  name_enc    bytea,
  phone_enc   bytea,
  started_at  timestamptz NOT NULL,
  duration_s  integer CHECK (duration_s BETWEEN 0 AND 86400),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE
);
CREATE INDEX device_events_child ON device_events(child_id, started_at DESC);
CREATE INDEX device_events_created ON device_events(created_at);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Ajout seul : un événement enregistré n'est jamais modifié par l'application.
    GRANT SELECT, INSERT ON device_events TO app_runtime;
  END IF;
END $$;
