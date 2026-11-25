# akaiky-v2 — Android et iOS

Conventions reprises de **bible-mg** et **tia-baiboly**, les deux applications
mobiles de référence du laboratoire. Ce qui suit a été payé au prix fort au
moins une fois : ne pas s'en écarter sans raison.

## Les coques

`android/` et `ios/` sont dans le dépôt (NAR-137) : variantes, durcissements et
thème y vivent, `android/variables.gradle` porte `minSdkVersion = 26`. Ne pas les
recréer par `npx cap add` (refusé tant que le dossier existe, et le supprimer
perdrait ces réglages). Après un changement web :

```bash
cp .env.example .env.local    # VITE_API_ORIGIN : adresse publique de l'API
npm run sync                  # build web + cap sync (Android et iOS)
```

Après chaque `cap sync` ou mise à jour de Capacitor, vérifier que
`android/variables.gradle` garde `minSdkVersion = 26`. Ne jamais lancer
`npx cap init` : il écraserait `capacitor.config.ts`.

## Deux applications Android : variantes `parent` et `enfant`

`android/app/build.gradle` déclare deux variantes de produit (dimension `app`) :

| Variante | Identifiant | Nom affiché | Distribution |
|---|---|---|---|
| `parent` | `mg.nosytech.akaiky` | Akaiky | Play Store (iOS : App Store, même identifiant) |
| `enfant` | `mg.nosytech.akaiky.enfant` (suffixe `.enfant`) | Akaiky Enfant | APK servi par le serveur, installé par le QR d'appairage (NAR-138) |

