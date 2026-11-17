-- Enfants d'une famille (NAR-135). Le prénom est chiffré (crypto-fields.js,
-- AAD « children:first_name:<id> ») : il n'apparaît jamais en clair en base.
CREATE TABLE children (
  id             uuid PRIMARY KEY,
  family_id      uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  first_name_enc bytea NOT NULL,
  avatar_color   text NOT NULL CHECK (avatar_color IN ('orange', 'blue', 'violet', 'green', 'yellow')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Cible des clés étrangères composites des tables à venir (contacts, appareils) :
  -- un enfant référencé appartient forcément à la même famille.
  UNIQUE (family_id, id)
);
CREATE INDEX children_family ON children(family_id, created_at);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON children TO app_runtime;
    GRANT UPDATE (first_name_enc, avatar_color) ON children TO app_runtime;
  END IF;
END $$;
