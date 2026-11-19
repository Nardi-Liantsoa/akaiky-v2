#!/bin/sh
# Release signée de l'app enfant (NAR-165) : build web, sync, assembleEnfantRelease,
# vérifications (signature, signataire unique, versionCode en hausse), copie dans
# downloads/ avec l'empreinte du certificat, et valeur à mettre dans le QR.
# Keystore hors dépôt : AKAIKY_KEYSTORE_PROPERTIES ou ~/.config/akaiky-v2/keystore.properties.
# ALLOW_SAME_VERSION=1 : republier la même version (reconstruction, jamais une mise à jour).
set -eu
cd "$(dirname "$0")/.."
PROPS="${AKAIKY_KEYSTORE_PROPERTIES:-$HOME/.config/akaiky-v2/keystore.properties}"
[ -f "$PROPS" ] || { echo "Keystore introuvable : $PROPS (voir NOSYHOST.md § 6)" >&2; exit 1; }
: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"; export ANDROID_HOME
TOOLS=$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -x "${TOOLS:-}/apksigner" ] && [ -x "$TOOLS/aapt2" ] || { echo "apksigner/aapt2 introuvables dans $ANDROID_HOME/build-tools" >&2; exit 1; }
version_of() { "$TOOLS/aapt2" dump badging "$1" | sed -n "s/^package: .* versionCode='\([0-9]*\)'.*/\1/p"; }

npm run build
npx cap sync android
(cd android && ./gradlew --quiet assembleEnfantRelease)
APK=android/app/build/outputs/apk/enfant/release/app-enfant-release.apk
[ -f "$APK" ] || { echo "APK de release absent : $APK" >&2; exit 1; }
"$TOOLS/apksigner" verify "$APK"

# Un seul signataire, empreinte SHA-256 complète.
CERTS=$("$TOOLS/apksigner" verify --print-certs "$APK" | grep -E '^Signer #[0-9]+ certificate SHA-256 digest: ')
[ "$(printf '%s\n' "$CERTS" | wc -l | tr -d ' ')" = 1 ] || { echo "Plusieurs signataires : refusé" >&2; exit 1; }
CERT_HEX=${CERTS##*: }
case "$CERT_HEX" in *[!0-9a-f]*|'') echo "Empreinte illisible : '$CERT_HEX'" >&2; exit 1 ;; esac
[ ${#CERT_HEX} -eq 64 ] || { echo "Empreinte de longueur inattendue" >&2; exit 1; }
CHECKSUM=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "hex").toString("base64url"))' "$CERT_HEX")

# Les téléphones refusent une mise à jour qui ne monte pas le versionCode.
NEW=$(version_of "$APK")
if [ -f downloads/akaiky-enfant.apk ] && [ "${ALLOW_SAME_VERSION:-0}" != 1 ]; then
  OLD=$(version_of downloads/akaiky-enfant.apk)
  [ "$NEW" -gt "$OLD" ] || { echo "versionCode $NEW pas supérieur à la version publiée ($OLD) : monter versionCode dans enfant { } (android/app/build.gradle)" >&2; exit 1; }
fi

mkdir -p downloads
cp "$APK" downloads/akaiky-enfant.apk
# Lue par le serveur au démarrage : comparée à DEVICE_APK_SIGNATURE_SHA256.
printf '%s\n' "$CHECKSUM" > downloads/akaiky-enfant.cert-sha256
# Comparé à DEVICE_APK_VERSION_CODE au démarrage : la mise à jour n'est annoncée aux
# téléphones (NAR-170) que si les deux concordent.
printf '%s\n' "$NEW" > downloads/akaiky-enfant.version-code
echo "APK : downloads/akaiky-enfant.apk, versionCode $NEW ($(du -h downloads/akaiky-enfant.apk | cut -f1))"
echo "DEVICE_APK_SIGNATURE_SHA256=$CHECKSUM"
echo "DEVICE_APK_VERSION_CODE=$NEW"
