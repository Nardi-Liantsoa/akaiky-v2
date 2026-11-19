# akaiky-v2 — hébergement

Une seule image : l'API sert aussi le front compilé, sur la même origine.
Conforme au **contrat d'application NosyHost** dès sa création.

| | |
|---|---|
| Identifiant client NosyHost | `akaiky_v2` |
| Domaine de production | `akaiky.a-definir.invalid` |
| Image | `registry.chantier.nosylabs.com/akaiky-v2` |
| Port dans le conteneur | `8080` |
| Vivacité | `/health` (sans base) |
| Aptitude | `/ready` (avec base) |
| Base de données | PostgreSQL dédiée, fournie par NosyHost |

## 1. Vérifier l'image localement

```bash
npm install                       # crée aussi server/package-lock.json
docker build -t akaiky-v2:dev .
# NODE_ENV=development : en production, l'image exige https, TRUST_PROXY, la clé MFA et SMTP.
docker run --rm -p 8080:8080 -e NODE_ENV=development \
  -e DATABASE_URL=postgres://… -e APP_ORIGIN=http://localhost:8080 akaiky-v2:dev
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health
```

## 2. Livrer (sur ordre seulement)

Pas de GitHub Actions pour livrer : l'image se construit sur le chantier, qui
héberge aussi le registre (`nosyhost/docs/HANDOFF.md`, « Chaîne de livraison »).
Chaque ligne s'exécute sur ordre explicite, depuis le dépôt NosyHost :

```bash
git tag v1.0.0 && git push origin v1.0.0                                    # dans ce projet
make release IMAGE=akaiky-v2 TAG=v1.0.0 REPO=~/labo2026/akaiky-v2              # → registry.chantier.nosylabs.com/akaiky-v2:1.0.0
make deploy CLIENT=akaiky_v2_preprod IMAGE=registry.chantier.nosylabs.com/akaiky-v2:1.0.0
make promote PROJET=akaiky_v2                                           # après validation du client
```

**Jamais `latest`** : sans version distincte, NosyHost n'a aucune image
antérieure vers laquelle revenir.

## 3. Héberger

Sur le chantier, depuis le dépôt NosyHost — **sans `--statique`**, l'application a une base :

```bash
./scripts/project-new.sh akaiky_v2 akaiky.a-definir.invalid                  # 1re fois : dev + preprod
./scripts/project-new.sh akaiky_v2 akaiky.a-definir.invalid --envs prod      # 1re livraison en production seulement
```

Pour chaque environnement `clients/akaiky_v2_<env>/` (`<env>` = `dev`, `preprod`, `prod`), `.env` :

```bash
APP_PORT=8080
APP_HEALTH_PATH=/health
APP_CPUS=1.0
APP_MEMORY=512M          # scrypt réserve ~128 Mo par calcul, deux au plus en parallèle
```

`app.env` du même dossier — secrets générés **sur le serveur**, jamais
affichés ni copiés ailleurs :

