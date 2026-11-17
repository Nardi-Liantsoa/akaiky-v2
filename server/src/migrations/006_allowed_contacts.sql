-- Contacts autorisés d'un enfant (NAR-140) : 6 au plus, ordonnés (l'ordre sert
-- aussi à la cascade d'appels SOS). Prénom et numéro chiffrés ; l'unicité du
-- numéro par enfant passe par un index aveugle (HMAC du numéro E.164).
ALTER TABLE children ADD COLUMN config_version bigint NOT NULL DEFAULT 0;

CREATE TABLE allowed_contacts (
  id             uuid PRIMARY KEY,
  family_id      uuid NOT NULL,
  child_id       uuid NOT NULL,
  member_user_id uuid,
  name_enc       bytea NOT NULL,
  phone_enc      bytea NOT NULL,
  phone_index    bytea NOT NULL,
  position       smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  avatar_color   text NOT NULL CHECK (avatar_color IN ('orange', 'blue', 'violet', 'green', 'yellow')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- L'enfant et le membre lié appartiennent forcément à la même famille que le contact.
  FOREIGN KEY (family_id, child_id) REFERENCES children(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, member_user_id) REFERENCES memberships(family_id, user_id) ON DELETE SET NULL (member_user_id),
  CONSTRAINT allowed_contacts_phone UNIQUE (child_id, phone_index),
  -- Différée : une réorganisation échange des positions dans une seule transaction.
  CONSTRAINT allowed_contacts_position UNIQUE (child_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX allowed_contacts_family ON allowed_contacts(family_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON allowed_contacts TO app_runtime;
    GRANT UPDATE (name_enc, phone_enc, phone_index, position, avatar_color, member_user_id) ON allowed_contacts TO app_runtime;
    GRANT UPDATE (config_version) ON children TO app_runtime;
  END IF;
END $$;
