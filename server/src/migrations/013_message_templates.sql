-- Textes des 4 messages rapides, modifiables par un gestionnaire (NAR-173). Une ligne
-- absente vaut le texte par défaut, traduit par l'app. Texte chiffré (données associées
-- « quick_message_templates:text:<enfant>:<emplacement> »).
CREATE TABLE quick_message_templates (
  family_id  uuid NOT NULL,
  child_id   uuid NOT NULL,
  slot       smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  text_enc   bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, slot),
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE
);

-- Texte au moment de l'envoi (journal parent : le texte réellement envoyé) ; null = texte
-- par défaut.
ALTER TABLE quick_messages ADD COLUMN text_enc bytea;

-- Toute modification des textes fait avancer config_version : le téléphone ne reste pas
-- sur un 304 (même mécanique que les contacts, 006).
CREATE FUNCTION quick_message_templates_bump_version() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE children SET config_version = config_version + 1
   WHERE id = COALESCE(NEW.child_id, OLD.child_id) AND family_id = COALESCE(NEW.family_id, OLD.family_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION quick_message_templates_bump_version() FROM PUBLIC;
CREATE TRIGGER quick_message_templates_bump_version AFTER INSERT OR UPDATE OR DELETE ON quick_message_templates
  FOR EACH ROW EXECUTE FUNCTION quick_message_templates_bump_version();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON quick_message_templates TO app_runtime;
    GRANT UPDATE (text_enc, updated_at) ON quick_message_templates TO app_runtime;
  END IF;
END $$;
