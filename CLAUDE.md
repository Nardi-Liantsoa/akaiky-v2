# Akaiky (akaiky-v2)

Relier les parents à leurs enfants : un téléphone Android verrouillé pour l'enfant
(appeler ses parents, être joint par eux seuls, SOS) et une application parent
Android/iOS pour appeler, recevoir les alertes et tout régler à distance.

- Cahier des charges : v0.1 du 16/11/2026 (Deploy4000, 1 mois), brouillon à valider.
- Maquettes : `docs/DESIGN.md` (jetons, 10 écrans, écarts avec le CdC). Toute interface
  suit ces jetons ; un écran sans maquette reprend leur langage.
- Critères de recette : `recette/criteres.md`.
- Nouveau départ, distinct de `~/labo2026/akaiky` (premier projet, laissé intact) :
  rien n'est copié de lui sans décision explicite.

Starter `app-propre-mobile` de create-nosy-app (@ 995f746) : Vue 3 + TypeScript,
Capacitor 8, Fastify 5 + PostgreSQL (JavaScript ESM, code repris de Deploy4000),
une image, une origine. Conventions : skills `ampy-auth` (back-end propre),
`ampy-api`, `ampy-vue`, `ampy-capacitor`, `ampy-push`, `ampy-carte`, `ampy-ship`,
`ampy-recette`.

## Contraintes

- **Rien ne sort sans ordre explicite** : repo GitHub, push, tag, déploiement, store,
  client NosyHost, projet Firebase/APNs attendent le « vas-y » de l'utilisateur.
- Données de mineurs et de géolocalisation : les plus sensibles qui soient. Aucun
  service tiers de stockage ni de cartographie qui verrait les positions ; hébergement
  en Europe (NosyHost).

## Décisions (cadrage du 17/11/2026)

