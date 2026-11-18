-- Messages rapides de l'enfant aux parents (NAR-150) : 4 messages prédéfinis (emplacements
-- 1 à 4, textes traduits par l'app ; textes modifiables : NAR-173). Aucun texte libre
-- n'est stocké. Identifiant choisi par le téléphone : un envoi rejoué n'est jamais doublé.
CREATE TABLE quick_messages (
  id         uuid PRIMARY KEY,
  family_id  uuid NOT NULL,
  child_id   uuid NOT NULL,
  device_id  uuid REFERENCES child_devices(id) ON DELETE SET NULL,
  slot       smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  sent_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE
);
-- Ordre et fenêtre de lecture : heure de réception (horloge du serveur).
CREATE INDEX quick_messages_child ON quick_messages(child_id, created_at DESC, id DESC);

-- « Vu par » : un membre de la famille a affiché le message. Une ligne par membre.
CREATE TABLE quick_message_reads (
  message_id uuid NOT NULL REFERENCES quick_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Ajout seul : ni modification ni suppression par l'application (purge : NAR-153).
    GRANT SELECT, INSERT ON quick_messages, quick_message_reads TO app_runtime;
  END IF;
END $$;
