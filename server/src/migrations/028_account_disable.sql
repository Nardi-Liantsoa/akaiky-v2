-- Désactivation d'un compte par l'équipe (NAR-199, tranche 2 du back-office NAR-144).
-- `disabled_at` posé : plus aucune session valable (SESSION_RULE, server/src/lib.js : cookie,
-- Bearer et renouvellement natif), connexion refusée par le même 401 qu'un mauvais mot de
-- passe, sessions effacées à la désactivation (jetons push par cascade). Effacé : réactivé.
-- Additive et nullable : la version précédente de l'API l'ignore (en retour arrière, un
-- compte désactivé se reconnecterait : désactiver de nouveau après la remontée).
ALTER TABLE users ADD COLUMN disabled_at timestamptz;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Seule la date de désactivation : jamais is_admin, l'adresse ni le numéro.
    GRANT UPDATE (disabled_at) ON users TO app_runtime;
  END IF;
END $$;