- **Architecture : back-end propre** (API Fastify + PostgreSQL chez NosyHost, Europe).
  Pourquoi : données de mineurs et positions (une seule de ces réponses ferme la porte
  au BaaS), règles « gestionnaire ou contact » par famille (NosyBase n'a pas de OU),
  SOS, cascade et alertes à orchestrer côté serveur. NosyBase seul est exclu (CdC §7.1).
- **Deux applications, une base de code** :
  - Parent : `mg.nosytech.akaiky` (même identifiant que le premier projet, qu'il
    remplace pour la publication ; les deux builds ne cohabitent pas sur un téléphone),
    Android 8+ et iOS 16+, publiée sur les stores.
  - Enfant : `mg.nosytech.akaiky.enfant`, Android 8+ seulement, installée par le QR de
    provisionnement (Device Owner) qui télécharge l'APK depuis le serveur du projet,
    hors Play Store. Variante Android `enfant` posée par NAR-137 (`android/app/build.gradle`,
    `src/lib/appKind.ts`) ; l'appairage (NAR-138) s'appuie dessus.
  - Identifiants définitifs une fois publiés.
- **Module natif Android (Kotlin)** côté enfant : mode appareil dédié (Device Owner,
  lock task, lanceur par défaut, redémarrage dans l'app), filtrage des appels entrants
  (`CallScreeningService`), appels sortants, SMS, position. Chaque ajout natif =
  nouvelle coque (`ampy-capacitor`).
- **Authentification** : modèle Deploy4000 du starter (ne pas réécrire). Cookie pour
  le web, Bearer tourné pour les apps natives, refresh token dans le Keychain/Keystore
  via `@aparajita/capacitor-secure-storage` (maintenu au 17/11/2026).
- **Inscription** : ouverte au public (parent principal), par e-mail **ou** numéro de
  téléphone avec mot de passe (CdC §5.1). Le starter ne fait que l'e-mail ; le numéro
  (code SMS, « Connexion par téléphone » d'`ampy-auth`) se tranche dans son ticket.
- **Organisations : plusieurs** — chaque **famille** est une organisation (modèle
  « Plusieurs organisations » d'`ampy-auth`, posé AVANT la première table métier).
  Rôles : parent principal = `owner`, gestionnaire = `manager`, contact = `member`
  (appelle l'enfant et reçoit les SOS, ne modifie rien). Plusieurs enfants par famille.
- **Téléphone de l'enfant** : pas un compte utilisateur. Identifiant d'appareil émis à
  l'appairage (QR 15 min, usage unique), lié à une famille et à un enfant, révocable
  par un gestionnaire ou l'admin.
- **Administrateurs** (`users.is_admin`, posé par `server/bin/make-admin.js`, MFA
  obligatoire) : back-office web **sans accès aux positions ni aux journaux d'appels**.
- **Argent** : aucun en v1 (CdC §9).
- **Langues** : `mg`, `fr`, `en`, malgache par défaut ; catalogues typés (`ampy-vue`).
- **APK enfant (NAR-165, 18/11/2026)** : signé par un keystore hors dépôt
  (`~/.config/akaiky-v2/`), embarqué dans l'image et servi à `/downloads/akaiky-enfant.apk`.
  Somme du certificat : `Gg-Buz0ZeueZt6lby12Z4DwwXw43F_xwO0XBWYshbyU` (`NOSYHOST.md` § 6).
- **Mise à jour de l'APK enfant (NAR-170, 19/11/2026)** : `/api/device/config` annonce `apk: { versionCode, url, sha256 }`
  (`DEVICE_APK_VERSION_CODE`, exigé en production avec `DEVICE_APK_URL` ; SHA-256 calculé au démarrage sur l'APK
  embarqué, sinon `DEVICE_APK_SHA256` ; rien d'annoncé si l'empreinte de certificat, la version écrite par la
  release ou l'empreinte configurée ne concordent pas ; dans l'ETag). L'écran (`src/lib/apkUpdate.ts`) essaie quand la
  version est plus récente, sans SOS, une fois par 6 h, tout réseau ; le natif (`ApkUpdate.kt`, règles pures
  `ApkUpdatePolicy.kt`) refuse pendant un appel, vérifie SHA-256, paquet, version annoncée et strictement supérieure,
  certificat identique à l'installé, puis installe par `PackageInstaller` (Device Owner, sans confirmation).
  `DISALLOW_INSTALL_APPS` levée seulement de la création de session au résultat (fenêtre persistée, reposée par le
  résultat, une alarme de 5 min, tout démarrage du processus, `Kiosk.enforce`, redémarrage, remplacement du paquet) ;
  `DISALLOW_INSTALL_UNKNOWN_SOURCES` jamais levée. App rouverte après remplacement (lock task à la reprise).
  Limites : `HANDOFF.md`. Nouvelle coque enfant.
- **WebView minimal (NAR-161, 18/11/2026)** : 64, la cible Chrome du bundle (`import()`,
  `import.meta`). En dessous, écran de repli statique en trois langues
  (`public/webview.html`) qui demande la mise à jour d'« Android System WebView ».
  Pas de bundle pour Chrome 58–63 (Android 8.x jamais mis à jour) : il faudrait les
  chunks SystemJS que la CSP bloque.
- **Mode appareil dédié (NAR-167, 18/11/2026)** : armé par l'écran de l'enfant une fois
  appairé et le code parent connu ; levé seulement par le parent (code, puis « Libérer »). Lock task avec le composeur système et Telecom
  (sans eux, ni écran d'appel ni composeur d'urgence) ; sortie par le code parent, vérifié
  hors ligne, 15 minutes au plus, refermée par alarme et par redémarrage. Limites et
  sortie de secours : `HANDOFF.md`.
- **Filtrage des appels entrants (NAR-145, 18/11/2026)** : `CallScreeningService` (Android 10+),
  rôle `ROLE_CALL_SCREENING` confirmé une fois sur le téléphone (le Device Owner ne peut
  pas se l'accorder ; proposé avant le verrou ou pendant une sortie). Numéro reçu converti
  en E.164 et comparé exactement à la liste (jamais la comparaison souple d'Android, qui
  confond deux numéros aux 7 derniers chiffres égaux). Android 8–9 : NAR-172.
- **Appels sortants (NAR-169, 19/11/2026)** : tout appel composé sur le téléphone (composeur, « Ajouter
  un appel », autre app, SOS, `AkaikyCall.call`) passe par `CallPolicy.screenOutgoing` : filtrage inactif
  (pas appairé, libéré) → tout passe ; urgence → toujours, jamais bloquée ni retardée ; sinon seul un
  numéro de `IncomingCalls.reachable` (parents seuls pendant une plage), lu en E.164 au pays du réseau
  (Android 10+ : celui du compte qui appelle, `createForPhoneAccountHandle`) et comparé exactement.
  Urgence : saisie sans espaces/tirets/parenthèses faite de chiffres seuls (un « + » initial, « +112 », n'en
  est pas une : décision normale) dans la liste de l'app, ou `TelephonyManager.isEmergencyNumber` ; un `*` ou `#` n'est jamais une urgence.
  Android 10+ : `CallRedirectionService`, rôle `ROLE_CALL_REDIRECTION` (le Device Owner ne peut pas se
  l'accorder ; demandé par le même bouton que le filtrage des appels entrants) ; urgence et `voicemail:`
  (boîte de l'enfant) composés aussitôt, sans lecture ; sinon décision synchrone dans `onPlaceCall`
  (préférences en mémoire, lectures de `TelephonyManager` avec repli), une seule réponse, toujours pour
  l'appel en cours ; toute erreur annule l'appel. `sip:` refusé pendant le filtrage. Android 8–9 : récepteur `NEW_OUTGOING_CALL` (priorité 999 ; refus : `resultData` vidé et
  `abortBroadcast`), `PROCESS_OUTGOING_CALLS` accordée en Device Owner (`setAllowed`, `Kiosk.enforce`) ;
  récepteur désactivé à partir d'Android 10 (`values-v29/bools.xml`). Trou connu sur 8–9 :
  `NEW_OUTGOING_CALL` ne voit que les appels `tel:` ; un appel `sip:` (compte SIP configuré dans les
  réglages du composeur) n'est pas filtré, et aucune restriction `UserManager` du Device Owner n'interdit
  de configurer un compte SIP (seul `DISALLOW_OUTGOING_CALLS`, qui couperait tout). Documenté seulement. Bandeau de l'écran enfant : état
  réel lu par `screeningRole().outgoingActive` (rôle détenu sur 10+, récepteur actif et permission
  accordée sur 8–9). Refus : ligne de log sans numéro, rien au journal.
- **Plages « école » (NAR-148, 18/11/2026)** : calculées sur le téléphone, hors ligne, dans le
  fuseau de la famille (`families.timezone`, Madagascar par défaut, pas encore modifiable par
  l'API) ; pendant une plage, l'écran ne montre que les contacts liés à un `owner`/`manager`,
  le SOS (qui n'appelle alors que ces parents, sinon les secours) et les secours.
- **Appels pendant une plage (NAR-176, 19/11/2026)** : le natif (`SchoolSchedule.kt`, même règle
  que `src/lib/schedule.ts`, cas partagés `tests/fixtures/schedule-cases.json`) ne laisse sonner
  et n'appelle que les parents, écran éteint compris ; un contact non parent refusé est noté
  `call_blocked` avec son nom (« pendant une plage horaire »). Pas d'exception pour un numéro
  d'urgence présenté (falsifiable). Plages et parents reçus par `setAllowed` ; une modification
  faite par un parent n'arrive au téléphone qu'à sa prochaine reprise, comme les contacts.
- **SOS hors ligne (NAR-151, tranche 1, 19/11/2026)** : service natif au premier plan (`SosService.kt`,
  notification « SOS en cours », types `phoneCall|location`, Android 14 : `FOREGROUND_SERVICE_PHONE_CALL`/`_LOCATION`,
  `MANAGE_OWN_CALLS` prérequis du type `phoneCall`), lancé par `AkaikySos.start` (écran maintenu 3 s) ; écran éteint compris.
  `START_REDELIVER_INTENT` : processus tué, le SOS reprend où il en était, avancement gardé dans les préférences
  privées (étapes, état des SMS et de la cascade, heure de l'appel en cours ; **jamais de numéro ni de position**).
  Règle pure partagée `src/lib/sosCascade.ts` / `SosCascade.kt`, cas communs `tests/fixtures/sos-cascade-cases.json`.
  SMS (SmsManager multipart, sans données) aux contacts `parent` de la liste native, sinon à tous, plage « école »
  comprise (un SMS ne fait sonner personne) ; texte traduit par l'écran (≤ 160 caractères GSM 7 bits : « ~ » et
  apostrophe droite, jamais « ± » ni « ’ ») ; position = dernière connue (GPS/réseau, < 2 min et ≤ 100 m) sinon relevé
  de 10 s au plus, `geo:lat,lon` à 5 décimales ; **la position ne part que dans le SMS, jamais vers le serveur ni dans
  les journaux** (ni numéro). Résultat d'envoi suivi par contact (`PendingIntent`). Cascade : parents puis autres dans
  l'ordre, pendant une plage les seuls parents, puis composeur des secours prérempli (Android interdit l'appel direct
  d'un numéro d'urgence : l'enfant appuie sur « Appeler ») ; arrêt au premier décroché, à « Annuler », quand un contact
  appelle le téléphone, ou sur « Appeler les secours » (appel en cours coupé). Appel entrant pendant le SOS : il ne
  prend le relais que si le numéro est joignable (`IncomingCalls.reachable`, ou laissé sonner par le filtre dans les
  15 s) ; un inconnu est ignoré, la cascade continue. Numéros appelés revérifiés contre la même liste native.
  Sirène (`children.sos_siren`) : ton synthétisé (aucun fichier), flux alarme au maximum (volume rendu ensuite), en
  pause pendant tout appel, arrêtée au décroché, à l'annulation ou à 2 min (maintenue sur le composeur des secours).
  Permissions d'exécution (SMS, position, état du téléphone, journal d'appels, `ANSWER_PHONE_CALLS`, notifications)
  accordées d'office en Device Owner (`setPermissionGrantState`) ; `SEND_SMS` et `READ_CALL_LOG` sont des permissions
  « restreintes » (accordées sur l'émulateur installé par adb) : **à vérifier sur un téléphone provisionné par QR**.
  **Limite de détection du décroché** : sans être l'app téléphone par défaut, Android ne signale pour un appel sortant
  que « en ligne » (dès la composition) puis « raccroché » (`READ_PRECISE_PHONE_STATE` est réservée au système). Donc :
  appel coupé après 25 s en ligne (`TelecomManager.endCall`, Android 9+ ; sur Android 8 l'appel finit par le réseau),
  décroché = au moins 8 s connectées d'après le journal d'appels lu après la fin ; **journal illisible ou muet : appel
  non décroché**, la cascade continue (contact suivant, puis secours ; aucune estimation par le temps « en ligne » ; après la mort du processus, journal muet : le même contact est rappelé).
  Décroché (journal) puis coupé par nous = le même contact rappelé une fois sans coupure. Une messagerie qui décroche
  plus de 8 s compte comme « décroché ».
  **Jamais un appel lancé tant qu'un autre peut être en ligne** (`SosCascade.lineFree`) : `isInCall` lisible et vrai,
  attente sans limite (relancée à `CALL_STATE_IDLE`) ; illisible (jamais pris pour « libre »), un appel que `endCall`
  n'a pas coupé n'est fini qu'à l'apparition de son entrée au journal d'appels (sortant, même numéro, après son
  lancement), 30 min au plus ; sirène en pause pendant cette attente. **Jamais deux SOS à la fois** : `start` refuse
  (`already`) un SOS en cours, un lancement non confirmé (marqué avant `startForegroundService`, 5 s au plus) ou un SOS
  gardé à reprendre ; le service refuse un autre `runId` pendant un SOS en cours (jamais redistribué). Repli de l'écran
  après 5 s sans confirmation : `cancel({ runId, fallback: true })` attendu 1,5 s au plus, puis l'appel direct ; le
  service ne lance jamais ce `runId`, ni un lancement reçu plus de 4 s après la demande (`requestedAt`). SOS gardé sans
  service ni signe de vie depuis 2 min (écrit toutes les 30 s), ou au redémarrage (`BOOT_COMPLETED`) : effacé, jamais
  rejoué, état `interrupted` (« SOS interrompu », à relancer), jamais montré en cours ; l'écran relit l'état toutes les 15 s.
  Hors périmètre (NAR-181) : arrêt par prise en charge d'un parent, journal du SOS envoyé au serveur.
- **Applications autorisées (NAR-143, 19/11/2026)** : inventaire envoyé par le téléphone (`PUT /api/device/apps`,
  paquet, nom, icône PNG 48 px ≤ 4 Ko ; aucune donnée d'usage ; envoyé quand son empreinte change), 4 applications au
  plus choisies par un `owner`/`manager` parmi l'inventaire de l'enfant, reçues dans `allowedApps` de `/api/device/config`.
  **Liste protégée unique** `server/src/protected-apps.json` (comparée par `AppsPolicyTest.kt` à `AppsPolicy.kt`) : l'app
  elle-même (`mg.nosytech.akaiky*`), `neverHide` (appels, Telecom, SMS du SOS, contacts, interface système, réglages ouverts
  pendant une sortie, lanceurs, claviers, installation, services Google, WebView) et `browsers` (**navigateurs bloqués en
  v1**, Google Search compris) ; le natif y ajoute à l'exécution composeur et SMS par défaut, claviers activés, fournisseur
  WebView (Chrome sur Android 8/9 : jamais caché), lanceurs et tout ce qui ouvre un lien http(s), applications cachées ou
  désactivées comprises ; tout navigateur vu un jour est gardé (préférences du verrou) et part marqué `browser: true` dans
  l'inventaire : le serveur ne le montre pas et refuse de l'autoriser (`protected_app`) s'il est marqué par un téléphone non
  révoqué de l'enfant. Protégé = jamais montré au parent ni autorisable. **Cache** (`setApplicationHidden`, Device Owner, téléphone armé seulement) : toute application
  lançable non autorisée hors `neverHide` (navigateurs compris), découvertes au choix d'une liste et à l'armement ; les
  applications cachées restent listées (le parent peut les autoriser) ; toutes rendues à la libération (`disarm`, sur un fil
  à part). Cacher et tout rendre sous un même verrou, « armé » relu avant chaque application cachée. Une recherche de
  protection en échec (composeur, SMS, claviers, lanceur, WebView) : rien n'est caché à ce passage, noté au journal.
  Session perdue ou remplacée : liste native vidée (`applyAllowedApps([])`, liste autorisée oubliée aussi tout de suite
  au `disarm`, avant la file de libération). Lock task = liste de base ∪ autorisées, **base seule pendant une plage
  « école »** (app et composeur toujours ; relu par `enforce` à la reprise, aux plages reçues par `setAllowed`, à chaque
  `launchApp` refusé et `bringToFront`, et par `refresh()` au début et à la fin de plage vus par l'écran) (Réglages et
  SMS jamais dedans : `neverHide` ≠ lock task) ; `launchApp` n'ouvre qu'une application autorisée, et aucune pendant une
  plage ; pendant la plage, tant que l'app n'est pas devant, l'écran demande `bringToFront()` à chaque tour de son
  minuteur de 60 s jusqu'à `brought: true` (natif : armé, verrouillé, plage active, pas d'appel en cours ;
  `src/lib/schoolFront.ts`). Ce minuteur n'est pas arrêté en arrière-plan, mais il vit dans la WebView : Android peut
  la ralentir ou la suspendre, aucun tour n'est garanti avant la reprise. Liste, cacher et armement sur le fil propre
  d'`AllowedApps` (jamais le fil partagé des plugins : SOS, appels). Autorisée devenue protégée : `blocked: true` dans
  `GET /api/children/:id/apps`, « bloquée » sur la carte, retirable ; refus nommant le paquet (`package`), écartée de la
  rangée de l'écran. Limites : `HANDOFF.md`. Nouvelle coque enfant.
- **OTA, une app un canal (NAR-162, 20/11/2026)** : bundle web commun, publié une fois par app avec sa
  cible `target: { app, channel, minNativeBuild }` ; canaux `parent`/`parent-*` et `enfant`/`enfant-*` ;
  coque minimale comparée au `versionCode` de l'app visée (échelles indépendantes). L'app se reconnaît par sa
  coque, jamais par le bundle : `OtaIdentityTask` (`android/app/build.gradle`) écrit dans les assets de chaque
  variante `CapacitorUpdater.appId` = `applicationId`, `defaultChannel` = variante, canal et identifiant non
  modifiables par le JavaScript ; iOS (parent) par `capacitor.config.ts`. Statistiques Capgo coupées
  (`statsUrl: ''`). Écran : `otaVerdict` (`src/lib/otaTarget.ts`) refuse toute cible d'une autre app, d'un
  autre canal, mal formée ou au-dessus de la coque ; le serveur OTA (pas encore construit, ni Capgo Cloud)
  fera le même tri (`tests/fixtures/ota-target-cases.json`, aussi lu par `OtaIdentityTest.kt`).
  Procédure : `docs/MOBILE.md`. Nouvelle coque parent et enfant.
- **Serveur OTA auto-hébergé (NAR-189, 20/11/2026)** : dans l'API, au format du greffon 8.54 :
  `POST /api/ota/latest` (`updateUrl`), `PUT /api/ota/channel` (`channelUrl`, toujours un canal de l'app de
  `app_id`), `GET /api/ota/bundles/:id` (zip). Publiques, lecture seule, hors session et hors CSRF (appel natif
  sans origine). Corps du greffon validé champ par champ, inconnu → 400 (pas de mise à jour) : la liste suit la
  version du greffon, donc la coque. Même règle que `otaVerdict` (`server/src/ota.js`, testée sur les cas
  partagés). Zips en `bytea` dans `ota_bundles` (10 Mo au plus, ~270 Ko aujourd'hui) plutôt que sur disque :
  l'image ne garde aucun état et une publication ne redéploie rien. Publication par `server/bin/ota-publish.js`
  (compte propriétaire, à la main). Limites `OTA_RATE_LIMIT`, `OTA_DOWNLOAD_RATE_LIMIT`. Pas encore visé par les
  coques (`updateUrl`/`channelUrl` à régler : nouvelle coque) ; pas de signature de bundle (SHA-256 + https).
- **Hors connexion** : appels et SOS par SMS sans Internet (natif enfant). L'app
  parent démarre hors ligne et le dit, sans déconnecter.
- **Notifications** : FCM (Android) et APNs (iOS), comptes au nom du client. Alertes
  critiques iOS : autorisation Apple à demander dès le début (délai incertain).
- **Rétention (NAR-153, 19/11/2026)** : fonction `purge_expired()` (`server/src/migrations/016_retention.sql`,
  SECURITY DEFINER, durées fixées dans la base) lancée par `server/src/jobs.js` au démarrage puis
  toutes les heures ; un tour au plus toutes les 20 h, une seule instance (verrou + `job_runs`).
  Journal du téléphone (compté depuis sa réception par le serveur) et messages rapides 90 jours ;
  audit 1 an, IP effacée à 90 jours ; sessions 30 jours après la fin de tout renouvellement (rejeu
  détecté), jetons dès leur expiration. Client dédié (délai de 10 min) ; l'arrêt attend le tour
  en cours. Le rôle applicatif ne fait que l'exécuter (aucun DELETE sur les journaux). Positions 30 jours : à ajouter avec leur table (NAR-146, C20). Suppression du compte
  et de la famille : immédiate, NAR-177 (C21). Chiffrement des données sensibles en base.
- **Export et consentement (NAR-178, 19/11/2026)** : `GET /api/families/me/export` (`server/src/routes/export.js`),
  `owner`/`manager`, 5 par heure et par compte, audité `family_exported` ; JSON construit champ par champ,
  champs chiffrés ouverts, jamais de hachage, jeton, index aveugle, identifiant de compte, audit ni IP ;
  adresse du seul demandeur. Consentement exigé à l'inscription (`consent`) et à l'ajout d'un enfant
  (`parentalConsent`), dates gardées (`018_consent.sql`, comptes antérieurs à NULL). Politique de
  confidentialité : brouillon `docs/confidentialite.md`, à valider avec le client.
- **Notifications push, serveur (NAR-141, 19/11/2026)** : FCM HTTP v1 en direct (Android, et iOS par la
  clé APNs `.p8` déposée dans Firebase), sans intermédiaire ni dépendance (`server/src/push.js` : JWT RS256
  du compte de service signé par `node:crypto`). Comptes Firebase et Apple **au nom du client** ; leur
  création attend l'ordre de l'utilisateur. La clé API Firebase des configurations client
  (`google-services.json`, `GoogleService-Info.plist`) est à **restreindre dans la console Google Cloud**
  (action de l'utilisateur, à faire ou ordonner). `PUSH_PROVIDER` = `fcm`, `none` ou `fake` (défaut hors
  production, refusé en production ; choix explicite exigé en production). Événements : `message` (« Fy a
  envoyé un message », prénom seul), `test`, état du téléphone (NAR-147) ; `config` silencieux (réveil du téléphone, pas encore branché).
  Textes MG/FR/EN côté serveur (`server/src/push-texts.js`), `data` = `{ type, id }`, canal Android `alertes`.
  File `push_outbox` (worker de `jobs.js` toutes les 10 s, tentatives en base, 30 s × 2^n, abandon à 5),
  30 par heure et par compte (tous ses jetons confondus, sous verrou consultatif par compte), 30 par heure
  et par téléphone d'enfant. Jeton supprimé seulement sur `UNREGISTERED` ou `INVALID_ARGUMENT` qui nomme
  le jeton ; `SENDER_ID_MISMATCH`, 404 sans `UNREGISTERED`, 401/403 = configuration (nouvelle tentative,
  alarme dans les journaux). `last_seen_at` du jeton rafraîchi par l'activité de sa session (au plus une
  fois par heure). Côté app (plugin, permission, toucher) : NAR-179, nouvelle coque.
- **État du téléphone (NAR-147, 19/11/2026)** : seuils batterie 15 % (ouverture, hors charge) et 20 %
  (fermeture ; la charge seule ne ferme pas), pas de nouvelle alerte batterie moins de 60 min après la
  fermeture de la précédente sur le même téléphone ; silence après 60 min sans signal (veille toutes les
  5 min ; jamais pour un téléphone qui n'a encore rien envoyé), signal toutes les 15 min au premier plan,
  envoyé même si le relevé natif échoue (batterie et charge `null`, réseau et carte SIM `unknown`).
  Push `battery_low`, `sim_absent`, `silent` (prénom seul, `data` = `{ type, id: enfant }`) à l'ouverture
  seulement, jamais à la fermeture. **Alerte « silence » inactive tant que NAR-180 n'est pas livré** :
  seuls les téléphones dont un signal a porté `background: true` (`child_devices.background_status`, qui ne
  repasse jamais à faux par un signal ; seul un réappairage, nouvelle ligne, repart à faux) sont surveillés ; l'app JS au premier plan ne l'envoie pas (faux), pour éviter une fausse alerte à
  chaque fois que l'enfant quitte l'app. Elle s'active quand le signal natif en arrière-plan de NAR-180
  envoie `background: true`. Surveillance en arrière-plan et état réel de la carte SIM : natif, NAR-180
  (nouvelle coque), livrés.
- **Signal en arrière-plan (NAR-180, 19/11/2026)** : natif (`BackgroundStatus.kt`), écran éteint et WebView
  endormie : WorkManager périodique de 15 min (minimum Android, réseau exigé, survit au redémarrage) ; tâche
  unique immédiate quand la batterie passe sous 15 % ou que la carte SIM change (règles de
  `src/lib/heartbeat.ts`, `BackgroundStatusPolicy.kt` ; marge de 2 min sur la période, envoi dû dès
  13 min ; carte SIM « unknown » jamais comparée ; même changement de carte SIM répété en moins de
  2 min sans envoi immédiat) ; cœur testable sur la JVM (`StatusRunner.kt` : envoi sous verrou,
  `isEnabled` relu avant l'envoi et avant d'en noter le succès, arrêt qui attend l'envoi en cours) ; hors ligne, une seule place en attente, le dernier
  relevé (`StatusQueue.kt`). `BATTERY_LOW`/`BATTERY_CHANGED` et `SIM_STATE_CHANGED` ne sont pas exemptées
  des restrictions d'Android 8 : écoutées à l'exécution sur le contexte de l'application (le processus du
  lanceur en lock task vit) ; manifeste : `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `CARRIER_CONFIG_CHANGED`
  (exemptées). Carte SIM : `TelephonyManager.getSimState`, aussi dans `AkaikyDevice.getStatus` (signal de
  premier plan). Lancé par l'écran à chaque état « appairé » (`src/lib/backgroundStatus.ts` →
  `AkaikyBackground.startBackgroundStatus({ apiBase, token })`, adresse `API_BASE`, https seulement),
  arrêté à l'état sans session (attente, expiré, retiré) et à la libération ; un jeton refusé (401)
  l'arrête aussi. Pas de GPS.
- **Authentification du natif (NAR-180, revue du 19/11/2026)** : **jeton « signal de vie » dédié**, jamais la
  session d'appareil. Partager le jeton de renouvellement entre l'écran et le natif (verrou, rotation) a été
  écarté : deux renouvellements croisés font voir un rejeu au serveur, qui ferme la session, ou font
  oublier à l'écran une session valable. `child_devices.heartbeat_token_hash` (SHA-256, 256 bits, un par
  téléphone, `021_heartbeat_tokens.sql`) ; `POST /api/device/heartbeat-token` (session d'appareil, 10 par
  heure et par téléphone, audité `device_heartbeat_token`) en émet un nouveau, rendu une fois, qui remplace
  le précédent. Il n'ouvre **que** `POST /api/device/heartbeat` (`Authorization: Heartbeat <jeton>`, route
  marquée `config.heartbeat`, téléphone non révoqué, accepté sans origine car envoyé hors WebView, jamais
  avec une origine non native) ; refusé partout ailleurs, y compris en `Bearer`. Révocation : `revoked_at`
  suffit, l'empreinte est aussi effacée. Natif : jeton chiffré au repos par une clé Keystore AES-GCM propre
  (alias `akaiky-heartbeat-token`, `HeartbeatToken.kt`), aucune dépendance de plus. 401 → arrêt et
  `needsToken` ; jeton absent ou illisible → rien n'est envoyé, nouvel essai à la période suivante,
  `needsToken` ; l'écran en émet un autre une fois par lancement ou quand `status()` le demande.
- **Domaine** : inconnu. Provisoire `akaiky.a-definir.invalid` (`.env.example`,
  `NOSYHOST.md`, `server/src/config.js`, `src/api/transport-native.ts`, `docs/MOBILE.md`).
- **Noms techniques** : image, paquet npm et client NosyHost s'appellent `akaiky-v2` /
  `akaiky_v2` ; le nom affiché est « Akaiky ».

## Ressources : propriétaire et règle par opération

| Table | Propriétaire | Lecture | Création | Modification | Suppression |
|---|---|---|---|---|---|
| `families` | `memberships` (rôle relu en base à chaque requête) | membres (`GET /api/families/me`) ; export complet `owner`/`manager` (`GET /api/families/me/export`, NAR-178) | toute session sans famille, qui devient `owner` (une famille par compte en v1) | `owner`, `manager` (nom) | `owner` seul (`DELETE /api/families/me`, mot de passe redemandé par la garde de connexion, rôle vérifié avant le corps ; NAR-177) : cascade vers adhésions, invitations, enfants et tout ce qui en dépend, téléphones déconnectés ; autres membres prévenus par e-mail ; le compte de l'owner reste ; `DELETE` accordé au rôle applicatif (017) |
| `users` | le compte lui-même | lui-même (`/api/auth/me`) ; nom pour les membres de sa famille | inscription publique (`consent: true` exigé, vérifié avant la branche « adresse déjà prise » : 400 `consent_required` identique ; `consent_at` gardé, NAR-178) | lui-même (nom, mot de passe) | lui-même (`DELETE /api/auth/me`, NAR-177) |
| `memberships` | `family_id` | membres de la même famille (nom et rôle, sans adresse) | création de famille (`owner`) ; acceptation d'une invitation (rôle de l'invitation) | `owner` : tout rôle ; `manager` : entre `manager` et `member`, jamais un `owner` ; dernier `owner` jamais rétrogradé (`UPDATE (role)` seul accordé) | chacun peut partir ; `owner` retire tout membre, `manager` un `manager`/`member` ; dernier `owner` protégé ; cascade depuis `families` et `users` (suppression de son compte, `DELETE /api/auth/me`, mot de passe redemandé ; refusée à un `owner`, 409 `owner_must_transfer_or_delete`, et au dernier administrateur, 409 `last_admin` ; invitations reçues à son adresse toutes effacées ; `DELETE` sur `users` accordé, 017) |
| `children` (prénom chiffré AES-256-GCM, `DATA_ENCRYPTION_KEY`, données associées `children:first_name:<id>` ; numéro de l'enfant `phone_enc` facultatif, E.164 chiffré, données associées `children:phone:<id>`, sans index aveugle, NAR-194) | `family_id` (adhésion de la session ; chaque requête filtre `id` **et** `family_id`) | membres (numéro compris : un contact appelle aussi l'enfant, bouton « Antsoy » de l'accueil ; jamais envoyé au téléphone de l'enfant) ; export | `owner`, `manager` (20 par famille, sous verrou ; `parentalConsent: true` exigé, sinon 400 `consent_required` ; `consent_at` et `consent_by` gardés, NAR-178) | `owner`, `manager` (prénom, couleur, numéro `phone` par `PATCH /api/children/:id` ou à l'ajout : normalisé comme un contact, 400 `invalid_phone`, `null` l'efface, validé après le rôle (member 403 quel que soit le numéro), autre famille 404, `UPDATE (phone_enc)` seul accordé, `025_child_phone.sql` ; sirène du SOS `sos_siren` par `PUT /api/children/:id/sos-siren` `{ enabled }`, member 403 quel que soit le corps, autre famille 404, audité `sos_siren_set`, valeur inchangée sans écriture ni audit, `config_version` avancée par déclencheur, lue par le téléphone dans `sosSiren` de `/api/device/config`, NAR-151 ; code parent par `PUT /api/children/:id/parent-code` ; déverrouillage à distance de 15 min par `POST /api/children/:id/unlock`, audité, refusé sans code ; jamais la famille) | `owner`, `manager` ; cascade depuis `families` |
| `allowed_contacts` (nom et numéro E.164 chiffrés, index aveugle HMAC du numéro ; 6 par enfant, ordonnés) | `family_id` + `child_id` (clé étrangère composite vers l'enfant de la même famille ; membre lié aussi de la même famille) | membres | `owner`, `manager` (enfant verrouillé : plafond et ordre justes ; numéro unique par enfant) | `owner`, `manager` (nom, numéro, couleur, membre lié, ordre ; jamais l'enfant ni la famille) | `owner`, `manager` (positions recomptées) ; cascade depuis l'enfant ; lien au membre effacé s'il quitte la famille |
| `invitations` (jeton haché, adresse invitée, rôle `manager`/`member`, 7 jours) | `family_id` (lu sur l'adhésion de la session) | `owner`, `manager` (en attente et encore acceptables, avec adresse) | `owner`, `manager` (10 en attente par famille ; une par adresse : la nouvelle remplace l'ancienne une fois son courriel parti ; enregistrée, puis envoyée hors transaction, supprimée si l'envoi échoue) | acceptation par le seul compte de l'adresse invitée, invitant encore gestionnaire, jeton consommé une fois (`UPDATE (used_at)` seul) | `owner`, `manager` (annulation) ; invitations d'un gestionnaire retiré ou rétrogradé ; cascade depuis `families` |
| `pairing_tokens` (jeton d'appairage haché, 15 min, usage unique ; porté par le QR) | `family_id` + `child_id` (clé étrangère composite vers l'enfant ; famille lue sur l'adhésion de la session) | — (jamais relu par l'API, sinon pour l'échange) | `owner`, `manager` (un seul valable par enfant : le nouveau remplace les précédents) | échange par le téléphone : `used_at` posé atomiquement, une seule fois (`UPDATE (used_at)` seul) | remplacement par un nouveau QR ; cascade depuis l'enfant |
| `child_devices` (téléphone appairé : modèle, versions ; 3 actifs par enfant ; derniers relevés batterie, réseau, carte SIM, NAR-147) | `family_id` + `child_id` (clé étrangère composite) | membres (`GET /api/children/:id/devices` ; relevés par `GET /api/children/:id/status`) ; le téléphone lui-même (`/api/device/me`) | échange d'un jeton d'appairage valable (`POST /api/device/pair`, enfant verrouillé) | `owner`, `manager` : révocation (`revoked_at`, sessions et jetons push effacés, alertes fermées) ; le téléphone : `last_seen_at` (toute requête, au plus une fois par minute) et ses relevés `battery_pct`, `charging`, `network`, `sim_state`, `background_status` (signal natif en arrière-plan, NAR-180), `status_at` (dernier signal, `POST /api/device/heartbeat`, 5 par 5 min ; NULL tant qu'aucun signal ; NAR-147) ; `heartbeat_token_hash` (jeton « signal de vie » du natif, NAR-180 : émis et remplacé par `POST /api/device/heartbeat-token`, session d'appareil, 10/h ; n'ouvre que le signal ; effacé à la révocation ; `UPDATE (heartbeat_token_hash)` seul) | cascade depuis l'enfant ; aucun DELETE accordé au rôle applicatif |
| `device_alerts` (alertes du téléphone : `battery_low`, `sim_absent`, `silent` ; ouverte puis fermée, une seule ouverte par téléphone et par type ; NAR-147) | `family_id` + `child_id` (clé étrangère composite) + `device_id` (lus sur la session d'appareil ou la ligne du téléphone) | membres, alertes ouvertes des téléphones actifs (`GET /api/children/:id/status`, autre famille → 404) ; jamais l'admin | le signal du téléphone (batterie < 15 % hors charge, carte SIM absente) ; la veille « silence » de `jobs.js` (signal vieux de 60 min d'un téléphone surveillé en arrière-plan, `background_status`, sous verrou consultatif) ; famille prévenue une fois, à l'ouverture (`notifyFamily`) | fermeture seule (`UPDATE (closed_at)`) : batterie ≥ 20 % (la charge seule ne ferme pas ; pas de réouverture batterie dans les 60 min), carte SIM prête, tout signal (silence) ; révocation du téléphone | purge 90 jours après la fermeture (`purge_expired()`, 020 ; aucun DELETE accordé) ; cascade depuis le téléphone et l'enfant |
| `device_sessions` (sessions du téléphone : accès court, renouvellement tourné, rejeu détecté) | `device_id` | le hook de session des seules routes `/api/device/*` | appairage | renouvellement (`/api/device/refresh`), jamais l'appareil d'une session | révocation de l'appareil ; rejeu ; cascade ; purge 30 jours après la fin du renouvellement (`purge_expired()`, NAR-153) |
| `device_events` (journal du téléphone : appels sortants et reçus, nom et numéro du contact chiffrés, durée ; appels bloqués, numéro d'un tiers chiffré et index aveugle, absent si masqué, ou contact non parent pendant une plage « école » avec son nom, si le numéro est bien le sien (NAR-176) ; déverrouillages, origine `code` ou `remote` et durée ; 90 jours, purge NAR-153) | `family_id` + `child_id` (lus sur la session d'appareil, jamais envoyés par le téléphone) | membres (`GET /api/children/:id/calls`, pages de 50 par curseur ; journal parent, NAR-152) ; jamais l'admin | le téléphone (`POST /api/device/events`, 60 lots/min) : contact d'un autre enfant refusé, contact retiré accepté avec l'instantané (nom, numéro composé), identifiant choisi par le téléphone (idempotence) | — (ajout seul : aucun UPDATE accordé) | purge à 90 jours (`purge_expired()`, NAR-153 ; aucun DELETE accordé) ; cascade depuis l'enfant ; contact retiré → `contact_id` effacé, instantané gardé |
| `quick_messages` (message rapide de l'enfant : emplacement 1 à 4, date ; texte chiffré du modèle en vigueur à la réception, null = défaut ; aucun texte libre venu du téléphone ; 90 jours) | `family_id` + `child_id` (lus sur la session d'appareil, jamais envoyés par le téléphone) | membres (`GET /api/children/:id/messages`) ; le téléphone, ses messages des dernières 24 h (`GET /api/device/messages`) | le téléphone (`POST /api/device/messages`, 30/min, identifiant choisi par le téléphone : idempotence ; identifiant d'un autre enfant → 409) | — (ajout seul) | purge à 90 jours (`purge_expired()`, NAR-153) ; cascade depuis l'enfant |
| `quick_message_reads` (« vu par ») | `user_id` + message de sa famille | membres (noms affichés : contact lié s'il existe, sinon nom du compte ; jamais d'identifiant ni d'adresse vers le téléphone) | membre de la famille du message (`POST /api/messages/:id/read`, idempotent ; autre famille → 404) | — | cascade depuis le message et le compte |
| `quick_message_templates` (texte des 4 messages rapides d'un enfant, chiffré, données associées `quick_message_templates:text:<enfant>:<emplacement>` ; ligne absente = texte par défaut traduit ; NAR-173) | `family_id` + `child_id` (clé étrangère composite) | membres (`GET /api/children/:id/message-templates`) ; le téléphone de cet enfant (`messageTexts` de `/api/device/config`) | `owner`, `manager` (`PUT …/message-templates/:slot`, 1 à 40 caractères ; droits vérifiés avant le contenu ; enfant verrouillé) | idem (texte inchangé : ni écriture ni audit) ; toute écriture fait avancer `config_version` | `owner`, `manager` (texte `null` = défaut) ; cascade depuis l'enfant |
| `schedules` (plages « école » : nom chiffré, données associées `schedules:label:<id>` ; jours en masque lundi = bit 0, début et fin en minutes, fin ≤ début = traverse minuit ; 10 par enfant ; NAR-148) | `family_id` + `child_id` (clé étrangère composite ; chaque requête filtre aussi l'enfant) | membres (`GET /api/children/:id/schedules`) ; le téléphone de cet enfant, plages actives seulement, avec le fuseau `families.timezone` et l'indicateur `parent` des contacts (`/api/device/config`) | `owner`, `manager` (droits avant le contenu ; enfant verrouillé) | `owner`, `manager` (remplacement complet, `enabled` exigé) ; toute écriture, un changement de rôle d'un membre lié à un contact et un changement de fuseau font avancer `config_version` | `owner`, `manager` ; cascade depuis l'enfant |
| `device_apps` (inventaire d'un téléphone : paquet, nom chiffré, données associées `device_apps:label:<téléphone>:<paquet>`, icône PNG ≤ 4 Ko ; `browser` (navigateur vu par le téléphone) ; 150 au plus ; aucune donnée d'usage ; NAR-143) | `device_id` + `family_id` (lus sur la session d'appareil) | membres, téléphones non révoqués de l'enfant, sans doublon, paquet protégé ni marqué `browser` (`GET /api/children/:id/apps`, autre famille → 404) ; jamais exporté | le téléphone pour lui-même (`PUT /api/device/apps`, remplacement complet, champ inconnu → 400, 6 envois valables par heure, corps de 1 Mo) | — (suppression puis ajout ; aucun UPDATE accordé) | remplacement ; révocation du téléphone ; cascade depuis le téléphone et la famille |
| `allowed_apps` (applications autorisées d'un enfant : paquet, nom copié de l'inventaire et chiffré, `allowed_apps:label:<enfant>:<paquet>`, position 1 à 4 ; NAR-143) | `family_id` + `child_id` (clé étrangère composite) | membres (`GET /api/children/:id/apps`) ; le téléphone de cet enfant (`allowedApps` de `/api/device/config`, paquet, nom, position) ; export | `owner`, `manager` (`PUT /api/children/:id/allowed-apps` `{ packages }`, liste ordonnée complète ; member 403 quel que soit le corps, autre famille 404 ; chaque paquet dans l'inventaire de CET enfant, jamais protégé ; enfant verrouillé ; audité `allowed_apps_set` avec le seul nombre) | idem (liste inchangée : ni écriture ni audit) ; toute écriture fait avancer `config_version` | idem (liste vide) ; cascade depuis l'enfant |
| `push_tokens` (jeton FCM chiffré, données associées `push_tokens:token:<id>`, index aveugle HMAC unique ; plateforme, langue ; NAR-141) | la session qui l'envoie : session de compte (`session_id`) **ou** téléphone et sa famille (`device_id` + `family_id`, clé étrangère composite) ; jamais un compte nommé par le client | jamais relu par l'API (le worker seul le déchiffre pour l'envoyer) | `PUT /api/push/token` (session de compte, cookie ou Bearer) ; `PUT /api/device/push/token` (téléphone, Android) ; champ inconnu → 400 ; jeton connu ailleurs → l'ancienne ligne et sa file sont supprimées puis il est recréé (jamais dupliqué) ; un seul jeton par session ou téléphone | plateforme, langue, `last_seen_at` à chaque enregistrement (`UPDATE (platform, lang, last_seen_at)` seul) | `DELETE /api/push/token` ou `/api/device/push/token` (jeton de CETTE session, sinon 404) ; cascade depuis `sessions` (déconnexion web et native, révocation, réinitialisation du mot de passe, suppression du compte) et `child_devices` ; révocation du téléphone ; réponse FCM `UNREGISTERED` ou jeton invalide ; purge à 60 jours sans être vu (`purge_expired()`) |
| `push_outbox` (file d'envoi : jeton, type `notification`/`data`, événement `message`/`test`/`config`/`battery_low`/`sim_absent`/`silent`, identifiant de la ressource ; état, tentatives, prochaine tentative, code d'erreur ; aucun contenu ni jeton) | le jeton (`token_id`) | worker seulement | `notifyFamily` (jetons des sessions des membres de la famille, dans la transaction de l'événement ; message rapide à son premier enregistrement), `notifyDevice`, `POST /api/push/test` (sa seule session, 5/h) ; 30 par heure et par compte (ou par téléphone d'enfant) | worker : réservation `FOR UPDATE SKIP LOCKED`, puis état (`UPDATE (status, attempts, next_attempt_at, last_error, sent_at)` seul) ; destinataire parti de la famille → abandon | jeton supprimé → `token_id` effacé, ligne abandonnée (`token_gone`) mais gardée pour le plafond horaire (`owner_key`) ; purge des lignes envoyées, abandonnées ou sans jeton à 7 jours (`purge_expired()`) ; aucun DELETE accordé |

| `ota_bundles` (bundle web zippé en `bytea`, 10 Mo au plus ; app `parent`/`enfant`, canal de cette app (contrainte), version, `min_native_build`, SHA-256 contrôlé par la base ; NAR-189) | aucune famille : ressource globale de l'app visée | public, lecture seule (`POST /api/ota/latest`, `PUT /api/ota/channel`, `GET /api/ota/bundles/:id`) : seulement à la coque de CETTE app, sur un canal de cette app, `min_native_build ≤ version_code` | `server/bin/ota-publish.js` avec le compte propriétaire, à la main ; aucun INSERT accordé au rôle applicatif | — (lignes immuables ; republier sous une nouvelle version) | propriétaire seul (SQL) ; aucun DELETE accordé |

Code parent (NAR-139) : 6 chiffres, ni identiques, ni en suite, ni en motif répété (121212, 112233) (`server/src/parent-code.js`, même règle
dans `src/lib/parentCode.ts`). Seul un hachage PBKDF2-HMAC-SHA256 (600 000 itérations, sel de 16 octets,
format `pbkdf2-sha256$<itérations>$<sel>$<clé>`) est gardé : WebCrypto, qui le vérifiera hors ligne sur le
téléphone (NAR-167), n'a pas scrypt. Les comptes ne reçoivent que `parentCodeSetAt` ; le hachage ne part que
vers le téléphone de CET enfant (`parentCode` de `/api/device/config`), et un nouveau code fait avancer
`config_version` par déclencheur. Limite assumée : six chiffres se retrouvent par force brute à partir du
hachage ; il ne vit que dans le stockage sécurisé d'un téléphone en Device Owner. Tests :
`server/test/parent-code.test.js`.

Sessions d'appareil (NAR-138) : `server/src/app.js` cherche un jeton Bearer des routes `/api/device/*`
parmi les seules `device_sessions` (appareil non révoqué), jamais par cookie ni parmi les sessions de
compte ; une session de compte n'atteint jamais ces routes, une session d'appareil aucune autre.
Jeton « signal de vie » (NAR-180) : schéma `Heartbeat`, cherché dans `child_devices.heartbeat_token_hash`
pour la seule route `config.heartbeat` (`POST /api/device/heartbeat`). Tests : `server/test/devices.test.js`,
`server/test/heartbeat-token.test.js`.

Garde : `server/src/families.js` — `requireFamilyRole(db, req, familyId, roles)` (pas membre → 404,
rôle insuffisant → 403) avec la famille lue sur la ligne de la ressource, ou `requireOwnFamily`
pour la famille de la session. Tests d'isolation : `server/test/families.test.js`.
Toute nouvelle table ajoute sa ligne ici avant sa première route. Tables métier
attendues (porteuses d'`org_id` = famille) : familles, adhésions, invitations, enfants,
appareils, contacts autorisés, applications autorisées, plages horaires, messages
rapides, journal, alertes SOS, positions.

## Commandes de qualité

`npm run lint`, `npm run build`, `npm test`, `npm run test:api` (Docker),
`npm run test:e2e` ; `npm run test:all` les enchaîne. `npm run recette` : critères
d'acceptation (Docker requis).

Poste macOS 14 : le WebKit de Playwright y est figé (`Unknown setting: PushAPIEnabled`).
Projet `webkit` dans l'image Linux à la version de `@playwright/test` :
`docker run --rm -v "$PWD:/w" -v /w/node_modules -v /w/server/node_modules -v /w/dist -w /w mcr.microsoft.com/playwright:v1.65.0-noble sh -c "npm ci --ignore-scripts && npx playwright test --project=webkit"`.
La recette `iphone` fait foi en CI Linux.

## Pipeline Linear

Workflow automatisé idée → ticket → PR (skills globales `/ampy-idea` et `/ampy-code`).

- **Équipe Linear** : Nardi.L, clé `NAR` (équipe partagée, tient lieu d'équipe générique).
- **Projet Linear** : `Akaiky v2` (P-NAR-4). Ne pas confondre avec `Akaiky` (P-NAR-3), premier projet.
- **Repo GitHub** : `Nardi-Liantsoa/akaiky-v2` (privé).
- **Branches** : identifiant Linear en minuscules + nom de l'app + slug : `nar-12-akaikyv2-slug-court`.
- **Commandes de qualité** (à passer au vert avant toute PR) : `npm run lint`, `npm run build`,
  `npm test`, `npm run test:api` (Docker), `npm run test:e2e` ; `npm run recette` si le ticket
  touche un critère de `recette/criteres.md`.
- **PR** : description avec `Fixes NAR-<n>` pour la liaison Linear ; ne jamais merger soi-même.
- **Flux** : `/ampy-idea "<idée>"` crée le ticket en Backlog → l'utilisateur le passe en Todo →
  `/ampy-code NAR-<n>` implémente et ouvre la PR → review → merge par l'utilisateur.
