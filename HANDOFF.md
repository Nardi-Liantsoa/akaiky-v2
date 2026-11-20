# Akaiky (akaiky-v2) — passation

## État au 17/11/2026

- Socle `app-propre-mobile` généré (create-nosy-app @ 995f746). Ressource d'exemple `notes`
  retirée (NAR-132, migration `002`). Premier métier : familles et garde de rôle par famille
  (NAR-133, migration `003`) ; un parent sans famille la crée depuis l'accueil.
  Invitations, rôles et départs (NAR-134, migration `004`). Enfants avec prénom chiffré
  (NAR-135, migration `005`, clé `DATA_ENCRYPTION_KEY`).
  Contacts autorisés côté parent (NAR-140, migration `006`) ; la synchronisation vers le
  téléphone de l'enfant attend l'appairage (NAR-160, bloqué par NAR-138).
  Appairage côté parent et serveur (NAR-138) : QR de provisionnement Android (jeton 15 min,
  usage unique), sessions d'appareil séparées, révocation. Côté téléphone : NAR-164 ; APK
  signé et servi : NAR-165 — keystore de release hors dépôt (`~/.config/akaiky-v2/`), **à
  sauvegarder dans le gestionnaire de mots de passe** ; procédure dans `NOSYHOST.md` § 6.
  Coques Android (variantes `parent` et `enfant`) et iOS générées (NAR-137). Les deux APK
  s'installent côte à côte (Android 8 et 14). WebView 64 minimum, écran de repli en trois
  langues en dessous (NAR-161, `docs/MOBILE.md`) ; Android 8 non vérifiable sur ce poste
  (image ARM sans WebView utilisable). iOS non construit : Xcode 15.3 trop ancien ici.
- Identifiant `mg.nosytech.akaiky`, nom affiché « Akaiky ». Maquettes résumées dans
  `docs/DESIGN.md` ; jetons et police posés dans `src/style.css` (NAR-132).
- Vérifié en local (NAR-140) : lint, build, tests front (34/34), tests API contre PostgreSQL
  jetable (109/109), e2e Chromium (37/37), e2e WebKit (dans l'image Docker Playwright),
  `npm audit` : serveur 0 vulnérabilité ; racine, seul l'avis picomatch sous exception datée (NAR-159), gitleaks et Semgrep (`p/javascript`,
  `p/typescript`) sans résultat, image Docker construite (utilisateur `node`),
  `/health` 200 et `/ready` 503 sans base, refus de démarrer en production sans clé MFA.
- Recette installée : 22 critères métier du CdC, tous « (prévu) ». `npm run recette
  -- --sans-visuel` : C01, C02 verts sur ordinateur ; projet `iphone` en échec sur ce
  Mac (WebKit figé, macOS 14), donc verdict non validé en local.
- **Non vérifié** : audit du contrat NosyHost (`make audit-image`) — dépôt `nosyhost`
  absent de ce poste ; recette `iphone` et comparaison visuelle (pas encore de `main`
  de référence au-delà du premier commit) ; coque iOS non construite (Xcode 15.3
  trop ancien sur ce poste).
- Export RGPD et consentement (NAR-178) : `GET /api/families/me/export` (owner/manager, bouton dans
  « Sécurité ») ; cases de consentement obligatoires à l'inscription et à l'ajout d'un enfant
  (migration `018`). Politique de confidentialité en **brouillon** (`docs/confidentialite.md`) :
  responsable, contact, durée des sauvegardes NosyHost et autorité de contrôle à compléter ;
  aucune page in-app ni lien encore (case sans mention de la politique). Export désactivé dans
  l'app native (la WebView ignore le téléchargement par lien) : bouton masqué, renvoi vers la
  version web ; un export natif (Filesystem/Share) demanderait une nouvelle coque.

- SOS hors ligne, tranche 1 (NAR-151, 19/11/2026) : SMS avec position, cascade d'appels, sirène réglable
  (`children.sos_siren`, migration `022`, carte « SOS » des Réglages), écran rouge de l'enfant. Nouvelle coque enfant
  (service, permissions). C11 et C12 restent « (prévu) » : procédures filmées sur de vrais téléphones à faire.
  Vérifié sur l'émulateur `kiosk34` (Android 14) : SmsManager appelé, `PendingIntent` d'envoi OK ; service au premier plan
  (types appel et position) ; sirène lancée puis arrêtée au décroché et à l'annulation ; appel en échec → contact
  suivant → composeur des secours ; « Appeler les secours » coupe l'appel en cours. Le simulateur de modem de l'émulateur
  refuse tout numéro en « + » et décroche seul les autres après 2 s (`adb emu gsm accept/cancel` sans effet) : coupure à
  25 s, durée lue au journal (23 s) et rappel sans coupure vérifiés avec une construction de test temporaire (numéro
  composé en « 00 », non gardée). « Pas de réponse → contact suivant » au vrai sens reste à voir sur téléphone réel.
  Suite (NAR-181) : arrêt par prise en charge d'un parent, journal du SOS au serveur.

