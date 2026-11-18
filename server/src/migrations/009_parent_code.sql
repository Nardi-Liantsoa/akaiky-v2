-- Code parent du téléphone de l'enfant (NAR-139). Le téléphone le vérifie hors
-- ligne (NAR-167) : le serveur n'en garde qu'un hachage PBKDF2-HMAC-SHA256
-- (WebCrypto n'offre pas scrypt), au format « pbkdf2-sha256$<itérations>$<sel>$<clé> »,
-- envoyé au seul téléphone de cet enfant dans sa configuration.
ALTER TABLE children
  ADD COLUMN parent_code_hash text
    CHECK (parent_code_hash ~ '^pbkdf2-sha256\$[0-9]{5,7}\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$'),
  ADD COLUMN parent_code_set_at timestamptz,
  ADD CONSTRAINT children_parent_code_set CHECK ((parent_code_hash IS NULL) = (parent_code_set_at IS NULL));

-- Un nouveau code fait avancer config_version : le téléphone ne reste pas sur un 304
-- avec l'ancien. BEFORE UPDATE : la ligne elle-même est modifiée, le rôle applicatif
-- n'a toujours aucun droit d'écrire config_version (il ne peut pas la reculer).
CREATE FUNCTION children_parent_code_bump_version() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.parent_code_hash IS DISTINCT FROM OLD.parent_code_hash THEN
    NEW.config_version := OLD.config_version + 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION children_parent_code_bump_version() FROM PUBLIC;
CREATE TRIGGER children_parent_code_bump_version BEFORE UPDATE OF parent_code_hash ON children
  FOR EACH ROW EXECUTE FUNCTION children_parent_code_bump_version();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (parent_code_hash, parent_code_set_at) ON children TO app_runtime;
  END IF;
END $$;
