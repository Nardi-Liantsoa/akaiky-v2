# akaiky-v2 — Android et iOS

Conventions reprises de **bible-mg** et **tia-baiboly**, les deux applications
mobiles de référence du laboratoire. Ce qui suit a été payé au prix fort au
moins une fois : ne pas s'en écarter sans raison.

## Créer les coques

```bash
cp .env.example .env.local    # VITE_API_ORIGIN : adresse publique de l'API
npm run android:add           # build, cap add android, minSdk 26 (native/variables.gradle), sync
npm run ios:add               # build, cap add ios, sync (macOS + Xcode)
```

Le `capacitor.config.ts` est déjà rempli — ne pas lancer `npx cap init`, il
l'écraserait. `native/variables.gradle` est hors de `android/` exprès : si le
dossier existait déjà, `npx cap add android` refuserait de créer la coque.
Capacitor y remet `minSdkVersion = 24` par défaut ; le script le remplace.

## Deux applications Android : variantes `parent` et `enfant`

`android/app/build.gradle` déclare deux variantes de produit (dimension `app`) :

| Variante | Identifiant | Nom affiché | Distribution |
|---|---|---|---|
| `parent` | `mg.nosytech.akaiky` | Akaiky | Play Store (iOS : App Store, même identifiant) |
| `enfant` | `mg.nosytech.akaiky.enfant` | Akaiky Enfant | APK servi par le serveur, installé par le QR d'appairage (NAR-138) |

```bash
npm run android:parent   # build web, sync, assembleParentDebug
npm run android:enfant   # build web, sync, assembleEnfantDebug
```

Les deux APK s'installent côte à côte. Le web sait dans quelle application il
tourne par `src/lib/appKind.ts` (identifiant natif lu par `@capacitor/app`) :
l'app enfant n'ouvre que ses écrans (`/enfant`), l'app parent jamais ceux-là.
Noms : `android/app/src/<variante>/res/values/strings.xml`. Pas de variante
enfant sur iOS (CdC §3 : hors périmètre v1).

Durcissements posés dans `AndroidManifest.xml` : `allowBackup="false"` (données
de mineurs), `res/xml/network_security_config.xml` (HTTPS seulement, explicite :
Android 8 accepte le clair par défaut). Thème natif clair forcé ; icônes sombres
dans les deux barres système par `plugins.SystemBars.style: 'LIGHT'`
(`capacitor.config.ts`) : sans lui, Capacitor suit le thème du système et la barre
de navigation à 3 boutons passe en icônes claires sur fond clair (vu sur Android 14
en thème sombre). Le thème XML (`values-v27/styles.xml`) ne couvre que l'écran de
démarrage.

**WebView 58 sur Android 8 d'usine** : Capacitor 8 refuse de démarrer sous la
version 60 (« This app requires a WebView to work »). C'est le cas de l'image
Android 8 sans services Google, et d'un téléphone jamais mis à jour par le Play
Store. Constaté sur l'émulateur API 26 ; à trancher avant l'appairage (NAR-138).

**Outils requis** : SDK Android avec la plateforme `android-36` (compileSdk),
**JDK 21** (`invalid source release: 21` avec le JDK 17 :
`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`) ;
Xcode récent (le framework Capacitor 8 précompilé ne se lit pas avec Xcode 15).
Toujours `npm run sync` (ou les scripts `android:*`) avant `gradlew` : l'APK
embarque le dernier build web copié dans la coque.

## Trois réglages qui coûtent cher

### `minSdkVersion = 26`

Sur Android 7 et antérieur, Capacitor accède par réflexion à
`RenderProcessGoneDetail`, introduite à l'API 26. L'application s'installe,
se lance, et plante immédiatement — sans message exploitable dans les rapports
du Play Console.

Mieux vaut ne pas être installable que d'être installable et morte au
lancement. Constaté en production sur bible-mg, avec des utilisateurs bloqués
sans comprendre.

### `androidScheme: 'https'`

Déjà posé dans `capacitor.config.ts`. Sans lui, Android sert le contenu en
`http://` : caméra, géolocalisation, service workers et presse-papiers
deviennent inaccessibles, et l'échec est silencieux.

### Le greffon `legacy` de Vite

Les téléphones vendus sans services Google gardent le WebView d'usine, souvent
un Chromium 60 à 90. La cible Vite par défaut y produit de la syntaxe
inanalysable et l'application reste figée sur l'écran de démarrage.

`vite.config.ts` est configuré en « moderne seul » : un unique bundle ESM
transpilé avec ses polyfills, sans chunks SystemJS — ceux-ci reposent sur des
scripts en ligne que la politique de sécurité de contenu bloque.

