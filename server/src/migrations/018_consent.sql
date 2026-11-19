-- Consentement (NAR-178, RGPD). Additif : les comptes et enfants existants gardent NULL
-- (inscrits avant que la case existe) ; toute nouvelle ligne le reçoit de l'API.
--   users.consent_at     : majeur·e, titulaire de l'autorité parentale (inscription) ;
--   children.consent_at  : autorité parentale sur cet enfant et journalisation acceptée (ajout) ;
--   children.consent_by  : compte qui a coché la case (NULL si ce compte est supprimé depuis).
ALTER TABLE users ADD COLUMN consent_at timestamptz;
ALTER TABLE children ADD COLUMN consent_at timestamptz;
ALTER TABLE children ADD COLUMN consent_by uuid REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- users : INSERT accordé colonne par colonne (001_init.sql) ; children : INSERT de toute la ligne (005).
    GRANT INSERT (consent_at) ON users TO app_runtime;
  END IF;
END $$;
