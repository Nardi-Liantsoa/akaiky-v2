#!/bin/sh
# Release signée de l'app enfant (NAR-165) : build web, sync, assembleEnfantRelease,
# vérification de la signature, copie dans downloads/ et somme pour le QR.
# Keystore hors dépôt : AKAIKY_KEYSTORE_PROPERTIES ou ~/.config/akaiky-v2/keystore.properties.
set -eu
cd "$(dirname "$0")/.."
PROPS="${AKAIKY_KEYSTORE_PROPERTIES:-$HOME/.config/akaiky-v2/keystore.properties}"
[ -f "$PROPS" ] || { echo "Keystore introuvable : $PROPS (voir NOSYHOST.md, « APK enfant »)" >&2; exit 1; }
: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"; export ANDROID_HOME
npm run build
npx cap sync android
(cd android && ./gradlew --quiet assembleEnfantRelease)
APK=android/app/build/outputs/apk/enfant/release/app-enfant-release.apk
[ -f "$APK" ] || { echo "APK de release absent (signature non configurée ?) : $APK" >&2; exit 1; }
APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify "$APK"
mkdir -p downloads
cp "$APK" downloads/akaiky-enfant.apk
CERT_HEX=$("$APKSIGNER" verify --print-certs downloads/akaiky-enfant.apk | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
CHECKSUM=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "hex").toString("base64url"))' "$CERT_HEX")
echo "APK : downloads/akaiky-enfant.apk ($(du -h downloads/akaiky-enfant.apk | cut -f1))"
echo "DEVICE_APK_SIGNATURE_SHA256=$CHECKSUM"