## Icônes et écran de démarrage

```bash
# Déposer resources/icon.png (1024×1024) et resources/splash.png (2732×2732)
npm run icons
```

`@capacitor/assets` n'est pas une dépendance du projet : il tire `sharp`
(libvips, failles sans correctif publié en octobre 2026), et `npm audit` de la
CI resterait rouge. Le script le télécharge le temps de générer les images.

`overrides` de `package.json` : `@capacitor/cli` → `xcode` → `uuid@7`, signalé
par `npm audit` (GHSA-w5hq-g745-h8pq, v3/v5/v6 avec tampon ; `xcode` n'appelle
que `v4`). L'override impose `uuid@11.1.1` ; vérifié : `cap add ios` fonctionne.
À retirer dès qu'une `@capacitor/cli` corrigée sort (`npm ls uuid`).

## Publier

```bash
npm run sync
npm run open:android      # Build > Generate Signed Bundle
npm run open:ios          # Product > Archive
```

**Le keystore Android se conserve hors du dépôt**, dans un gestionnaire de mots
de passe. Le perdre interdit définitivement toute mise à jour de l'application
publiée : il faut republier sous un nouvel identifiant et les utilisateurs
existants ne migrent pas.

Sur Google Play, publier ne suffit pas : après l'envoi du bundle, la release
doit être **explicitement envoyée pour examen**, sinon elle reste indéfiniment
en brouillon sans que rien ne le signale.

## Mises à jour OTA

`@capgo/capacitor-updater` est installé et configuré avec `autoUpdate: false` :
c'est au code applicatif de décider quand vérifier et télécharger, pas au
plugin. Le filet de sécurité reste actif — `notifyAppReady()` est appelé dans
`main.ts`, et un bundle qui ne le fait pas dans les dix secondes est annulé au
lancement suivant.

**Ne jamais déplacer cet appel derrière un chargement de données ou un `await`
réseau** : un utilisateur hors connexion verrait sa mise à jour annulée à
chaque démarrage.

Le runtime complet — canaux, throttling des vérifications, liste des bundles
en échec, décision de mise à jour — n'est volontairement pas dans ce kit : il
est très couplé au projet. Le reprendre depuis
`tia-baiboly/src/composables/useLiveUpdate.ts` et
`tia-baiboly/src/utils/otaDecision.ts` le jour où le besoin se présente.

Deux règles de survie, elles, valent partout : publier chaque OTA sur **tous
les canaux** actifs, et ne jamais diffuser un bundle qui exige une coque plus
récente que celles réellement installées chez les utilisateurs.

## Ce que NosyHost héberge

Les coques natives partent sur les stores. NosyHost sert **une seule image** :
l'API et la version web, sur `akaiky.a-definir.invalid` (voir `NOSYHOST.md`). L'app native
parle à cette même API par `VITE_API_ORIGIN`.

## Connexion depuis l'application native

La WebView a pour origine `https://localhost` (Android) ou `capacitor://localhost`
(iOS) : le cookie de session de l'API y serait un cookie tiers, bloqué. L'app
utilise donc le transport Bearer de l'API (`src/api/transport-native.ts`) :

- jeton d'accès de 15 minutes, en mémoire ;
- jeton de renouvellement dans le **Keychain / Keystore** via
  `@aparajita/capacitor-secure-storage` (plugin natif : il est dans la coque,
  pas dans une mise à jour OTA) ;
- renouvellement tourné à chaque usage, sérialisé côté app ; un ancien jeton
  présenté au serveur ferme la session de l'appareil.

Côté serveur, `NATIVE_ORIGINS=https://localhost,capacitor://localhost` dans
`app.env` ouvre ce transport ; vide, il est fermé. `VITE_API_ORIGIN` (dans
`.env.local`, voir `.env.example`) donne l'adresse publique de l'API compilée
dans l'app.

Développer l'app contre l'API locale : un émulateur ou un téléphone ne
joint pas `localhost`, et la WebView (origine https) bloque une API en http.
Exposer l'API locale en https (tunnel), puis
`VITE_API_ORIGIN=https://<tunnel> npx vite build --mode development && npx cap sync`.
Tout autre build (production, préprod) refuse une adresse qui n'est pas en https.

Les comptes à double authentification (admins) se connectent par la version
web. Les liens reçus par email (confirmation, réinitialisation) s'ouvrent dans
le navigateur, sur la version web.

L'appareil apparaît dans « Sécurité → Application mobile », d'où il se retire.
