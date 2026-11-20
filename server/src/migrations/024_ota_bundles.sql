-- Bundles OTA auto-hébergés (NAR-189). Un bundle web zippé (quelques centaines de Ko, quelques
-- Mo au plus) publié pour UNE app (parent ou enfant), sur un canal de cette app, avec la coque
-- minimale de cette app (versionCode). Gardé en base (bytea) : l'image ne garde aucun état
-- (NOSYHOST.md), une publication ne redéploie rien, et la sauvegarde de la base l'emporte.
-- Servi par /api/ota/bundles/:id (identifiant cherché en base, aucun chemin vers le disque).
-- Écrit par la seule publication administrative (server/bin/ota-publish.js, compte
-- propriétaire) ; l'application ne fait que lire.
CREATE TABLE ota_bundles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app              text NOT NULL CHECK (app IN ('parent', 'enfant')),
  -- Canal de l'app : son nom, ou son nom suivi de « - » et d'un suffixe (même règle que
  -- channelBelongsTo, src/lib/otaTarget.ts) ; jamais le canal d'une autre app.
  channel          text NOT NULL CHECK (
    char_length(channel) <= 40 AND channel ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND (channel = app OR left(channel, char_length(app) + 1) = app || '-')),
  version          text NOT NULL CHECK (version ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$'),
  min_native_build integer NOT NULL CHECK (min_native_build BETWEEN 1 AND 2100000000),
  -- Zip de 10 Mo au plus (signature PK\x03\x04 vérifiée à la publication) ; l'empreinte est
  -- celle du contenu, recalculée par la base : elle ne peut pas mentir.
  bundle           bytea NOT NULL CHECK (octet_length(bundle) BETWEEN 22 AND 10485760),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$' AND sha256 = encode(sha256(bundle), 'hex')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app, channel, version)
);
CREATE INDEX ota_bundles_latest ON ota_bundles(app, channel, created_at DESC);

-- Lecture seule pour l'application : ni INSERT, ni UPDATE, ni DELETE.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT ON ota_bundles TO app_runtime;
  END IF;
END $$;
