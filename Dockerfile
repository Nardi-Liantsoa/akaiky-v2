# Image unique de akaiky-v2 : le front compilé ET l'API, servis par la même
# origine (pas de CORS pour le web, cookie de session __Host- SameSite=Strict).
#
# Contrat NosyHost : utilisateur non privilégié, écoute sur $PORT, /health sans
# dépendance à la base (/ready la vérifie), journaux sur stdout, arrêt propre
# sur SIGTERM, aucun état dans le conteneur : tout vit dans PostgreSQL.
#
# Livraison par le chantier NosyHost (voir NOSYHOST.md) :
#   make release IMAGE=akaiky-v2 TAG=v1.0.0 REPO=~/labo2026/akaiky-v2
# Tag immuable obligatoire, jamais « latest » (retour arrière de NosyHost).

# Version figée : une image flottante change sous vos pieds entre deux builds.
ARG NODE_IMAGE=node:24.14.0-alpine

# --- 1. front Vue compilé -----------------------------------------------------
FROM ${NODE_IMAGE} AS web
WORKDIR /w
COPY package.json package-lock.json ./
# --ignore-scripts : le postinstall installe server/, absent de cette étape.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY public public
COPY src src
RUN npm run build

# --- 2. dépendances de production de l'API ------------------------------------
FROM ${NODE_IMAGE} AS api
WORKDIR /s
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- 3. image finale ----------------------------------------------------------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist/web
WORKDIR /app
COPY --from=api /s/node_modules server/node_modules
COPY server/package.json server/package.json
COPY server/src server/src
COPY server/bin server/bin
COPY ops/runtime-role.sql ops/runtime-role.sql
COPY --from=web /w/dist/web dist/web
# APK de l'app enfant signé (NAR-165), produit hors de l'image par
# `npm run android:enfant:release` (keystore jamais dans le contexte de build).
COPY downloads/README.md downloads/akaiky-enfant.ap[k] downloads/akaiky-enfant.cert-sha25[6] downloads/
# Livraison : `--build-arg REQUIRE_APK=1` fait échouer le build si l'APK manque.
ARG REQUIRE_APK=0
RUN [ "$REQUIRE_APK" != 1 ] || { [ -f downloads/akaiky-enfant.apk ] && [ -f downloads/akaiky-enfant.cert-sha256 ]; } || { echo "APK enfant absent : npm run android:enfant:release" >&2; exit 1; }
# Lockfiles : auditer exactement ce qui tourne, sans secret de production.
COPY package.json package-lock.json /app/audit/site/
COPY server/package.json server/package-lock.json /app/audit/server/
# npm/yarn inutiles à l'exécution : retirés (surface d'attaque réduite).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
USER node
EXPOSE 8080
CMD ["node", "server/src/server.js"]
