-- Sirène pendant un SOS (NAR-151) : réglée par un gestionnaire, appliquée hors ligne par
-- le téléphone de l'enfant, qui la lit dans sa configuration. Faux par défaut.
ALTER TABLE children ADD COLUMN sos_siren boolean NOT NULL DEFAULT false;

-- Le déclencheur du code parent (009, 010) fait aussi avancer config_version quand la
-- sirène change : le téléphone ne reste pas sur un 304 avec l'ancien réglage.
CREATE OR REPLACE FUNCTION children_parent_code_bump_version() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.parent_code_hash IS DISTINCT FROM OLD.parent_code_hash
     OR NEW.remote_unlock_until IS DISTINCT FROM OLD.remote_unlock_until
     OR NEW.sos_siren IS DISTINCT FROM OLD.sos_siren THEN
    NEW.config_version := OLD.config_version + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER children_parent_code_bump_version ON children;
CREATE TRIGGER children_parent_code_bump_version BEFORE UPDATE OF parent_code_hash, remote_unlock_until, sos_siren ON children
  FOR EACH ROW EXECUTE FUNCTION children_parent_code_bump_version();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (sos_siren) ON children TO app_runtime;
  END IF;
END $$;