```bash
NODE_ENV=production
APP_ORIGIN=https://akaiky.a-definir.invalid
# APP_EXTRA_ORIGINS=https://<domaine temporaire>      # préprod ou bascule
MFA_ENCRYPTION_KEY=<openssl rand -hex 32>             # à sauvegarder AVEC la base
DATA_ENCRYPTION_KEY=<openssl rand -hex 32>            # autre clé ; à sauvegarder AVEC la base (prénoms des enfants)
TRUST_PROXY=<CIDR du réseau edge du client>           # adresses explicites, jamais true
SMTP_HOST=… SMTP_PORT=465 SMTP_USER=… SMTP_PASS=…
MAIL_FROM=Akaiky <no-reply@akaiky.a-definir.invalid>         # domaine avec SPF + DKIM aligné + DMARC
# NATIVE_ORIGINS=https://localhost,capacitor://localhost   # seulement avec l'app mobile
# DEVICE_APK_URL=https://akaiky.a-definir.invalid/downloads/akaiky-enfant.apk   # QR d'appairage (NAR-138, NAR-165)
# DEVICE_APK_SIGNATURE_SHA256=<SHA-256 du certificat de signature, base64url>  # sans les deux : pas de QR (503)
#   (exigent NATIVE_ORIGINS avec https://localhost : le téléphone appelle l'API depuis la WebView Android)
# DEVICE_APK_VERSION_CODE=<versionCode>              # mise à jour des téléphones (NAR-170) ; exigé en production avec DEVICE_APK_URL
# DEVICE_APK_SHA256=<SHA-256 hexadécimal du fichier>   # seulement si l'APK est servi ailleurs que par ce serveur
# API_RATE_LIMIT=300                                   # requêtes/min/IP ; à relever derrière un NAT d'opérateur
# PHONE_DEFAULT_COUNTRY=MG                            # pays des numéros saisis sans indicatif : MG ou FR
# INVITATION_EMAILS_PER_HOUR=100                       # invitations envoyées par heure, tous comptes (budget séparé des courriels de compte)
PUSH_PROVIDER=none                                    # notifications push (NAR-141) : none tant que Firebase n'existe pas, puis fcm ; fake refusé
# FCM_SERVICE_ACCOUNT=/run/secrets/fcm.json            # avec fcm : compte de service Firebase (fichier monté hors image, ou le JSON) ; vérifié au démarrage
```

