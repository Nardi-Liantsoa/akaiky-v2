-- Déverrouillages du téléphone de l'enfant (NAR-168).
-- 1. Journal : chaque sortie du verrou (code saisi sur le téléphone, ou demande à
--    distance appliquée) devient un événement `unlock`, avec son origine et sa durée.
-- 2. Demande à distance : un gestionnaire pose une échéance (15 minutes au plus) que le
--    téléphone de cet enfant lit dans sa configuration et applique une seule fois.
ALTER TABLE device_events DROP CONSTRAINT device_events_kind_check;
ALTER TABLE device_events
  ADD CONSTRAINT device_events_kind_check CHECK (kind IN ('call_out', 'unlock')),
  ADD COLUMN unlock_source text CHECK (unlock_source IN ('code', 'remote')),
  -- Un appel n'a pas d'origine de déverrouillage ; un déverrouillage n'a ni contact ni numéro.
  ADD CONSTRAINT device_events_unlock_shape CHECK (
    (kind = 'unlock' AND unlock_source IS NOT NULL AND contact_id IS NULL AND name_enc IS NULL AND phone_enc IS NULL)
    OR (kind <> 'unlock' AND unlock_source IS NULL)
  );

ALTER TABLE children ADD COLUMN remote_unlock_until timestamptz;

-- Le déclencheur du code parent (009) fait aussi avancer config_version pour une
-- demande à distance : le téléphone ne reste pas sur un 304.
CREATE OR REPLACE FUNCTION children_parent_code_bump_version() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.parent_code_hash IS DISTINCT FROM OLD.parent_code_hash
     OR NEW.remote_unlock_until IS DISTINCT FROM OLD.remote_unlock_until THEN
    NEW.config_version := OLD.config_version + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER children_parent_code_bump_version ON children;
CREATE TRIGGER children_parent_code_bump_version BEFORE UPDATE OF parent_code_hash, remote_unlock_until ON children
  FOR EACH ROW EXECUTE FUNCTION children_parent_code_bump_version();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (remote_unlock_until) ON children TO app_runtime;
  END IF;
END $$;
