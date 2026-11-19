-- Applications autorisées (NAR-143).
-- device_apps : applications lançables envoyées par le téléphone de l'enfant (inventaire
-- remplacé en entier à chaque envoi). Nom chiffré (il dit ce qui est installé sur le
-- téléphone d'un mineur), données associées « device_apps:label:<téléphone>:<paquet> » ;
-- icône PNG 48×48 de 4 Ko au plus. Aucune donnée d'usage. `browser` : le téléphone l'a vu
-- ouvrir des liens web (navigateur) ; jamais montré au parent ni autorisable.
CREATE TABLE device_apps (
  device_id  uuid NOT NULL REFERENCES child_devices(id) ON DELETE CASCADE,
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  package    text NOT NULL CHECK (char_length(package) BETWEEN 3 AND 200),
  label_enc  bytea NOT NULL,
  icon       bytea CHECK (octet_length(icon) <= 4096),
  browser    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, package)
);
CREATE INDEX device_apps_family ON device_apps(family_id);

-- allowed_apps : 4 applications au plus par enfant, ordonnées ; nom copié de l'inventaire
-- au moment du choix (chiffré, « allowed_apps:label:<enfant>:<paquet> »).
CREATE TABLE allowed_apps (
  family_id  uuid NOT NULL,
  child_id   uuid NOT NULL,
  package    text NOT NULL CHECK (char_length(package) BETWEEN 3 AND 200),
  label_enc  bytea NOT NULL,
  position   smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, package),
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE,
  CONSTRAINT allowed_apps_position UNIQUE (child_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX allowed_apps_family ON allowed_apps(family_id);

-- Toute modification de la liste fait avancer config_version : le téléphone ne reste pas
-- sur un 304 (même mécanique que les contacts, 006).
CREATE FUNCTION allowed_apps_bump_version() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE children SET config_version = config_version + 1
   WHERE id = COALESCE(NEW.child_id, OLD.child_id) AND family_id = COALESCE(NEW.family_id, OLD.family_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION allowed_apps_bump_version() FROM PUBLIC;
CREATE TRIGGER allowed_apps_bump_version AFTER INSERT OR UPDATE OR DELETE ON allowed_apps
  FOR EACH ROW EXECUTE FUNCTION allowed_apps_bump_version();

-- Remplacement complet (suppression puis ajout) : aucun UPDATE accordé.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON device_apps, allowed_apps TO app_runtime;
  END IF;
END $$;