- **OTA parent / enfant (NAR-162, nouvelle coque parent ET enfant)** : chaque coque se
  présente au greffon OTA avec son identifiant et son canal (`parent` / `enfant`), écrits
  nativement au build (`OtaIdentityTask`, `android/app/build.gradle`) ; statistiques Capgo
  coupées (`statsUrl: ''`). **Avant le premier OTA** : (1) livrer ces deux coques — les
  coques antérieures se présentent toutes comme l'app parent et envoient leurs statistiques
  à `plugin.capgo.app` ; la coque minimale du premier OTA de chaque app est donc le
  `versionCode` de cette coque-là ; (2) le serveur OTA auto-hébergé existe (NAR-189 :
  `/api/ota/latest`, `/api/ota/channel`, `/api/ota/bundles/:id`, table `ota_bundles`,
  publication `server/bin/ota-publish.js`) ; reste à régler `updateUrl` =
  `https://<domaine>/api/ota/latest` et `channelUrl` = `https://<domaine>/api/ota/channel`
  dans les coques (encore une coque ; par défaut ils visent Capgo Cloud, appelé seulement si
  le JavaScript le demande, ce qu'aucun code ne fait), et jouer la migration 024 avant
  l'image qui en a besoin ;
  (3) le runtime est écrit (NAR-191, ci-dessous). Procédure : `docs/MOBILE.md` « Mises à jour OTA ».

- **Runtime OTA (NAR-191, 20/11/2026)** : `src/lib/otaUpdate.ts` (règles) et `src/lib/otaRuntime.ts`
  (branchement, après `notifyAppReady()`). Au démarrage et au retour au premier plan, au plus une
  vérification par 6 h, tout réseau ; refus de tout ce qu'`otaVerdict` refuse (cible lue dans `data`,
  seule forme que le greffon iOS transmet ; le serveur l'ajoute à la réponse) ; SHA-256 passé au greffon ;
  parent : `next()` (installé par le greffon au prochain passage en arrière-plan) ; enfant : jamais
  `next()`, `set()` 5 s après un passage en arrière-plan, seulement au repos (`AkaikyUpdate.status().busy`,
  natif : SOS ou appel) ; version annulée jamais reprise ; bundles dépassés effacés. **Barrière Capgo** :
  inerte tant que `updateUrl` de `capacitor.config.ts` n'est pas `https://<hôte>/api/ota/latest`
  (aujourd'hui absent : aucune requête). **Coque** : la coque enfant doit porter `busy` (sinon l'enfant
  reste « occupé » et ne se met jamais à jour) ; elle part avec celle de NAR-190. **Avant le premier OTA** :
  NAR-190 (`updateUrl`/`channelUrl` des coques, nouvelle coque parent et enfant), migration 024 jouée,
  publication à la main (`docs/MOBILE.md`). Limites : `HANDOFF.md` « Limites résiduelles ».

- Numéro de l'enfant (NAR-194, 20/11/2026) : colonne `children.phone_enc` (migration `025`, additive, nullable),
  E.164 chiffré avec les données associées `children:phone:<id>`, sans index aveugle (aucune recherche par numéro).
  Saisi par un gestionnaire dans le formulaire de l'enfant (champ facultatif), lu par tous les membres, dans l'export,
  effacé avec l'enfant ou la famille. Bouton « Antsoy » / « Appeler » / « Call » (lien `tel:`) sur la carte de
  l'accueil, seulement avec un numéro. Pas de nouvelle coque : Capacitor ouvre `tel:` hors de la WebView ; **à
  vérifier sur un vrai téléphone parent (Android et iOS)** que le composeur s'ouvre. Le numéro n'est pas envoyé au
  téléphone de l'enfant. Exemple du champ au pays des contacts déjà chargés (Madagascar sinon).

## Décisions datées

- 17/11/2026 — nouveau projet séparé du premier `~/labo2026/akaiky` (laissé intact),
  à partir du même CdC v0.1 et des maquettes « Akaiky — mobile app design ».
  Même identifiant d'application. Cadrage : `CLAUDE.md`, « Décisions ».

## Documents source (hors dépôt)

- `~/Downloads/Akaiky.pdf` — cahier des charges v0.1.
- `~/Downloads/Akaiky — mobile app design.pdf` — 10 écrans.

## À trancher avec le client (CdC §12) — bloque certains critères

1. Marché : Madagascar, France, ou les deux (numéros d'urgence, coût des SMS).
2. Téléphones fournis configurés par le client, ou achetés par les familles.
3. Appel par Internet dès la v1 (planning).
4. Modèle économique (oriente la v2).
5. Nom et identité visuelle (Akaiky = nom de travail ; police des maquettes à confirmer).
6. Âge des enfants visés.
7. Écarts maquette / CdC listés dans `docs/DESIGN.md`.

## Ce qui attend un ordre

- Repo GitHub (privé) et premier push.
- Client NosyHost, domaine de préproduction puis de production.
- Comptes Google Play et Apple Developer **au nom du client** ; projet Firebase et clé
  APNs ; demande d'autorisation Apple « alertes critiques ».
- Keystore Android (Parent et Enfant) : à générer une fois, hors dépôt, sauvegardé.

## Risques

- Modules natifs Android (Device Owner, filtrage d'appels, SMS) : plus gros risque du
  planning, sprints 1 à 3. Tester sur un Android bas de gamme réinitialisé.
- Les critères « natif » de `recette/criteres.md` ne sont pas atteignables par
  Playwright : leur preuve (test instrumenté, procédure filmée) se fixe dans leur ticket.
- **Mise à jour de la coque enfant (NAR-167)** : le verrou pose `DISALLOW_INSTALL_APPS`,
  qui bloque aussi l'installation d'une nouvelle version de l'APK enfant (vu sur
  émulateur). À régler avant la première mise à jour de coque : l'app lève la
  restriction le temps de sa propre mise à jour (ticket à créer).

## Téléphone de l'enfant bloqué : sortie de secours (NAR-167)

Le verrou ne s'applique qu'une fois le téléphone appairé **et** un code parent choisi
(Réglages de l'app parent) ; il se lève :

1. **Code parent** (6 chiffres) : 15 minutes, puis le verrou revient seul (alarme), et
   tout redémarrage le remet. Le hachage du code reste sur le téléphone même s'il perd sa
   session : le bouton « Code parent » est présent sur tous les écrans, erreurs comprises.
2. **Téléphone retiré** par un gestionnaire : il reste verrouillé (un refus ponctuel du
   serveur ne doit pas le rendre à l'enfant). Le parent saisit le code, puis touche
   « Libérer ce téléphone » : plus de verrou, de restriction ni de lanceur par défaut ;
   il peut être réinitialisé, puis réappairé par QR.
3. **Téléphone hors service ou app qui ne démarre plus** : réinitialisation d'usine par
   le mode de récupération (touches physiques, propres à chaque marque). La restriction
   `DISALLOW_FACTORY_RESET` ne bloque que les Réglages ; aucun compte Google n'est ajouté,
   donc pas de protection FRP au redémarrage.

Développement : la version debug garde le débogage USB. Pour réinstaller, appeler
`AkaikyKiosk.disarm()` (inspecteur WebView), installer, relancer : l'app se réarme.


## Lancer, tester, livrer

- Développement et tests : `README.md`.
- Hébergement, premier admin, rôle SQL restreint : `NOSYHOST.md`.
- Retour arrière : `make rollback CLIENT=akaiky_v2_<env>`, ou redéployer le tag précédent ;
  possible tant que les migrations restent additives.

## Limites résiduelles assumées

Repris de Deploy4000 et à garder à jour : une limite écrite est un choix, une limite tue est une faille.

- **Runtime OTA (NAR-191)** : la barrière Capgo se fie à l'`updateUrl` lu au build dans
  `capacitor.config.ts`, pas à celui de la coque (le greffon ne l'expose pas) ; ils viennent de la même
  source et un OTA n'atteint qu'une coque qui vise déjà ce serveur, mais une coque construite à la main
  avec une autre configuration que celle du bundle échapperait à la vérification. App parent : installation
  au prochain passage en arrière-plan (pas au prochain démarrage à froid) : un formulaire laissé ouvert en
  quittant l'app est perdu. App enfant : bundle installé 5 s après un passage en arrière-plan au repos ; un
  appel qui démarre plus de 5 s après ce passage n'est pas concerné, un appel que Telecom signale en retard
  peut voir l'écran rechargé derrière lui (l'appel n'est pas touché). Téléphone qui ne passe jamais en
  arrière-plan au repos : bundle jamais installé. Un faux échec (WebView trop lente à rappeler
  `notifyAppReady()` à temps : 30 s au premier lancement d'un bundle sur Android, 10 s sur iOS) écarte cette version pour toujours : republier sous une
  nouvelle version. Téléchargement sur données mobiles (~270 Ko par version).

- **Bundles OTA non signés (NAR-189)** : intégrité par le SHA-256 que le greffon vérifie et par
  le https ; ni chiffrement (`session_key`) ni signature de bundle. Quiconque écrit dans
  `ota_bundles` (compte propriétaire de la base) peut distribuer du code aux deux apps : ce
  compte ne sert qu'aux commandes administratives. Routes OTA publiques : un bundle se
  télécharge sans session (c'est le code de la version web, déjà public ; canaux de test
  compris : n'y publier rien de confidentiel). Limites par IP
  (`OTA_RATE_LIMIT`, `OTA_DOWNLOAD_RATE_LIMIT`) : à relever derrière un NAT d'opérateur.
  Corps du greffon validé strictement : une coque avec un greffon plus récent qui enverrait
  un champ nouveau ne reçoit aucune mise à jour tant que le serveur ne le connaît pas.

- **SOS hors ligne (NAR-151)** : décroché d'un appel sortant deviné (au moins 8 s connectées au journal d'appels ;
  coupure à 25 s, puis un rappel sans coupure du même contact si le journal montre qu'il avait décroché) : une
  messagerie qui répond compte comme un décroché ; un parent qui répond après 20 s est coupé puis rappelé. Journal
  d'appels illisible : l'appel compte comme non décroché, la cascade passe au suivant puis aux secours. Android 8 ne
  sait pas raccrocher : l'appel sans réponse finit par le réseau, la cascade attend sa fin (état des appels, sinon
  son entrée au journal, 30 min au plus) avant le suivant ; sans état des appels NI journal lisibles, un appel non
  coupé fait attendre 30 min. Un appel entrant ne prend le relais que d'un numéro
  joignable. Secours : composeur prérempli, l'enfant appuie sur « Appeler ». Processus tué : reprise par
  `START_REDELIVER_INTENT`, avancement gardé sans numéro ni position ; sans service ni signe de vie depuis 2 min
  (ou après un redémarrage du téléphone), le SOS est déclaré « interrompu » à l'écran et jamais rejoué. SMS et journal d'appels sont des permissions
  « restreintes » : accordées sur l'émulateur (installé par adb, exempté) ; à vérifier sur un téléphone provisionné
  par QR (installation par le provisionnement).

- **Avis picomatch GHSA-fc5q-39xc-vjpf (ReDoS), sans correction publiée** : exception
  datée dans `audit-exceptions.json`, **échéance 18/12/2026**. `picomatch` ne sert qu'à
  l'outillage de construction (vite, vitest, vue-router, vue-tsc) : absent du bundle et du
  serveur, motifs issus de notre configuration. `npm run audit:deps` (`scripts/audit.mjs`)
  échoue sur tout autre avis moderate ou plus, à l'échéance, et dès que l'exception ne sert
  plus : fusionner alors la mise à jour de Dependabot et retirer l'exception.

- **Composeur d'urgence et écran d'appel (NAR-167)** : le composeur système et Telecom
  sont autorisés dans le verrou, sans quoi l'écran d'appel (décrocher, raccrocher) et le
  composeur d'urgence ne s'affichent pas (vérifié sur émulateur Android 14). Depuis ce
  composeur (bouton « Secours ») ou « Ajouter un appel », l'enfant peut composer un autre
  numéro. Messages, contacts et réglages restent bloqués. **Fermé par NAR-169** (filtre des
  appels sortants) : ce numéro n'est composé que s'il est un contact joignable ou un numéro
  d'urgence, sous les réserves ci-dessous.
- **Filtre des appels sortants (NAR-169)** : Android 10+, rôle `ROLE_CALL_REDIRECTION` confirmé
  une fois sur le téléphone avec le filtrage des appels entrants (même bouton, avant le verrou ou
  pendant une sortie) ; Android 8–9, `NEW_OUTGOING_CALL` avec `PROCESS_OUTGOING_CALLS` accordée en
  Device Owner (refus : `resultData` vidé et `abortBroadcast`). Le récepteur est désactivé à
  partir d'Android 10 : sans le rôle, tout numéro peut y être composé tant qu'il n'est pas confirmé
  (l'écran de l'enfant l'indique pendant une sortie, d'après l'état réel lu sur le téléphone).
  Urgence et `voicemail:` composés aussitôt ; `*`/`#` jamais pris pour une urgence, ni un « + » initial
  (« +112 », « +117 » : décision normale) ; `sip:` refusé sur Android 10+. Décision synchrone dans le
  service, sans délai d'attente : une seule réponse, toute erreur annule l'appel (urgence déjà passée).
  Android 8–9 : `NEW_OUTGOING_CALL` ne voit que les appels `tel:` ; un appel par un compte SIP configuré
  dans le composeur échappe au filtre, et aucune restriction du Device Owner n'empêche d'en configurer un
  (hors `DISALLOW_OUTGOING_CALLS`, qui couperait tout).
  Numéro national composé lu au pays du réseau du compte qui appelle (puis carte SIM, puis famille) : en itinérance, le
  format national d'un contact malgache est refusé (le format international passe). Codes USSD et
  préfixes (`#31#`) vers un numéro hors liste : refusés. Urgences : jamais présentées au filtre par
  Android, et acceptées par lui de toute façon (liste de l'app et numéros connus du téléphone).
- **Android 8.x** : `setLockTaskFeatures` n'existe qu'à partir d'Android 9 ; l'affichage
  d'un appel entrant pendant le verrou reste à vérifier sur un vrai Android 8 (l'émulateur
  ARM API 26 n'a pas de WebView).
- **Filtrage des appels entrants (NAR-145)** : actif seulement si le parent a confirmé
  « Activer le filtrage des appels » sur le téléphone (rôle système, Android 10+). Sans
  cette confirmation, tout numéro peut appeler l'enfant ; l'écran de l'enfant l'indique
  pendant une sortie (état réel : `screeningRole().incomingActive`).
- **Filtrage des appels entrants sur Android 8–9 (NAR-172)** : récepteur `PHONE_STATE`, même
  décision et même file que NAR-145, appel refusé raccroché (`TelecomManager.endCall` sur 9,
  `ITelephony.endCall` par réflexion sur 8.0–8.1), permissions accordées en Device Owner, aucune
  confirmation. **Signalé : une courte sonnerie reste** (0,2 à 0,3 s mesurées sur émulateur
  Android 8.1 ; Android ne laisse pas une app couper la sonnerie avant Android 10), avec l'écran
  d'appel entrant entrevu ; plus longue sur un téléphone lent ou chargé, à mesurer sur un vrai
  Android 8. Sur Android 9, un numéro masqué sonne environ 3 s de plus (attente de la copie
  numérotée de la diffusion, pour ne jamais raccrocher un parent ; processus tué pendant cette
  attente : il sonne). Un appel en attente (pendant un autre appel, cellulaire ou VoIP) n'est ni
  raccroché ni noté. Une
  permission manquante désactive le filtre (tout sonne, l'écran le dit) plutôt que de raccrocher
  un parent. **Reste à vérifier sur un vrai téléphone** : Android 9 (l'image d'émulateur arm64 est
  inutilisable ici), un vrai numéro masqué, la durée de la sonnerie et l'écran d'appel entrant
  sous le verrou, les permissions accordées par `setPermissionGrantState` sur un téléphone
  provisionné par QR (`READ_CALL_LOG` est « restreinte » ; l'émulateur a reçu `pm grant`), la
  réflexion `ITelephony` sur des ROM constructeur (Tecno, Itel, Samsung), et le passage du journal
  à l'écran puis au serveur (WebView non lancée pendant le test : la file native est vérifiée,
  sa reprise est celle de NAR-145).
- **Fenêtre des secours (NAR-196)** : après un appel de l'enfant aux secours, tout appel entrant sonne
  30 min (inconnu et masqué compris), noté `call_in` marqué « laissé passer » au journal du parent.
  Horloge depuis le démarrage + numéro de démarrage : l'heure du téléphone n'y fait rien, un
  redémarrage la ferme. Appel aux secours vu par le service de filtrage (appels sortants, Android 10+,
  rôle de filtrage requis), par `NEW_OUTGOING_CALL` (Android 8–9) et par la décision des appels
  sortants ; pas par l'appui sur le bouton (composeur seulement prérempli). Détails : `docs/MOBILE.md`.
  **Limites** : tout inconnu qui appelle pendant ces 30 min sonne (risque accepté par décision de
  l'utilisateur) ; un enfant qui compose une urgence de la liste puis raccroche ouvre la fenêtre. Pendant le
  mode de rappel d'urgence (ECBM) d'Android, tout appel sonne sans passer par le filtre ni par le
  journal (comportement du système). **Reste à vérifier sur un vrai téléphone** : Android 10 à 13
  (le service de filtrage reçoit-il bien les appels d'urgence sortants ? vérifié seulement sur 14),
  Android 9 (`NEW_OUTGOING_CALL` pour une urgence, vérifié sur 8.1), durée réelle de l'ECBM chez
  Telma, Orange et Airtel, un vrai rappel des secours (numéro masqué ou court).
- **Numéros d'urgence (NAR-197)** : liste de l'app = 117 (police), 118 (pompiers), 147 (Ligne Verte,
  violences faites aux enfants), 112 et 911 (acheminés par tout téléphone GSM) ; 15, 17, 18 (France),
  114 et 119 retirés. Sources et degré de confiance : `docs/MOBILE.md` (« Numéros d'urgence ») et
  `CallPolicy.kt`. Toujours composés et ouvrant la fenêtre des secours. **Limites** : le 118 ne repose
  que sur une source non gouvernementale (ANWB) ; le SAMU (124, sources secondaires contradictoires)
  et la gendarmerie (aucun numéro trouvé) ne sont pas dans la liste, à confirmer avec le client ou
  auprès des opérateurs (Telma, Orange, Airtel) ; sur Android 10+, un numéro déclaré urgence par la
  carte SIM ou le réseau reste traité en urgence. **La liste ne vaut que pour Madagascar : à revérifier
  avant toute sortie dans un autre pays** (« À trancher avec le client », point 1 : marché).
- **Volet des notifications** : affiché pendant le verrou (sans réglages rapides), car il
  porte l'appel entrant. Toucher une notification ou « Gérer » n'ouvre rien.

- **NAT des opérateurs mobiles** : beaucoup d'utilisateurs partagent une adresse IPv4.
  Le renouvellement natif n'a pas de limite par IP ; la limite globale de l'API
  (`API_RATE_LIMIT`, 300 requêtes/min/IP, pré-vols exclus) et celles de la connexion
  (`RATE_LIMIT_IP`, 20 essais/15 min/IP ; deux hachages simultanés par IP) restent :
  à relever si l'app a beaucoup d'utilisateurs sur le même opérateur.
- **Limiteurs en mémoire** (par IP, par adresse) : valables pour une seule instance.
  Ce qui protège un compte (garde de connexion, budgets MFA, quotas) est en base et
  tient à plusieurs instances.
- **TOTP** : ne résiste pas à l'hameçonnage en temps réel (les passkeys le feraient).
- **Cookie de session volé** : révocable (déconnexion, réinitialisation), pas détectable.
- **File des emails** en mémoire : un redémarrage pendant l'envoi perd l'email en cours
  (la personne redemande le lien).
- **Application native** : les comptes à double authentification (admins) se
  connectent par la version web. Un ancien jeton de renouvellement peut encore servir
  une fois, dans les 7 jours, tant que son successeur n'a jamais servi (réponse perdue,
  app tuée avant d'avoir rangé le nouveau jeton) : un voleur qui l'utilise obtient la
  session jusqu'au prochain renouvellement de l'app, qui détecte alors le rejeu et
  ferme la session. L'app sérialise ses renouvellements.
- **Clé `DATA_ENCRYPTION_KEY`** (prénoms des enfants, NAR-135) : sauvegardée avec la base ;
  la perdre rend ces données illisibles (aucune récupération possible). Rotation : le
  format chiffré porte un numéro de version (`server/src/crypto-fields.js`).
- **Pas d'antivirus** : aucun fichier déposé dans ce starter ; à écrire ici dès
  qu'une ressource en accepte (`ampy-api`, « Fichiers déposés »).
- **Perte du téléphone d'un admin** : codes de secours, sinon procédure manuelle
  avec vérification d'identité hors site — jamais sur la seule preuve d'accès à l'email.
- **Durées de conservation (NAR-153)** : purge quotidienne par `purge_expired()`
  (`server/src/migrations/016_retention.sql`) : journal du téléphone (compté depuis sa
  réception par le serveur) et messages rapides 90 jours ; journal d'audit 1 an, adresse IP
  effacée à 90 jours ; sessions 30 jours après la fin de tout renouvellement ; jetons expirés.
  Dernier tour et nombres supprimés : `SELECT * FROM job_runs`. Changer une durée = une
  nouvelle migration (jamais depuis l'application). Les sauvegardes gardent les données
  supprimées jusqu'à leur rotation : durée à écrire dans la politique de confidentialité
  (NAR-178). Positions (30 jours) : avec leur table, NAR-146. Une purge de plus de 10 minutes
  est annulée et retentée chaque heure : avant la production avec un gros historique, vérifier
  le volume (ou purger par lots).
- **Suppression du compte et de la famille (NAR-177, C21)** : immédiate, par cascade en base
  (`DELETE /api/families/me` par le parent principal, `DELETE /api/auth/me` pour son compte ; mot
  de passe redemandé, garde de connexion). Un parent principal cède son rôle ou supprime la
  famille avant son compte, le dernier administrateur en nomme un autre (409 `last_admin`) ; toutes
  les invitations reçues à son adresse, acceptées comprises, sont effacées. Les sauvegardes gardent ces données jusqu'à leur rotation (durée à
  écrire dans la politique de confidentialité, NAR-178) ; le journal d'audit ne garde que
  l'action et des comptes, sans donnée personnelle.
- **Avant le prochain déploiement : PUSH_PROVIDER=none en préprod et en prod (tant que le projet
  Firebase n'existe pas)** — sans cette variable, l'application refuse de démarrer en production.
- **Notifications push (NAR-141, serveur)** : `PUSH_PROVIDER=none` tant que le projet Firebase
  (au nom du client, sur ordre) n'existe pas ; puis `PUSH_PROVIDER=fcm` et `FCM_SERVICE_ACCOUNT`
  (fichier monté hors image ou JSON ; vérifié au démarrage, `NOSYHOST.md` § 3). `fake` est refusé
  en production. Jetons morts (`UNREGISTERED`, `INVALID_ARGUMENT` sur le jeton) supprimés à l'envoi ;
  `SENDER_ID_MISMATCH`, 404 ou 401/403 : erreur de configuration Firebase, jeton gardé, alarme
  « configuration FCM refusée » dans `make logs` ; plafond de 30 par heure et par compte ; non vus depuis
  60 jours, purgés ; file abandonnée après 5 tentatives (`SELECT status, count(*) FROM push_outbox
  GROUP BY 1`). Téléphones sans services Google (Huawei récents) : aucun push ; toute information
  reste visible dans l'app (messages rapides dans l'écran de l'enfant). Clé API Firebase à
  restreindre dans la console Google Cloud. Côté app : NAR-179 (nouvelle coque).
- **État du téléphone (NAR-147, premier volet)** : signal `POST /api/device/heartbeat` envoyé par
  l'app enfant **au premier plan seulement** (au démarrage, toutes les 15 min, tout de suite sous 15 %
  ou si la carte SIM change ; même si le relevé natif échoue : batterie et charge `null`, réseau et
  carte SIM `unknown`) ; alertes `device_alerts` (batterie < 15 % hors charge, fermée à 20 % seulement,
  pas de nouvelle alerte batterie dans les 60 min qui suivent une fermeture ; carte SIM absente ;
  silence de 60 min, veille de `jobs.js` toutes les 5 min) avec une notification à l'ouverture.
  L'export de la famille contient les relevés de chaque téléphone et les alertes de chaque enfant.
  Depuis NAR-180, l'état réel de la carte SIM est lu par le natif et le signal en arrière-plan porte
  `background: true` : l'alerte « silence » est active pour tout téléphone qui a cette coque.
- **Signal de vie en arrière-plan (NAR-180, nouvelle coque enfant)** : WorkManager, toutes les 15 min
  (le minimum d'Android), réseau exigé, et tout de suite (tâche unique) quand la batterie passe sous
  15 % ou que la carte SIM change ; hors ligne, seul le dernier relevé attend et part au retour du
  réseau. Limites : **Doze et les économiseurs de batterie des constructeurs (Xiaomi, Tecno, Itel,
  Infinix, Samsung…) peuvent retarder la tâche bien au-delà de 15 min**, écran éteint longtemps :
  fenêtres de maintenance espacées jusqu'à plusieurs heures. Une alerte « silence » peut donc partir
  à tort sur un téléphone simplement endormi. **À vérifier sur de vrais téléphones d'entrée de gamme**
  (écran éteint 2 h, `adb shell dumpsys jobscheduler | grep akaiky`, journaux `AkaikyStatus`) avant
  la recette ; si le retard est fréquent, élargir le seuil « silence » côté serveur ou demander
  l'exemption d'optimisation de batterie à l'installation. Les événements batterie et carte SIM
  (diffusions non déclarables dans le manifeste depuis Android 8) ne sont écoutés que tant que le
  processus vit (lanceur en lock task : normalement toujours) ; sinon la tâche des 15 min les voit.
  Carte SIM retirée processus arrêté : `CARRIER_CONFIG_CHANGED` (manifeste) en filet. Vérifié sur
  émulateur (AVD `kiosk34`, Android 14) : tâches planifiées, conservées au redémarrage, événement
  batterie écran éteint, file hors ligne ; **pas d'envoi réussi vérifié** (aucun serveur joignable
  en https depuis l'émulateur), et le passage au jeton « signal de vie » n'a pas été revérifié sur
  émulateur (tests JVM et API seulement).
  Authentification : jeton « signal de vie » dédié (voir CLAUDE.md, « Décisions »), émis par l'écran
  via sa session d'appareil et confié au natif ; le natif ne touche plus jamais la session. Il faut
  donc que l'app ait été ouverte appairée au moins une fois avec un réseau après l'installation de
  cette coque (et après un 401 ou une clé Keystore perdue) pour que le signal reparte : sinon rien
  ne part en arrière-plan et l'alerte « silence » ne peut pas s'ouvrir pour ce téléphone.
  Migration `021_heartbeat_tokens.sql` (additive) et `GRANT UPDATE (heartbeat_token_hash)` de
  `ops/runtime-role.sql` à appliquer avant de livrer la coque.
- **Applications autorisées (NAR-143, nouvelle coque enfant)** : vérifié sur l'émulateur `kiosk34` (Device Owner,
  Android 14) : liste des applications lançables (Camera, Clock, Calendar…, sans Chrome, Réglages, Téléphone ni Messages),
  applications non autorisées cachées (encore listées), Chrome caché et aucun lien http(s) ne s'ouvre, application autorisée
  lancée dans le lock task, application cachée impossible à démarrer par `am start`, tout rendu à la libération. **Non
  vérifié** : un vrai téléphone (constructeur qui refuse `setApplicationHidden`, lanceur ou navigateur absent de la liste
  protégée : à compléter dans `server/src/protected-apps.json` et `AppsPolicy.kt`), Android 8/9 (Chrome fournisseur du
  WebView, jamais caché, donc pas bloqué hors lock task). Une application cachée n'est découverte qu'au choix d'une liste
  ou à l'armement, pas à chaque reprise. Inventaire envoyé au passage à « appairé » et à chaque reprise si son empreinte
  change (6 par heure côté serveur ; un relevé pendant un envoi part juste après, avec les derniers arguments).
  **Plage « école »** : rangée masquée, `launchApp` refusé par le natif (`school`), applications autorisées retirées de la
  liste du lock task pendant la plage (rendues à sa fin), et l'app redemandée devant à chaque tour du minuteur tant
  qu'elle n'y est pas (`bringToFront`, vérifié sur `kiosk34` dans sa version « début de plage » seulement ; retrait du
  lock task et redemande à chaque tour **non vérifiés sur un téléphone**). Limites : l'application déjà ouverte garde
  l'écran jusqu'au tour suivant du minuteur (60 s au plus). **Ce minuteur (`setInterval` de l'écran) n'est pas arrêté en
  arrière-plan, mais il tourne dans la WebView** : quand une autre application est devant, Android peut ralentir ou
  suspendre la WebView (selon la version et le constructeur), le tour peut donc arriver en retard ou pas du tout avant
  la prochaine reprise ; WebView tuée, rien ne la ramène. Le retrait du lock task se fait alors à la reprise suivante,
  à la réception des plages (`setAllowed`) ou au prochain lancement refusé ; aucune alarme native au début ni à la fin
  d'une plage (piste : `AlarmManager` sur les bornes de `SchoolSchedule`). Les applications ne sont pas recachées
  pendant la plage. Fin de plage sans tour du minuteur : les autorisées reviennent au lock task à la prochaine reprise.
  **Lock task vérifié sur `kiosk34` (19/11/2026, horloge autorisée au premier plan, `am start` par adb)** : Réglages
  (`android.settings.SETTINGS` et activité directe) et Messages (`APP_MESSAGING`, activité directe, `SENDTO sms:`)
  bloqués par le lock task ; lien https : aucun navigateur (Chrome caché) ; `VIEW tel:` ouvre le composeur et `CALL tel:`
  (droit du shell) lance l'appel : le composeur est dans le lock task par conception, le filtrage des appels sortants est
  NAR-169. Non essayé depuis l'application autorisée elle-même (pas d'outil pour l'y faire lancer) : le lock task juge le
  paquet visé, pas l'appelant.
- **Mise à jour de l'APK enfant (NAR-170)** : Android ne permet pas au Device Owner de lever
  `DISALLOW_INSTALL_APPS` pour un seul paquet. La restriction est levée **juste avant la création de la session
  d'installation** (Android 14 refuse déjà `createSession` sous la restriction, vu sur `kiosk34`), donc pendant la
  copie d'un fichier local déjà vérifié et l'installation elle-même : **environ 5 à 7 s** vues sur l'émulateur. Pendant
  ce temps une autre installation serait possible ; elle demanderait une autre application d'installation, que le lock
  task ne laisse pas ouvrir (adb : coupé dans l'APK distribué). Avant d'ouvrir la fenêtre, aucune autre session
  d'installation active n'est admise ; pendant, toute nouvelle session d'un autre installateur la referme aussitôt.
  Reposée par le résultat de l'installation, l'alarme de 5 min, le démarrage du processus (`EnfantApplication`),
  `Kiosk.enforce`, `BOOT_COMPLETED` et `MY_PACKAGE_REPLACED` (vérifié : app tuée la fenêtre ouverte → reposée 2 s
  plus tard par le processus relancé). Refus vérifiés sur `kiosk34` : autre certificat, version égale, autre version
  que l'annoncée, empreinte différente, APK tronqué. Non vérifié : échec du système **après** la remise (résultat
  `STATUS_FAILURE`, même chemin de fermeture), Android 8–9 (`GET_SIGNATURES`), téléphone provisionné par QR.
  Aucun écran de progression : l'enfant voit l'app redémarrer. Téléphones déjà configurés avant NAR-170 : coque à
  installer une fois par une autre voie (`docs/MOBILE.md`).
- **Traductions malgaches** : à faire relire par une personne de langue maternelle.
