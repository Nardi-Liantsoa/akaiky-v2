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
APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)
[ -x "${APKSIGNER:-}" ] || { echo "apksigner introuvable dans $ANDROID_HOME/build-tools" >&2; exit 1; }
"$APKSIGNER" verify "$APK"
mkdir -p downloads
cp "$APK" downloads/akaiky-enfant.apk
CERT_HEX=$("$APKSIGNER" verify --print-certs downloads/akaiky-enfant.apk | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
# Un seul signataire, empreinte de 64 caractères hexadécimaux : sinon on n'affiche rien de faux.
echo "$CERT_HEX" | grep -Eq '^[0-9a-f]{64}$' || { echo "Empreinte du certificat illisible : '$CERT_HEX'" >&2; exit 1; }
CHECKSUM=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "hex").toString("base64url"))' "$CERT_HEX")
echo "APK : downloads/akaiky-enfant.apk ($(du -h downloads/akaiky-enfant.apk | cut -f1))"
echo "DEVICE_APK_SIGNATURE_SHA256=$CHECKSUM"
