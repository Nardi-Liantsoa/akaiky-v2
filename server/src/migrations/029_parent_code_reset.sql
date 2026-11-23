-- Demande d'un nouveau code parent par l'équipe (NAR-200, back-office tranche 3).
-- Une date, rien d'autre : le hachage n'est pas touché (l'ancien code reste valable et le
-- déverrouillage à distance aussi), et la colonne est hors de la liste du déclencheur
-- children_parent_code_bump_version : la configuration du téléphone ne change pas.
-- Effacée quand un gestionnaire définit un nouveau code (PUT /api/children/:id/parent-code).
ALTER TABLE children ADD COLUMN parent_code_reset_requested_at timestamptz;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (parent_code_reset_requested_at) ON children TO app_runtime;
  END IF;
END $$;
