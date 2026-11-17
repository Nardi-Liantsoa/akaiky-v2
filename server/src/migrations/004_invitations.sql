-- Invitations dans une famille (NAR-134) : jeton à usage unique stocké haché,
-- lié à la famille, au rôle proposé (jamais owner) et à l'adresse invitée.
CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('manager', 'member')),
  token_hash  bytea NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
-- Une seule invitation en attente par adresse et par famille.
CREATE UNIQUE INDEX invitations_pending ON invitations(family_id, email) WHERE used_at IS NULL;
CREATE INDEX invitations_family ON invitations(family_id, created_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON invitations TO app_runtime;
    GRANT UPDATE (used_at) ON invitations TO app_runtime;
    GRANT UPDATE (role), DELETE ON memberships TO app_runtime;
  END IF;
END $$;
