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
  numéro. Messages, contacts et réglages restent bloqués. À fermer par un filtre des
  appels sortants (ticket à créer).
- **Android 8.x** : `setLockTaskFeatures` n'existe qu'à partir d'Android 9 ; l'affichage
  d'un appel entrant pendant le verrou reste à vérifier sur un vrai Android 8 (l'émulateur
  ARM API 26 n'a pas de WebView).
- **Filtrage des appels entrants (NAR-145)** : actif seulement si le parent a confirmé
  « Activer le filtrage des appels » sur le téléphone (rôle système, Android 10+). Sans
  cette confirmation, ou sur Android 8–9 (NAR-172), tout numéro peut appeler l'enfant ;
  l'écran de l'enfant l'indique pendant une sortie.
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
- **Traductions malgaches** : à faire relire par une personne de langue maternelle.