```bash
npm run android:parent   # build web, sync, assembleParentDebug
npm run android:enfant   # build web, sync, assembleEnfantDebug
npm run android:both     # les deux, une seule synchronisation
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
en thème sombre). Le thème de l'app (`AppTheme.NoActionBar`, `values/styles.xml`)
pose une barre blanche (`values/colors_nav.xml`) ; ses icônes sombres viennent du
greffon dès Android 8.0, de l'attribut de thème avant son chargement à partir de 8.1.

**WebView minimal : 64** (NAR-161). Le bundle vise Chrome 64 et plus (modules ES,
`import()` et `import.meta`, `modernTargets` de `vite.config.ts`) ; `android.minWebViewVersion: 64`
(`capacitor.config.ts`) suit cette cible, et `src/lib/webviewTarget.test.ts` échoue
si les deux divergent. En dessous, Capacitor affiche `public/webview.html`
(`server.errorPath`) : en malgache, français et anglais, sans JavaScript, il demande
de relancer, puis sur Android de mettre à jour « Android System WebView » ou Chrome
depuis le Play Store, sinon de réinstaller. Capacitor l'affiche aussi (Android et
iOS) quand la page principale ne se charge pas : d'où ce texte valable dans tous les
cas. Sans ce réglage, Capacitor laisse passer dès 60 et un WebView 60 à 63 resterait
sur un écran blanc.

Cas réel visé : un téléphone Android 8.0 ou 8.1 réinitialisé (les mises à jour du
WebView sont effacées avec les données) et jamais remis à jour. Android 9 et suivants
sortent d'usine avec un WebView 64 ou plus.

**Téléphone d'enfant sous Android 8.x : à régler dans l'appairage (NAR-138).** Le QR
de provisionnement exige une réinitialisation, qui remet le WebView d'usine (61 à 63
sur Android 8.0 et 8.1). Une fois l'app verrouillée (Device Owner, lock task), ni
l'enfant ni le parent n'atteignent le Play Store : l'écran de repli resterait affiché.
L'appairage doit donc vérifier la version du WebView **avant** le verrouillage, et
faire mettre à jour le WebView (ou refuser l'appareil) tant qu'elle est sous 64.

**Provisionnement par QR (NAR-164, variante enfant)** : `AkaikyDeviceAdminReceiver`
(Device Owner), `ProvisioningModeActivity` et `PolicyComplianceActivity` (exigées dès
Android 12 pour le QR), dans `android/app/src/enfant/`. Le jeton d'appairage des extras
(`akaiky.pairing`) est gardé dans les préférences privées le temps de l'échange
(`ProvisioningStore`), puis effacé ; la session d'appareil va dans le Keystore
(`src/lib/deviceSession.ts`). L'adresse de l'API est celle compilée (`src/api/base.ts`),
jamais celle du QR.

**Mode appareil dédié (NAR-167, variante enfant)** : `Kiosk.kt` (règles pures dans
`KioskPolicy.kt`, testées), pont `KioskPlugin.kt` (`src/native/kiosk.ts`), alarme de fin de
sortie `RelockReceiver.kt`. Le verrou est **armé par l'écran de l'enfant** une fois le
téléphone appairé et un code parent reçu (jamais de verrou sans sortie) : un WebView trop ancien (écran de repli, JS jamais lancé) ne verrouille
donc jamais un téléphone qu'il ne saurait pas déverrouiller. Armé : restrictions
(réinitialisation, mode sans échec, installation, heure, mode avion…), lanceur par défaut,
lock task avec le composeur et Telecom (écran d'appel), barre d'état coupée. Code parent
vérifié hors ligne (`src/lib/parentCodeVerify.ts`), essais limités
(`src/lib/unlockGuard.ts`) ; sortie de 15 minutes, fermée par alarme, par l'écran et par
tout redémarrage. Sortie de secours : `HANDOFF.md`.

**Filtrage des appels entrants (NAR-145)** : `AkaikyCallScreeningService.kt` (rôle
`ROLE_CALL_SCREENING`, Android 10+), décision dans `CallPolicy.screenIncoming`, file native
`IncomingCalls.kt` reprise par l'écran (`peekIncoming` / `ackIncoming`) dans le journal
(`src/lib/callJournal.ts`, types `call_in` et `call_blocked`). Vérifié sur émulateur Android 14 :
un inconnu est rejeté sans sonnerie, un contact sonne. Test local du rôle sans écran :
`adb shell cmd role add-role-holder android.app.role.CALL_SCREENING mg.nosytech.akaiky.enfant`.

**Filtrage des appels entrants sur Android 8–9 (NAR-172)** : ni `CallScreeningService` ni le rôle
avant Android 10. Récepteur du manifeste `LegacyIncomingCallReceiver.kt` sur `PHONE_STATE`
(diffusion protégée, livrée aux récepteurs du manifeste malgré les restrictions d'Android 8 :
vérifié, processus tué, il est relancé par la diffusion), désactivé à partir d'Android 10
(`values-v29/bools.xml`, `incoming_receiver_enabled`) et sans effet au-dessus de l'API 28 : jamais
deux décisions pour un appel. Décision commune `IncomingCalls.screen` (la même que le service
d'Android 10+ : `CallPolicy.screenIncoming`, plages « école », numéro d'urgence présenté sans
exception, aucun réseau), règles pures dans `LegacyIncoming.kt`, cas partagés avec le service
dans `tests/fixtures/incoming-call-cases.json` (`CallPolicyTest`, `LegacyIncomingTest`).
Refus : raccroché d'abord, noté `call_blocked` ensuite, dans la même file que NAR-145.
- Raccrocher : Android 9, `TelecomManager.endCall` (`ANSWER_PHONE_CALLS`) ; Android 8.0–8.1,
  `ITelephony.endCall` par réflexion (`TelephonyManager.getITelephony`, interface cachée sans
  restriction d'accès avant Android 9, `CALL_PHONE` suffit). `silenceRinger` est réservé au
  composeur par défaut avant Android 10 : écarté.
- Numéro : `EXTRA_INCOMING_NUMBER` exige `READ_PHONE_STATE`, et en plus `READ_CALL_LOG` sur
  Android 9, qui envoie alors RINGING deux fois (avec et sans numéro ; sans aussi pour un numéro
  masqué). Un RINGING sans numéro est relu par l'état courant du téléphone (`PhoneStateListener`,
  rappelé aussitôt à l'inscription) ; un seul appel décidé par sonnerie (`LegacyIncoming.Ring`).
  Sur Android 9, une relecture vide ne conclut pas à un numéro masqué : la copie avec le numéro
  (retenue par la file des diffusions tant que le récepteur n'a pas fini) décide ; « masqué »
  seulement après 3 s sans elle, si la même sonnerie dure (`TWIN_GRACE_MS`) : sur Android 9, un
  numéro masqué sonne donc environ 3 s de plus avant d'être raccroché. Cette attente vit dans le
  processus (en mémoire) : processus tué pendant ces 3 s, l'appel sonne sans être décidé. Numéro
  non relu (état des appels illisible, aucune réponse en 2 s) : l'appel sonne, noté dans logcat.
- Permissions `READ_PHONE_STATE`, `READ_CALL_LOG`, `CALL_PHONE`, `ANSWER_PHONE_CALLS` accordées en
  Device Owner (`setPermissionGrantState`, par `setAllowed` et `Kiosk.enforce`). L'une manque :
  le filtre ne fait rien (tout sonne, jamais un parent raccroché faute de numéro lisible) et
  l'écran le dit (`screeningRole().incomingActive`).
- **Courte sonnerie inévitable** : `PHONE_STATE` part quand Telecom fait déjà sonner. Mesuré sur
  émulateur Android 8.1 (journaux Telecom, `setCallState RINGING` → `DISCONNECTED`) : 0,19 s
  processus vivant, 0,27 s processus relancé par la diffusion, 0,04 s pour un numéro « masqué ».
  Couper le volume de la sonnerie avant de raccrocher a été essayé puis retiré : refusé par
  Android (« Not allowed to change Do Not Disturb state », sans accès aux règles de
  notification), et il ne gagnerait que quelques ms sur le raccrochage, lancé au même instant.
  L'écran d'appel entrant peut aussi apparaître un instant.
- Appel en attente (un second appel pendant un appel en ligne) : jamais raccroché, ni noté
  (`endCall` et `ITelephony` visent l'appel au premier plan : ils couperaient l'appel en ligne).
  Vérifié aussi par le mode audio (`MODE_IN_CALL`, `MODE_IN_COMMUNICATION`) au moment de décider :
  l'état gardé en mémoire est perdu si le processus redémarre pendant l'appel ; un appel VoIP en
  cours (`MODE_IN_COMMUNICATION`) laisse donc aussi sonner un inconnu (noté dans logcat, pas au
  journal). Un refus qui n'a
  pas pu raccrocher (réflexion refusée) sonne et n'est pas noté `call_blocked`.

Vérifié sur l'émulateur `nar172-api27` (Android 8.1, Google APIs arm64, Device Owner par `adb`,
permissions par `pm grant`, liste écrite dans les préférences par `run-as`, appels par
`adb emu gsm call`) : inconnu raccroché et noté, en ligne et hors ligne (données et Wi-Fi coupés,
processus tué) ; contact (format national et international) qui sonne et noté `call_in`, hors
ligne aussi ; numéro d'un chiffre (présentation retenue par le réseau) raccroché, noté sans
numéro ; appel en attente laissé sonner, appel en ligne gardé. Le poste est un Mac ARM : les images x86_64
ne démarrent pas ; l'image Android 9 arm64 Google APIs est inutilisable (service Wi-Fi absent,
`com.android.phone` et l'interface système plantent en boucle) : le chemin Android 9
(`TelecomManager.endCall`, double diffusion, relecture du numéro) n'est vérifié que par les tests JVM.
Le simulateur d'appels n'accepte que des chiffres : un vrai numéro masqué (diffusion sans numéro)
n'a pas pu être simulé. Le disque plein exige une partition de données préparée à la main
(`mke2fs` de `platform-tools`, fichier creux de 6 Go) : l'émulateur refuse de la créer sous 7,4 Go libres.

**Numéros d'urgence (NAR-197)** : `CallPolicy.EMERGENCY` = **117, 118, 147, 112, 911**. Ces numéros
sont toujours composés (appels sortants, même liste vide ou pendant une plage), et leur appel ouvre
la fenêtre des secours ci-dessous. Seulement Madagascar, plus les numéros que tout téléphone GSM
achemine vers les secours. Sources vérifiées le 20/11/2026 :

| Numéro | Service | Source | Confiance |
|---|---|---|---|
| 117 | Police, numéro général des secours depuis un mobile | gouvernement du Canada, <https://travel.gc.ca/destinations/madagascar> (« Dial 117 for emergency assistance ») ; gouvernement britannique, <https://www.gov.uk/foreign-travel-advice/madagascar/health> (« Call 117 from a mobile ») | élevée (deux gouvernements) |
| 118 | Pompiers | ANWB (club automobile néerlandais), <https://www.anwb.nl/vakantie/madagaskar/reisvoorbereiding/voor-vertrek> | moyenne (source sérieuse, non gouvernementale ; concorde avec les guides) |
| 147 | Ligne Verte, signalement des violences faites aux enfants, gratuite chez les trois opérateurs, 24 h/24 | UNICEF Madagascar, <https://www.unicef.org/madagascar/communiqu%C3%A9s-de-presse/lunicef-et-la-commune-urbaine-dantananarivo-signent-un-plan-daction> | élevée |
| 112 | Reconnu comme urgence par tout téléphone, carte SIM ou non | 3GPP TS 22.101, résumé par l'EENA : <https://eena.org/blog/is-112-a-valid-emergency-number-in-america/> | élevée pour l'acheminement par le téléphone ; sa prise en charge par un centre malgache n'est pas garantie (117 d'abord) |
| 911 | Même règle que le 112 (le téléphone le compose en appel d'urgence) | même source | élevée pour l'acheminement ; gardé parce qu'un enfant peut le connaître par la télévision |

Retirés : **15, 17, 18** (SAMU, police, pompiers français ; le gouvernement britannique cite un 17
malgache, mais depuis un fixe seulement, jamais depuis un mobile), **114** (urgences des sourds en
France), **119** (aucune source pour Madagascar). **Non ajoutés** : le SAMU (124 sur des sites
secondaires, fuel-prices.eu, openshores.co ; contredit par gov.uk, qui renvoie au 117) tant qu'une
source officielle ne le confirme pas ; la gendarmerie (aucun numéro propre trouvé). Composés, ces
numéros suivent la décision normale (refusés hors de la liste) et n'ouvrent pas la fenêtre. Seule
exception, hors de l'app : sur Android 10+, `OutgoingCalls.isEmergency` interroge aussi
`TelephonyManager.isEmergencyNumber` (carte SIM, réseau, base d'Android) ; un numéro que l'opérateur
y déclare reste traité en urgence, ce qui est voulu. Le bouton « Appeler les secours »
(`src/lib/emergency.ts` : MG → 117, sinon 112) et le repli du SOS (`SosPlugin.kt` : 112) ne rendent
que des numéros de la liste. Cas partagés : `tests/fixtures/emergency-numbers.json` (`CallPolicyTest`,
`src/lib/emergency.test.ts`) et `emergency.dialled` dans `tests/fixtures/incoming-call-cases.json`
(fenêtre ouverte ou non selon le numéro composé). **À revérifier avant toute sortie dans un autre
pays** : la liste ne vaut que pour Madagascar.

**Fenêtre des secours (NAR-196)** : après un appel de l'enfant aux secours, tout appel entrant
sonne pendant 30 min (`EmergencyWindow.MINUTES`), inconnu et masqué compris : le rappel des secours
vient souvent d'un numéro inconnu. Règle pure `EmergencyWindow.kt` ; décision dans
`CallPolicy.screenIncoming` (`emergencyWindow`), qui rend `RING_EMERGENCY_WINDOW` pour un appel qui
aurait été refusé (un contact joignable reste `RING`) ; appliquée dans `IncomingCalls.screen`, commune
au service de filtrage (Android 10+) et au récepteur d'Android 8–9 : même comportement sur les deux
chemins, cas partagés dans `tests/fixtures/incoming-call-cases.json` (dans la fenêtre, à 29 min 59 s,
à 30 min pile, après, sans appel aux secours, après un redémarrage, filtrage inactif).
- **Horloge** : instant de l'appel gardé en `elapsedRealtime` avec `Settings.Global.BOOT_COUNT`
  (préférences privées `akaiky.calls`, `emergency_at` / `emergency_boot`, écriture synchrone), comme la
  sortie du verrou : changer l'heure du téléphone ne l'ouvre ni ne la prolonge ; un redémarrage la ferme
  (autre numéro de démarrage, ou horloge repartie de zéro si le numéro est illisible). Un nouvel appel
  aux secours la relance pour 30 min.
- **Qui note l'appel aux secours** (`EmergencyCalls.record`, aucun numéro gardé) :
  - Android 10+ : `AkaikyCallScreeningService`, à qui Telecom présente aussi les appels **sortants**,
    appels d'urgence compris (vérifié sur Android 14 : `BIND_SCREENING` pour l'appel au 112), quel
    que soit le composeur : bouton « Appeler les secours » et SOS (`ACTION_DIAL` puis « Appeler »),
    composeur du système, composeur d'urgence. Seul point d'Android 10+ qui voit une urgence connue de
    Telecom : le service de redirection ne la reçoit pas. Exige le rôle de filtrage, qui est de toute
    façon la condition du filtre (sans lui, tout sonne déjà). Réponse rendue avant l'écriture.
  - Android 10+ aussi : `AkaikyCallRedirectionService` et `OutgoingCalls.decide`, pour un numéro
    d'urgence de la liste de l'app que Telecom ne connaît pas (117 sur l'émulateur : il arrive alors
    au service de redirection).
  - Android 8–9 : `OutgoingCallReceiver` (`NEW_OUTGOING_CALL`, envoyé aussi pour les urgences ;
    vérifié sur Android 8.1 avec le 112), puis `OutgoingCalls.decide` pour une urgence connue du
    seul téléphone (`PhoneNumberUtils.isEmergencyNumber`).
  - Pas le bouton lui-même : il n'ouvre que le composeur prérempli, l'enfant peut ne pas appeler ;
    noter l'appui ouvrirait la fenêtre sans appel (appuyer puis annuler). L'appel qui suit est vu
    par les chemins ci-dessus.
  - Pas le journal d'appels d'Android : les appels d'urgence n'y sont pas écrits par défaut (réglage
    opérateur `allow_emergency_numbers_in_call_log`, vérifié sur Android 14).
- **Journal** : appel laissé sonner noté `call_in` avec `emergencyWindow: true` (numéro tel que reçu,
  absent s'il est masqué) ; pas de `screenedAllowedAt` (le SOS n'y voit pas un parent qui rappelle).
  L'écran (`src/lib/callJournal.ts`) cherche sa durée comme pour un contact, ou l'envoie aussitôt sans
  durée s'il est masqué ; le serveur garde la marque (`device_events.emergency_window`, migration
  `026`, appels reçus seulement), la rend dans `/calls`, le journal et l'export ; le journal du parent
  écrit « laissé passer : appel aux secours dans les 30 min ».
- **Mode de rappel d'urgence (ECBM)** : sur l'émulateur Android 14, un appel au 112 met le téléphone
  dans ce mode, où **Android lui-même laisse sonner tout appel entrant sans consulter le filtre** (ni
  décision, ni journal : propriété `ecbm` de l'appel, aucun `BIND_SCREENING`). Le modem de l'émulateur
  n'en sort jamais (relancer `com.android.phone` en root le remet à zéro). Sur un vrai téléphone GSM,
  ce mode est rare (CDMA, certains opérateurs IMS) et borné par l'opérateur (5 min en général) : la
  fenêtre de l'app prend le relais ensuite.

Vérifié sur l'émulateur `kiosk34` (Android 14) : inconnu refusé sans appel aux secours ; bouton
des secours de l’écran (117) puis « Appeler » dans le composeur → appel noté, inconnu qui sonne et noté `call_in` marqué, jusqu'à
la file de l'écran ; contact qui sonne sans marque ; 112 depuis le composeur → appel noté par le
service de filtrage (puis ECBM, voir ci-dessus, quitté en relançant `com.android.phone`) → inconnu
qui sonne, marqué ; fenêtre passée (instant reculé de 31 min) → refusé, et toujours refusé une fois
l'heure du téléphone reculée d'une heure ; redémarrage → refusé. Sur `nar172-api27` (Android 8.1,
`PROCESS_OUTGOING_CALLS` par `pm grant`) : inconnu raccroché avant, 112 noté par `NEW_OUTGOING_CALL`,
inconnu et numéro « masqué » (un chiffre) qui sonnent, notés marqués.

Vérification locale (émulateur, sans QR) :
`adb shell dpm set-device-owner mg.nosytech.akaiky.enfant/mg.nosytech.akaiky.AkaikyDeviceAdminReceiver`
sur un émulateur neuf (`-wipe-data`, sans compte). Le scan réel (6 touches sur l'écran de
bienvenue, QR) se vérifie sur un vrai téléphone réinitialisé : critère C04.

**Huawei** : Capacitor compare `com.huawei.webview` à `minHuaweiWebViewVersion`
(numérotation propre à Huawei, défaut 10), pas à `minWebViewVersion`. Un WebView Huawei
basé sur Chromium < 64 donnerait un écran blanc. Non réglé faute de correspondance
fiable entre les deux numérotations ; à vérifier sur un appareil Huawei réel.

Ce poste ne peut pas vérifier Android 8 : l'image ARM API 26 n'a pas de WebView
utilisable (« No WebView installed » au lancement ; l'écran « This app requires a
WebView to work » vient de là, pas du seuil de version). Vérifié sur Android 14 en
forçant le seuil (écran de repli), puis avec le seuil réel (app normale).

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

## Mise à niveau AGP 9 / Capacitor 9 (liste de contrôle, NAR-163)

Coque préparée sur AGP 8.13 / Gradle 8.14.3 / Kotlin 2.2 sans changer de version
ni de comportement (mêmes fichiers dans les quatre APK, même `capacitor.config.json`
réécrit par `OtaIdentityTask`) :

- `proguard-android.txt` → `proguard-android-optimize.txt` (AGP 9 refuse le premier ;
  sans effet aujourd'hui, `minifyEnabled = false`).
- `rootProject.buildDir` → `rootProject.layout.buildDirectory` (tâche `clean`,
  déclarée par `tasks.register`).
- `aaptOptions` → `androidResources` (même `ignoreAssetsPattern`), `kotlinOptions` →
  `kotlin { compilerOptions }` (JVM 21).
- Affectations Groovy `prop valeur` → `prop = valeur` dans `app/build.gradle`
  (`signingConfig`, `buildConfig`, `dimension`, `minSdk`, `versionCode`…) : la forme
  sans `=` disparaît avec Gradle 10.
- `OtaIdentityTask` : déjà sur `androidComponents` (`onVariants`, `artifacts.use(...)
  .toTransform(SingleArtifact.ASSETS)`, non dépréciée), aucune `applicationVariants`,
  `project.exec`, `$buildDir` ni API `convention` dans nos fichiers.
- Variantes : `flavorDimensions = ['app']`, `dimension = 'app'`, rien à changer ;
  `minSdkVersion = 26` reste dans `variables.gradle`.

À faire **pendant** la montée de version (pas avant) :

1. Kotlin intégré d'AGP 9 : retirer `apply plugin: 'org.jetbrains.kotlin.android'`
   (`app/build.gradle`) et la dépendance `kotlin-gradle-plugin` (`build.gradle`), sinon
   `android.builtInKotlin=false` le temps de la transition. Le bloc `kotlin { compilerOptions }`
   reste valable.
2. Nouveau DSL d'AGP 9 (`android.newDsl`) : vérifier qu'aucun greffon de `node_modules`
   n'utilise encore `applicationVariants`/`libraryVariants` (aucun aujourd'hui).
3. `lintOptions { abortOnError false }` de Capacitor et de chaque greffon (`@capacitor/android`,
   `app`, `status-bar`, `@capgo/capacitor-updater`, `@aparajita/capacitor-secure-storage`,
   `capacitor-cordova-android-plugins` généré) : DSL retiré par AGP 9, à recevoir des versions
   Capacitor 9 des greffons (on ne modifie pas `node_modules`). Avertissements restants
   `abortOnError` / `exceptionFormat` (Gradle 10) : même origine.
4. `com.google.gms:google-services` 4.4.4 : vérifier la version compatible AGP 9.
5. `variables.gradle` réécrit par `npx cap migrate` : remettre `minSdkVersion = 26`.
6. `gradle.taskGraph.whenReady` (garde de la release enfant) : à revoir si le cache de
   configuration devient obligatoire.
7. `flatDir` (`app/build.gradle`, `capacitor-cordova-android-plugins`) : simple avertissement,
   modèle Capacitor ; suivre le modèle Capacitor 9.
8. Contrôle : `./gradlew --warning-mode all clean assembleParentDebug assembleEnfantDebug
   assembleParentRelease assembleEnfantRelease`, puis `assets/capacitor.config.json` des APK
   (bloc `CapacitorUpdater` : `appId` et `defaultChannel` propres à chaque variante).

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

## Notifications push : fichiers Firebase (NAR-179)

Les coques se construisent et démarrent sans eux (pas de notification, carte « indisponibles »). Une fois le projet
Firebase créé **au nom du client** (sur ordre) :

1. Déclarer dans le projet les deux apps Android, `mg.nosytech.akaiky` et `mg.nosytech.akaiky.enfant`, avec l'empreinte
   SHA-256 de leur keystore, et l'app iOS `mg.nosytech.akaiky`.
2. Télécharger `google-services.json` (il contient les deux apps Android) dans `android/app/`, et
   `GoogleService-Info.plist` dans `ios/App/App/`, sans l'ajouter au projet Xcode : l'étape de build « Copier
   GoogleService-Info.plist » le copie dans l'app s'il est là (absent : avertissement en Debug, build refusé pour toute autre configuration, Profile compris, et pour une archive ; un plist d’une autre app est refusé). La cible App n’a pas le sandboxing des scripts (`ENABLE_USER_SCRIPT_SANDBOXING = NO`) : un fichier facultatif ne se déclare pas sous le sandboxing.
   `android/app/build.gradle` n'applique le greffon `google-services` que si le fichier est là.
3. Déposer la clé APNs `.p8` dans Firebase (Paramètres du projet → Cloud Messaging), et activer la capacité
   « Push Notifications » de l'identifiant d'app chez Apple (`ios/App/App/App.entitlements` la déclare).
4. Restreindre la clé API de ces fichiers dans la console Google Cloud (paquets Android et empreinte, bundle iOS).
5. Serveur : `PUSH_PROVIDER=fcm` et `FCM_SERVICE_ACCOUNT` (compte de service, jamais dans le dépôt), `NOSYHOST.md`.
6. Vérifier sur un Android et un iPhone réels : Mon compte → Notifications → Activer, puis « Envoyer une notification de
   test » ; la toucher ouvre l'accueil.

iOS : Firebase iOS SDK 12 exige Xcode 16.3 ou plus.

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

## Mettre à jour l'app enfant sur les téléphones verrouillés (NAR-170)

L'app enfant (Device Owner, hors Play Store) se met à jour elle-même : `/api/device/config`
annonce `apk: { versionCode, url, sha256 }`, l'écran (`src/lib/apkUpdate.ts`) demande
l'installation quand la version est plus récente, aucun SOS en cours, au plus une tentative
toutes les 6 heures (tout réseau) ; le natif (`ApkUpdate.kt`) refuse pendant un appel, télécharge
dans le cache privé (150 Mo au plus), compare le SHA-256 du fichier, puis exige même paquet,
versionCode annoncé et strictement supérieur, et **exactement** le certificat de l'app installée
(rotation de clé acceptée seulement dans le sens qu'Android accepte). Installation sans
confirmation par `PackageInstaller` ; l'app redémarre seule dans sa nouvelle version, en lock task.

Publier une version :

1. Monter `versionCode` (et `versionName`) du bloc `enfant { }` de `android/app/build.gradle`.
2. `npm run android:enfant:release` (keystore hors dépôt, `NOSYHOST.md` § 6) : écrit
   `downloads/akaiky-enfant.apk`, son empreinte de certificat et `akaiky-enfant.version-code`,
   et affiche `DEVICE_APK_VERSION_CODE`.
3. Régler `DEVICE_APK_VERSION_CODE` sur cette valeur, construire l'image avec
   `--build-arg REQUIRE_APK=1` et livrer. Le serveur calcule le SHA-256 du fichier embarqué
   et n'annonce rien si la version configurée diffère de celle de l'APK (journal d'erreur).

**Premier passage** : les téléphones déjà configurés avec une coque antérieure à NAR-170 n'ont
pas ce mécanisme ; ils reçoivent cette coque par une autre voie (reprovisionnement par QR, ou
`adb install -r` pendant une sortie sur un téléphone de développement). Ensuite, tout passe par là.

Test en développement : la version debug accepte aussi `http://127.0.0.1:<port>/`
(`src/debug/res/xml/network_security_config.xml`, avec `adb reverse`) ; l'APK distribué reste
en https seul.

