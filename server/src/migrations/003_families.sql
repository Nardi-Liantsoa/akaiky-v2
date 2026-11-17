-- Familles (NAR-133) : chaque famille est une organisation, modèle « Plusieurs
-- organisations » d'ampy-auth. Rôles : owner (parent principal), manager
-- (gestionnaire), member (contact : appelle l'enfant et reçoit les SOS).
-- Toute table métier portera family_id et passera par requireFamilyRole.
CREATE TABLE families (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'manager', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id),
  -- v1 : un compte appartient à une seule famille. Le lever (v2) se fera en
  -- élargir, migrer, retirer.
  CONSTRAINT memberships_one_family_per_user UNIQUE (user_id)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON families, memberships TO app_runtime;
    GRANT UPDATE (name) ON families TO app_runtime;
  END IF;
END $$;
