#!/bin/sh
# Comparaison visuelle sans capture stockée (skill ampy-recette) : le front
# construit depuis la référence (origin/main par défaut) donne les rendus de
# référence, puis celui du code courant leur est comparé au pixel près.
# Captures dans l'image Docker officielle de Playwright, à la version installée :
# même rendu sur Mac et en CI.
#   sh scripts/visual.sh                  → origin/main, ou main tant que le dépôt n'est pas poussé
#   VISUAL_BASE=<commit> sh scripts/visual.sh
set -e
BASE=${VISUAL_BASE:-$(git rev-parse -q --verify origin/main >/dev/null && echo origin/main || echo main)}
ROOT=$(pwd)
WORK=test-results/visual-travail
VERSION=$(node -p "require('@playwright/test/package.json').version")
IMAGE=mcr.microsoft.com/playwright:v$VERSION-noble

cleanup() { git worktree remove --force "$WORK/base" 2>/dev/null || true; }
trap cleanup EXIT
rm -rf "$WORK"; git worktree prune
mkdir -p "$WORK"
git worktree add --detach "$WORK/base" "$BASE" >/dev/null
ln -s "$ROOT/node_modules" "$WORK/base/node_modules"
echo "Référence : $(git rev-parse --short "$BASE") ($BASE) · image $IMAGE"
# Même dépendances des deux côtés (celles du code courant) : seul le code diffère.
(cd "$WORK/base" && npx vite build --outDir "$ROOT/$WORK/dist-base" --emptyOutDir --logLevel warn)
npx vite build --outDir "$WORK/dist" --emptyOutDir --logLevel warn

# node_modules réel monté explicitement (il peut être un lien symbolique).
MODULES=$(cd node_modules && pwd -P)
# Sous Linux, les fichiers écrits par le conteneur appartiendraient à root.
USER_OPT=$([ "$(uname)" = Linux ] && echo "--user $(id -u):$(id -g) -e HOME=/tmp" || true)
shoot() { docker run --rm --shm-size=2g --init $USER_OPT -v "$ROOT":/work -v "$MODULES":/work/node_modules -w /work -e CI -e VISUAL_REFS="$WORK/refs" "$@"; }
# 1. Rendus de la référence.
shoot -e VISUAL_DIST="$WORK/dist-base" "$IMAGE" npx playwright test -c playwright.visual.config.mjs --update-snapshots --reporter=dot >/dev/null
# 2. Rendus du code courant, comparés.
shoot -e VISUAL_DIST="$WORK/dist" "$IMAGE" npx playwright test -c playwright.visual.config.mjs
