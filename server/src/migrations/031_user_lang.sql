-- Langue du compte (NAR-211) : les courriels partent dans la langue de leur destinataire.
-- Malgache par défaut, comme l'app ; les comptes existants le prennent. Posée à
-- l'inscription (adresse ou numéro) et quand l'app change de langue (PUT /api/auth/me/lang,
-- le compte lui-même seulement).
ALTER TABLE users ADD COLUMN lang text NOT NULL DEFAULT 'mg' CHECK (lang IN ('mg', 'fr', 'en'));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT INSERT (lang), UPDATE (lang) ON users TO app_runtime;
  END IF;
END $$;
