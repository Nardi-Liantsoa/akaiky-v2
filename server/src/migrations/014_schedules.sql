-- Plages horaires « école » (NAR-148) : pendant une plage, le téléphone de l'enfant ne
-- montre que les contacts liés à un parent (owner, manager) et le SOS. Calcul fait sur
-- le téléphone, hors ligne, dans le fuseau de la famille.
-- Pas encore modifiable par l'API (une seule valeur au lancement, Madagascar).
ALTER TABLE families ADD COLUMN timezone text NOT NULL DEFAULT 'Indian/Antananarivo';

CREATE TABLE schedules (
  id         uuid PRIMARY KEY,
  family_id  uuid NOT NULL,
  child_id   uuid NOT NULL,
  -- Nom chiffré (« École Saint-Michel » dit où est l'enfant), données associées
  -- « schedules:label:<id> ».
  label_enc  bytea NOT NULL,
  -- Jours : bit 0 = lundi … bit 6 = dimanche.
  days_mask  smallint NOT NULL CHECK (days_mask BETWEEN 1 AND 127),
  -- Minutes depuis minuit ; fin ≤ début = plage qui traverse minuit.
  start_min  smallint NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min    smallint NOT NULL CHECK (end_min BETWEEN 0 AND 1439),
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_min <> end_min),
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE
);
CREATE INDEX schedules_child ON schedules(child_id);
CREATE INDEX schedules_family ON schedules(family_id);

-- Toute modification des plages fait avancer config_version (comme les contacts, 006).
CREATE FUNCTION schedules_bump_version() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE children SET config_version = config_version + 1
   WHERE id = COALESCE(NEW.child_id, OLD.child_id) AND family_id = COALESCE(NEW.family_id, OLD.family_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION schedules_bump_version() FROM PUBLIC;
CREATE TRIGGER schedules_bump_version AFTER INSERT OR UPDATE OR DELETE ON schedules
  FOR EACH ROW EXECUTE FUNCTION schedules_bump_version();

-- Un membre qui devient ou cesse d'être parent change les contacts « parents » montrés
-- pendant une plage : la configuration des enfants où il est un contact avance aussi.
CREATE FUNCTION memberships_role_bump_version() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE children c SET config_version = c.config_version + 1
   WHERE c.family_id = NEW.family_id
     AND EXISTS (SELECT 1 FROM allowed_contacts a WHERE a.child_id = c.id AND a.member_user_id = NEW.user_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION memberships_role_bump_version() FROM PUBLIC;
CREATE TRIGGER memberships_role_bump_version AFTER UPDATE OF role ON memberships
  FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role) EXECUTE FUNCTION memberships_role_bump_version();

-- Fuseau changé : tous les téléphones de la famille relisent leur configuration.
CREATE FUNCTION families_timezone_bump_version() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE children SET config_version = config_version + 1 WHERE family_id = NEW.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION families_timezone_bump_version() FROM PUBLIC;
CREATE TRIGGER families_timezone_bump_version AFTER UPDATE OF timezone ON families
  FOR EACH ROW WHEN (OLD.timezone IS DISTINCT FROM NEW.timezone) EXECUTE FUNCTION families_timezone_bump_version();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON schedules TO app_runtime;
    GRANT UPDATE (label_enc, days_mask, start_min, end_min, enabled) ON schedules TO app_runtime;
  END IF;
END $$;
