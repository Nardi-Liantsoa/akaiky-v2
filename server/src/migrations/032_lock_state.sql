-- État réel du verrou du téléphone de l'enfant (NAR-216), rapporté par le téléphone lui-même
-- (PUT /api/device/lock) : échéance de la sortie en cours, sa source (code saisi sur le
-- téléphone ou demande à distance) et son ouverture, toutes à l'heure du serveur (le téléphone
-- envoie des durées, jamais son heure). NULL = verrouillé ou rien rapporté.
ALTER TABLE child_devices
  ADD COLUMN unlocked_until timestamptz,
  ADD COLUMN unlock_source text CHECK (unlock_source IN ('code', 'remote')),
  ADD COLUMN unlock_started_at timestamptz,
  ADD COLUMN lock_reported_at timestamptz;

-- Reverrouillage demandé par un gestionnaire (DELETE /api/children/:id/unlock) : le téléphone
-- referme une sortie ouverte AVANT cette heure (comparée à unlock_started_at, même horloge).
ALTER TABLE children ADD COLUMN relock_requested_at timestamptz;

-- Le déclencheur du code parent (009, 010, 022) fait aussi avancer config_version quand un
-- reverrouillage est demandé : le téléphone ne reste pas sur un 304 sans l'ordre.
CREATE OR REPLACE FUNCTION children_parent_code_bump_version() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.parent_code_hash IS DISTINCT FROM OLD.parent_code_hash
     OR NEW.remote_unlock_until IS DISTINCT FROM OLD.remote_unlock_until
     OR NEW.sos_siren IS DISTINCT FROM OLD.sos_siren
     OR NEW.relock_requested_at IS DISTINCT FROM OLD.relock_requested_at THEN
    NEW.config_version := OLD.config_version + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER children_parent_code_bump_version ON children;
CREATE TRIGGER children_parent_code_bump_version BEFORE UPDATE OF parent_code_hash, remote_unlock_until, sos_siren, relock_requested_at ON children
  FOR EACH ROW EXECUTE FUNCTION children_parent_code_bump_version();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (unlocked_until, unlock_source, unlock_started_at, lock_reported_at) ON child_devices TO app_runtime;
    GRANT UPDATE (relock_requested_at) ON children TO app_runtime;
  END IF;
END $$;