**Avant le prochain déploiement : PUSH_PROVIDER=none en préprod et en prod (tant que le projet
Firebase n'existe pas).** Sans cette variable, l'application refuse de démarrer.

L'application **refuse de démarrer** si une valeur de production manque ou
est dangereuse (origine en http, clé MFA absente, `TRUST_PROXY=true`, SMTP sans
expéditeur, `PUSH_PROVIDER` absent ou `fake`, compte de service FCM illisible). Le message d'erreur est dans `make logs`.

```bash
make check
make backup CLIENT=akaiky_v2_preprod && make drill CLIENT=akaiky_v2_preprod
```

## 4. Le premier administrateur

Aucune route ne crée d'admin. Après inscription et confirmation du compte, un
conteneur ponctuel avec le compte **propriétaire** de la base :

```bash
node server/bin/make-admin.js admin@akaiky.a-definir.invalid
node server/bin/mfa-invite.js admin@akaiky.a-definir.invalid /root/invitation-mfa.txt   # fichier 600, 24 h
```

L'invitation se remet hors bande ; à la connexion suivante, l'admin active sa
double authentification avec ce code puis note ses dix codes de secours.

## 5. Rôle SQL restreint (obligatoire avant d'ouvrir au public)

Au premier déploiement, l'application joue ses migrations avec le compte
propriétaire (`DB_MIGRATIONS=auto`). Avant l'ouverture, elle passe sur un rôle
sans privilège : elle ne pourra plus créer de table, se donner `is_admin` ni
effacer le journal d'audit.

1. Sauvegarde : `make backup CLIENT=akaiky_v2_<env>`.
2. Créer le rôle avec le compte propriétaire (`psql -v runtime_password=… -f ops/runtime-role.sql`),
   mot de passe généré sur le serveur et rangé dans `.env` (`RUNTIME_DB_PASSWORD`).
3. Dans `compose.yml` de l'environnement, `DATABASE_URL` sur `app_runtime:${RUNTIME_DB_PASSWORD}`,
   et `DB_MIGRATIONS=verify` dans `app.env`. L'application refuse alors de
   démarrer s'il manque une migration ou si son rôle est trop privilégié.
4. Migrations suivantes : conteneur ponctuel `node server/bin/migrate.js` avec
   le compte propriétaire, **avant** de déployer l'image qui en a besoin.

⚠️ Les sauvegardes PostgreSQL ne contiennent pas les rôles du cluster : sur un
serveur neuf, **recréer `app_runtime` avant de restaurer** (procédure Deploy4000 :
`nosyhost/docs/DURCISSEMENT-DEPLOY4000-20261001.md`).

## 6. APK de l'app enfant (NAR-165)

Le téléphone de l'enfant télécharge l'APK pendant l'appairage par QR. L'image le sert
à `/downloads/akaiky-enfant.apk` ; le QR porte son adresse et la somme du certificat
de signature, qu'Android vérifie avant d'installer.

**Keystore de release** : `~/.config/akaiky-v2/akaiky-enfant-release.jks` et ses mots
de passe dans `~/.config/akaiky-v2/keystore.properties` (créés le 18/11/2026, hors
dépôt, droits 600). **À sauvegarder dans le gestionnaire de mots de passe** (fichier
et mots de passe) : sans lui, aucune mise à jour de l'app enfant n'est possible sur
les téléphones déjà configurés. Autre poste : `AKAIKY_KEYSTORE_PROPERTIES=<chemin>`.

Publier une version de l'APK (avant `make release`) :

```bash
# 1. Monter versionCode et versionName du bloc `enfant { }` (android/app/build.gradle),
#    propres à l'app enfant ; sans cela, les téléphones refusent la mise à jour.
# 2. Construire, signer, vérifier, copier dans downloads/ :
JAVA_HOME=$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home npm run android:enfant:release
#    → affiche DEVICE_APK_SIGNATURE_SHA256 (identique tant que le keystore ne change pas)
# 3. Construire et livrer l'image (section 2) avec --build-arg REQUIRE_APK=1 :
#    downloads/akaiky-enfant.apk et son empreinte (akaiky-enfant.cert-sha256) y sont copiés.
```

Variables de l'app (avec `NATIVE_ORIGINS` contenant `https://localhost`) :

```
DEVICE_APK_URL=https://<domaine>/downloads/akaiky-enfant.apk
DEVICE_APK_SIGNATURE_SHA256=Gg-Buz0ZeueZt6lby12Z4DwwXw43F_xwO0XBWYshbyU
DEVICE_APK_VERSION_CODE=<versionCode affiché par la release>
```

`DEVICE_APK_VERSION_CODE` (NAR-170) est **exigé en production** dès que `DEVICE_APK_URL` est posé :
les téléphones verrouillés se mettent à jour quand il dépasse leur version. Le SHA-256 du
fichier est calculé au démarrage sur l'APK embarqué ; un APK servi ailleurs exige
`DEVICE_APK_SHA256` (hexadécimal). Si la version configurée diffère de
`akaiky-enfant.version-code` (écrit par la release, exigé dans l'image), ou l'empreinte de `DEVICE_APK_SHA256`
de l'APK embarqué, l'API le journalise et n'annonce aucune mise à jour. **Avant le prochain
déploiement de production avec `DEVICE_APK_URL` : poser `DEVICE_APK_VERSION_CODE`**, sinon
l'application refuse de démarrer.

La somme est publique (empreinte du certificat, pas un secret) ; elle ne change que si
le keystore change, ce qui rendrait les téléphones existants impossibles à mettre à jour.
Le contexte de build Docker exclut `android/`, `ios/` et tout fichier de keystore ; seul
`downloads/akaiky-enfant.apk` est copié dans l'image. Si `DEVICE_APK_URL` pointe vers ce
serveur et que l'APK manque à l'image, l'API le journalise au démarrage et refuse les QR
(503) plutôt que d'en émettre qui mèneraient à une page introuvable ; de même si
l'empreinte écrite par la release diffère de `DEVICE_APK_SIGNATURE_SHA256`. Le script
refuse aussi un `versionCode` qui ne monte pas (`ALLOW_SAME_VERSION=1` pour reconstruire).

## Ce qu'il ne faut pas casser

- **`/health` n'interroge pas la base** : il pilote le déploiement
  vérifié et le retour arrière automatique.
- **Migrations additives** : la version précédente de l'image doit tourner
  sur le nouveau schéma, sinon le retour arrière casse.
- **Aucun fichier écrit dans le conteneur** : il est jeté à chaque déploiement.
- **`MFA_ENCRYPTION_KEY` sauvegardée avec la base** : sans elle, aucun admin
  ne peut plus se connecter après une restauration.
- **`DATA_ENCRYPTION_KEY` sauvegardée avec la base** : sans elle, les prénoms
  des enfants (et les futures données chiffrées des familles) sont illisibles.