## Mises à jour OTA

`@capgo/capacitor-updater` est installé et configuré avec `autoUpdate: false` :
c'est au code applicatif de décider quand vérifier et télécharger, pas au
plugin. Le filet de sécurité reste actif — `notifyAppReady()` est appelé dans
`main.ts`, et un bundle qui ne le fait pas dans les dix secondes est annulé au
lancement suivant.

**Ne jamais déplacer cet appel derrière un chargement de données ou un `await`
réseau** : un utilisateur hors connexion verrait sa mise à jour annulée à
chaque démarrage.

**Serveur OTA des coques (NAR-190)** : `capacitor.config.ts` calcule `updateUrl` =
`<origine>/api/ota/latest` et `channelUrl` = `<origine>/api/ota/channel` depuis l'origine de l'API
compilée dans le bundle (`VITE_API_ORIGIN`, lu par `loadEnv` de Vite en mode production : variable
d'environnement, puis `.env.production.local`, `.env.production`, `.env.local`, `.env` ; sinon
l'adresse provisoire `https://akaiky.a-definir.invalid`), qui doit déjà être canonique (sinon refusée). Capgo Cloud n'est jamais utilisé (données de mineurs) :
`statsUrl` vide, et le JavaScript ne peut ni changer ces adresses (`allowModifyUrl: false`), ni en
garder d'autres (`persistModifyUrl: false`), ni viser une autre app (`allowPreview: false`) ;
`httpsOnly` suit le schéma de l'origine (faux seulement pour une API locale en http), jamais de
redirection vers http. Seul le build Android release impose https ; l'origine doit être canonique
(minuscules, sans port par défaut ni « / » final), sinon `npm run dev`, les tests et les builds
refusent de démarrer.

- **Android** : `OtaIdentityTask` réécrit ces réglages dans les assets de chaque variante et fait
  **échouer le build** si `updateUrl` et `channelUrl` n'ont pas la même origine ou pas les chemins du
  serveur, visent Capgo, ou si l'origine n'apparaît pas comme `<origine>/api` (fermé par un
  délimiteur de chaîne : l'API du bundle, pas son `updateUrl`) dans les scripts du bundle embarqué (`npm run build` et `npx cap sync` faits avec deux `VITE_API_ORIGIN`). Release
  (APK et AAB) : https et, avant l'empaquetage (`otaReleaseGuard<Variante>`), **jamais l'adresse
  provisoire** ni un nom réservé (`.invalid`, `.example`, `.test`, `.localhost`, `example.com`…) : une release, `npm run android:enfant:release` compris, exige le domaine
  de production. Les tests JVM des variantes release passent avec l'adresse provisoire. Debug : https, ou `http://127.0.0.1:<port>` pour un essai local.
- **iOS** : `npx cap sync ios` copie les valeurs de `capacitor.config.ts` ; aucun contrôle au build
  Xcode : relire `ios/App/App/capacitor.config.json` avant une archive.
- **Web** : `vite build` refuse un bundle dont l'API diffère de l'origine que lit
  `capacitor.config.ts` (mode qui lirait un autre fichier `.env.*` : passer `VITE_API_ORIGIN` en
  variable d'environnement).
- Tant que l'adresse est provisoire, la barrière du runtime ne fait **aucune** requête (hôte
  `.invalid`).
- Essai sur émulateur (24/11/2026, `Pixel_9_Pro_XL`, Android 16) : coque parent debug visant
  `http://127.0.0.1:8099` (`adb reverse`), serveur local qui note chaque requête : au lancement, un
  `POST /api/ota/latest` (`app_id` `mg.nosytech.akaiky`, canal `parent`) ; capture réseau de
  l'émulateur (`-tcpdump`) sans aucune mention de `capgo`.

Construire une coque qui vise le serveur :

```sh
VITE_API_ORIGIN=https://<domaine> npm run build
VITE_API_ORIGIN=https://<domaine> npx cap sync
```

Essai local : `VITE_API_ORIGIN=http://127.0.0.1:<port> npx vite build --mode development`, puis
`VITE_API_ORIGIN=http://127.0.0.1:<port> npx cap sync android`, coque debug, `adb reverse tcp:<port> tcp:<port>`.

### Une app, un canal (NAR-162)

Les variantes `parent` et `enfant` partagent le même bundle web, mais pas les mêmes
greffons natifs (Device Owner, filtrage des appels, SOS… dans la seule coque enfant) et
leurs `versionCode` suivent deux échelles indépendantes. Chaque publication vise donc
**une** app, et l'app se reconnaît par sa coque, jamais par le bundle :

| App | Identifiant envoyé par le greffon (`app_id`) | Canal par défaut | Canaux acceptés | Coque minimale comparée à |
|---|---|---|---|---|
| parent (Android, iOS) | `mg.nosytech.akaiky` | `parent` | `parent`, `parent-*` | `versionCode` / `CFBundleVersion` parent |
| enfant (Android) | `mg.nosytech.akaiky.enfant` | `enfant` | `enfant`, `enfant-*` | `versionCode` du bloc `enfant { }` |

- **Côté coque (natif)** : `capacitor.config.json` est commun aux deux variantes (`appId`
  racine `mg.nosytech.akaiky`). Au build, `android/app/build.gradle` (`OtaIdentityTask`,
  transformation des assets de chaque variante) y écrit `plugins.CapacitorUpdater.appId` =
  `applicationId` de la variante, `defaultChannel` = nom de la variante,
  `allowSetDefaultChannel: false`, `allowModifyAppId: false`, `statsUrl: ''` : le JavaScript
  ne peut ni changer de canal ni d'identité, et aucune statistique ne part. Seule exception
  du greffon : la réponse du serveur à `getChannel()` devient le canal par défaut retenu ;
  le serveur OTA ne doit donc jamais répondre un canal d'une autre app. Le build échoue si
  l'identifiant et la variante ne concordent pas, ou si le bloc `CapacitorUpdater` manque. iOS (parent seul) prend les valeurs parent de `capacitor.config.ts`.
  Un bundle parent arrivé par erreur sur la coque enfant ne change donc rien au canal
  que celle-ci demande ensuite.
- **Côté serveur (NAR-189)** : la réponse de mise à jour n'offre que les bundles dont
  la cible correspond à `app_id` (règle de préfixe de `src/lib/appKind.ts`) et au canal
  demandé, et dont `minNativeBuild` est ≤ `version_code` envoyé par le greffon. Il refuse
  un bundle dont la cible manque ou est mal formée. Détail : « Serveur OTA » ci-dessous.
- **Côté écran (défense en profondeur)** : la réponse porte `target: { app, channel,
  minNativeBuild }` à côté de `version` et `url`. Avant tout téléchargement, le runtime
  appelle `otaVerdict(target, await readShell())` (`src/lib/otaTarget.ts` ; identifiant et
  `versionCode` lus par `App.getInfo()`) et n'installe que sur `accept`. Tout autre verdict
  (`wrong-app`, `wrong-channel`, `native-too-old`, `invalid`, `unknown-shell`) : rien.
- Cas partagés : `tests/fixtures/ota-target-cases.json` (vitest `src/lib/otaTarget.test.ts`,
  JVM `OtaIdentityTest.kt`, qui lit les assets réellement embarqués par la variante testée ;
  serveur `server/test/ota.test.js`, contre la vraie route et la vraie base).

### Serveur OTA (NAR-189)

Auto-hébergé dans l'API, au format du greffon 8.54 (« updateUrl » et « channelUrl »
auto-hébergés). Routes publiques en lecture seule (`server/src/routes/ota.js`) : appelées par
le natif (OkHttp, URLSession), sans session, cookie ni origine, donc hors contrôle CSRF.
Rien n'est écrit ni journalisé de ce que l'appareil envoie (`device_id` compris).

| Route | Appel du greffon | Réponse |
|---|---|---|
| `POST /api/ota/latest` | `getLatest()` (`updateUrl`) | `{ version, url, checksum, target, data }` ; sinon `{ error: 'no_new_version_available', message }` (200) ; coque inconnue (`unknown_shell`) ou canal étranger à l'app (`wrong_channel`) : 400 |
| `PUT /api/ota/channel` | `getChannel()` (`channelUrl`) | `{ channel, status: 'default', allowSet: false }` : le canal demandé s'il appartient à l'app de `app_id`, sinon le canal de cette app ; identifiant étranger : 400, rien de gardé |
| `GET /api/ota/bundles/:id` | téléchargement de `url` | le zip (`application/zip`, pièce jointe, ETag = SHA-256) |

- `setChannel`, `unsetChannel`, `listChannels` ne sont pas servis (404) : les coques les
  désactivent, et le canal ne doit dépendre que de la coque.
- Le bundle proposé est le plus récent de **cette** app sur **ce** canal que la coque peut
  faire tourner (`min_native_build ≤ version_code`) : un bundle plus récent mais trop
  exigeant laisse passer le précédent. La ligne repasse par `otaVerdict` (copie serveur,
  `server/src/ota.js`) avant de partir. `version_name` égal à la version proposée : aucune.
- Corps validé avec `additionalProperties: false` : champs du greffon 8.54.2 (Android
  `createInfoObject`, iOS `InfoObject`) listés un à un ; un champ inconnu est un 400, donc
  aucune mise à jour. Une nouvelle version du greffon est une nouvelle coque : mettre à jour
  la liste (et le test « corps exact ») **avant** de livrer cette coque.
- Limites par IP : `OTA_RATE_LIMIT` vérifications par minute (60), `OTA_DOWNLOAD_RATE_LIMIT`
  téléchargements complets par 15 min (30) ; 429 + `Retry-After`, que le greffon respecte.
  `Cache-Control: no-store` partout (préfixe `/api/`).
- Stockage : table `ota_bundles` (024), zip en `bytea` (10 Mo au plus ; le bundle actuel fait
  ~270 Ko zippé), SHA-256 recalculé et contrôlé par la base, canal contraint à l'app. L'image ne
  garde aucun état et une publication ne doit pas exiger de redéploiement : le disque du
  conteneur est exclu, la base est sauvegardée. Quatre bundles au plus gardés en mémoire après
  leur première lecture (lignes immuables), quatre lectures de bundles différents au plus en même
  temps (503 au-delà) ; la limite de téléchargement est comptée avant la lecture en base.
  L'application n'a que `SELECT`.
- `target` : le greffon Android le transmet tel quel au JavaScript ; **le greffon iOS 8.54.2 ne
  le transmet pas** (`AppVersionDec` ne garde que ses champs connus). La réponse porte donc aussi
  la cible en chaînes dans `data` (`{ app, channel, minNativeBuild: "3" }`, NAR-191), champ libre
  que les deux greffons transmettent (iOS : dictionnaire de chaînes ; une valeur non textuelle y
  ferait échouer tout le décodage). Le runtime lit `data` sur les deux plateformes ; sur Android,
  `target` doit dire exactement la même chose, sinon refus. Cas partagés : `data` de
  `tests/fixtures/ota-target-cases.json` (`targetData` côté serveur, `targetFromData` à l'écran).
  `message` n'est pas utilisable : seul, il fait rejeter la réponse par le greffon iOS.
- Pas de chiffrement ni de signature des bundles (pas de `session_key`) : l'intégrité repose
  sur le SHA-256 vérifié par le greffon et sur le https. Limite : `HANDOFF.md`.

### Runtime de mise à jour (NAR-191)

`src/lib/otaUpdate.ts` (règles, testées avec le greffon simulé : `otaUpdate.test.ts`), branché par
`src/lib/otaRuntime.ts`, lancé par `main.ts` **après** `notifyAppReady()` et sans être attendu.

- **Barrière Capgo** : `updateUrl` est lu au build dans `capacitor.config.ts`
  (`vite.config.ts`, constante `__AKAIKY_OTA_UPDATE_URL__`), la même source que la configuration
  native écrite par `cap sync` (NAR-190 : l'origine de l'API). Le greffon n'a aucune méthode pour lire son `updateUrl`
  (`isAutoUpdateAvailable` ne la regarde pas). Rien n'est demandé au greffon si cette adresse n'est
  pas `https://<hôte>/api/ota/latest` (jamais `capgo.app`) ou `http://127.0.0.1:<port>/api/ota/latest`
  (test local par `adb reverse`, que seule la coque debug laisse passer en clair), ni un hôte
  `.invalid` (adresse provisoire) : zéro requête vers `capgo.app`. Un bundle OTA ne peut atteindre qu'une coque qui vise
  déjà ce serveur, donc constante et coque concordent.
- **Quand** : au démarrage et à chaque retour au premier plan, **au plus une vérification toutes
  les 6 heures** (comme l'APK enfant) : quatre requêtes par jour et par appareil au plus, un
  correctif arrive dans la journée, et un lancement répété ne coûte rien. Horloge reculée : pas
  bloqué. App enfant occupée : la tentative n'est pas consommée.
- **Refus** : tout ce qu'`otaVerdict` refuse (cible lue dans `data`), une empreinte qui n'est pas
  un SHA-256 hexadécimal minuscule (le greffon Android compare à l'identique), un zip qui ne vient
  pas du même serveur (`/api/ota/bundles/`), une version mal formée, déjà active ou déjà annulée
  une fois. Rien n'est alors téléchargé.
- **Téléchargement** : `download({ url, version, checksum })`, empreinte passée explicitement : le
  greffon refuse un zip sans empreinte et efface celui qui ne correspond pas (Android
  `CapgoUpdater.finishDownload`, iOS `resolveExpectedBundleChecksum`). **Tout réseau**, données
  mobiles comprises : `@capacitor/network` n'est pas installé (l'ajouter = nouvelle coque), le zip
  fait ~270 Ko, il n'est téléchargé qu'une fois par version, et le téléphone de l'enfant n'a souvent
  que des données mobiles (attendre le Wi-Fi = ne jamais se mettre à jour). Le greffon Android
  attend le zip sans délai maximal : au-delà de 10 min, la vérification est abandonnée (le verrou
  est rendu) ; un zip arrivé plus tard est repris comme déjà téléchargé.
- **Installation, sans jamais interrompre** :
  - app parent (Android, iOS) : `next()`. Le greffon 8.54.2 l'installe au **prochain passage en
    arrière-plan** (`installNext` d'`appMovedToBackground`, Android et iOS), pas au prochain
    démarrage à froid : l'utilisateur retrouve l'app rechargée sur la nouvelle version ;
  - app enfant : **jamais `next()`**, car ce passage en arrière-plan y est un appel (écran d'appel
    par-dessus) ou un SOS. Le bundle reste téléchargé ; 5 s après un passage en arrière-plan (écran
    éteint, app autorisée ouverte), si l'app est toujours derrière et au repos, l'écran l'installe
    par `set()` (« derrière » relu juste avant `set()`, jamais pendant une vérification). Au repos :
    ni l'écran (démarrage, SOS en cours de lancement, saisie du code parent) ni le natif
    (`AkaikyUpdate.status().busy` : SOS en cours, gardé ou en lancement, appel en cours ; illisible
    = occupé) ne disent occupé. Vérification et téléchargement suivent la même règle.
- **Retour arrière** : un bundle qui n'appelle pas `notifyAppReady()` à temps est annulé par le
  greffon (bundle précédent, sinon celui de la coque) ; sa version est retenue (`getFailedUpdate`,
  seule source : un bundle `error` de la liste peut n'être qu'un téléchargement raté, retenté à la
  vérification suivante) et plus jamais retéléchargée. « À temps » : `appReadyTimeout` (10 s), mais le
  greffon Android 8.54.2 accorde au moins 30 s au premier lancement d'un bundle
  (`PENDING_BUNDLE_APP_READY_MIN_TIMEOUT_MS`), et sur les deux plateformes le délai ne court qu'au
  premier plan (installé en arrière-plan : contrôle reporté au retour devant).
  Vérifié sur l'émulateur `kiosk34` (coque parent debug visant un serveur local par `adb reverse`) :
  bundle sans `notifyAppReady()` téléchargé, empreinte vérifiée, `next()`, installé au passage en
  arrière-plan, annulé 30 s après le retour au premier plan, coque rechargée, bundle effacé ; même
  bundle annoncé avec une fausse empreinte : « Checksum mismatch », rien de gardé ni d'installé.
- **Nettoyage** : à chaque vérification, tout bundle téléchargé qui n'est ni l'actuel ni celui qui
  attend est effacé (le greffon efface déjà le précédent après un succès et les échecs).

### Publier un OTA (procédure, une fois les coques de NAR-190 installées)

1. Vérifier le verdict : changement web seul (JS, CSS, templates, assets). Sinon : coque.
   Pas de bump de `package.json`.
2. `npm run build` (un seul bundle web pour les deux apps), puis zipper le **contenu** de
   `dist/web` (`index.html` à la racine) : `(cd dist/web && zip -qr ../../bundle.zip .)`.
3. Publier ce bundle **une fois par app et par canal**, avec le compte propriétaire de la base
   (comme `server/bin/migrate.js` ; jamais automatique) :
   `DATABASE_URL=<propriétaire> node server/bin/ota-publish.js --app <parent|enfant> --channel <canal> --min-native <versionCode> --version <version> bundle.zip`.
   Le script refuse une app inconnue, un canal qui n'est pas à l'app, une coque minimale qui
   n'est pas un entier ≥ 1, un fichier qui n'est pas un zip avec `index.html` à la racine, et
   une version déjà publiée sur ce canal ; il calcule le SHA-256. Retour arrière : republier
   l'ancien zip sous une nouvelle version (le plus récent l'emporte). Chaque app, sa cible :
   - parent : `app: parent`, canaux `parent` puis `parent-test` (tous les canaux actifs),
     `minNativeBuild` = plus petit `versionCode` parent installé qui a tous les greffons
     dont le bundle a besoin ; la même cible sert la coque iOS, comparée à son
     `CFBundleVersion` (`CURRENT_PROJECT_VERSION`, entier) : Android parent et iOS gardent
     donc un même numéro de build pour les mêmes greffons, sinon le plus bas des deux
     décide ;
   - enfant : `app: enfant`, canaux `enfant` puis `enfant-test`, `minNativeBuild` = même
     règle sur l'échelle `versionCode` enfant (bloc `enfant { }`).
   Ne jamais reprendre la coque minimale d'une app pour l'autre.
4. Un bundle qui appelle un greffon propre à l'enfant reste utile à l'app parent (l'écran
   enfant n'y est jamais montré) ; c'est la coque minimale qui protège, pas le contenu.

Deux règles de survie, elles, valent partout : publier chaque OTA sur **tous
les canaux** actifs de l'app visée, et ne jamais diffuser un bundle qui exige une coque
plus récente que celles réellement installées chez les utilisateurs.

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
