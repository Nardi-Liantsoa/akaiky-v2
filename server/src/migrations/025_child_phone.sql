-- Numéro de téléphone de l'enfant (NAR-194) : saisi par un gestionnaire, appelé par les
-- membres de la famille (bouton « Antsoy » de l'accueil). E.164 chiffré comme celui d'un
-- contact (crypto-fields.js, données associées « children:phone:<id> »). Pas d'index
-- aveugle : aucune recherche ni contrôle de doublon par ce numéro. Additive et nullable :
-- la version précédente de l'API l'ignore.
ALTER TABLE children ADD COLUMN phone_enc bytea;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (phone_enc) ON children TO app_runtime;
  END IF;
END $$;
