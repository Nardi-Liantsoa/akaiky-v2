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
- **WebView minimal (NAR-161, 18/11/2026)** : 64, la cible Chrome du bundle (`import()`,
  `import.meta`). En dessous, écran de repli statique en trois langues
  (`public/webview.html`) qui demande la mise à jour d'« Android System WebView ».
  Pas de bundle pour Chrome 58–63 (Android 8.x jamais mis à jour) : il faudrait les
  chunks SystemJS que la CSP bloque.
- **Hors connexion** : appels et SOS par SMS sans Internet (natif enfant). L'app
  parent démarre hors ligne et le dit, sans déconnecter.
- **Notifications** : FCM (Android) et APNs (iOS), comptes au nom du client. Alertes
  critiques iOS : autorisation Apple à demander dès le début (délai incertain).
- **Rétention** : positions 30 jours, journaux d'appels 90 jours, suppression du compte
  effective sous 30 jours. Chiffrement des données sensibles en base.
- **Domaine** : inconnu. Provisoire `akaiky.a-definir.invalid` (`.env.example`,
  `NOSYHOST.md`, `server/src/config.js`, `src/api/transport-native.ts`, `docs/MOBILE.md`).
- **Noms techniques** : image, paquet npm et client NosyHost s'appellent `akaiky-v2` /
  `akaiky_v2` ; le nom affiché est « Akaiky ».

## Ressources : propriétaire et règle par opération

| Table | Propriétaire | Lecture | Création | Modification | Suppression |
|---|---|---|---|---|---|
| `families` | `memberships` (rôle relu en base à chaque requête) | membres (`GET /api/families/me`) | toute session sans famille, qui devient `owner` (une famille par compte en v1) | `owner`, `manager` (nom) | — (suppression du compte, NAR-153 ; aucun DELETE accordé au rôle applicatif) |
| `memberships` | `family_id` | membres de la même famille (nom et rôle, sans adresse) | création de famille (`owner`) ; acceptation d'une invitation (rôle de l'invitation) | `owner` : tout rôle ; `manager` : entre `manager` et `member`, jamais un `owner` ; dernier `owner` jamais rétrogradé (`UPDATE (role)` seul accordé) | chacun peut partir ; `owner` retire tout membre, `manager` un `manager`/`member` ; dernier `owner` protégé ; cascade depuis `families` et `users` |
| `children` (prénom chiffré AES-256-GCM, `DATA_ENCRYPTION_KEY`, données associées `children:first_name:<id>`) | `family_id` (adhésion de la session ; chaque requête filtre `id` **et** `family_id`) | membres | `owner`, `manager` (20 par famille, sous verrou) | `owner`, `manager` (prénom, couleur ; code parent par `PUT /api/children/:id/parent-code` ; jamais la famille) | `owner`, `manager` ; cascade depuis `families` |
| `allowed_contacts` (nom et numéro E.164 chiffrés, index aveugle HMAC du numéro ; 6 par enfant, ordonnés) | `family_id` + `child_id` (clé étrangère composite vers l'enfant de la même famille ; membre lié aussi de la même famille) | membres | `owner`, `manager` (enfant verrouillé : plafond et ordre justes ; numéro unique par enfant) | `owner`, `manager` (nom, numéro, couleur, membre lié, ordre ; jamais l'enfant ni la famille) | `owner`, `manager` (positions recomptées) ; cascade depuis l'enfant ; lien au membre effacé s'il quitte la famille |
| `invitations` (jeton haché, adresse invitée, rôle `manager`/`member`, 7 jours) | `family_id` (lu sur l'adhésion de la session) | `owner`, `manager` (en attente et encore acceptables, avec adresse) | `owner`, `manager` (10 en attente par famille ; une par adresse : la nouvelle remplace l'ancienne une fois son courriel parti ; enregistrée, puis envoyée hors transaction, supprimée si l'envoi échoue) | acceptation par le seul compte de l'adresse invitée, invitant encore gestionnaire, jeton consommé une fois (`UPDATE (used_at)` seul) | `owner`, `manager` (annulation) ; invitations d'un gestionnaire retiré ou rétrogradé ; cascade depuis `families` |
| `pairing_tokens` (jeton d'appairage haché, 15 min, usage unique ; porté par le QR) | `family_id` + `child_id` (clé étrangère composite vers l'enfant ; famille lue sur l'adhésion de la session) | — (jamais relu par l'API, sinon pour l'échange) | `owner`, `manager` (un seul valable par enfant : le nouveau remplace les précédents) | échange par le téléphone : `used_at` posé atomiquement, une seule fois (`UPDATE (used_at)` seul) | remplacement par un nouveau QR ; cascade depuis l'enfant |
| `child_devices` (téléphone appairé : modèle, versions ; 3 actifs par enfant) | `family_id` + `child_id` (clé étrangère composite) | membres (`GET /api/children/:id/devices`) ; le téléphone lui-même (`/api/device/me`) | échange d'un jeton d'appairage valable (`POST /api/device/pair`, enfant verrouillé) | `owner`, `manager` : révocation (`revoked_at`, sessions effacées) ; le téléphone : `last_seen_at` | cascade depuis l'enfant ; aucun DELETE accordé au rôle applicatif |
| `device_sessions` (sessions du téléphone : accès court, renouvellement tourné, rejeu détecté) | `device_id` | le hook de session des seules routes `/api/device/*` | appairage | renouvellement (`/api/device/refresh`), jamais l'appareil d'une session | révocation de l'appareil ; rejeu ; cascade |
| `device_events` (journal du téléphone : appels sortants ; nom et numéro du contact chiffrés, durée ; 90 jours, purge NAR-153) | `family_id` + `child_id` (lus sur la session d'appareil, jamais envoyés par le téléphone) | membres (journal parent, NAR-152) | le téléphone (`POST /api/device/events`, 60 lots/min) : contact d'un autre enfant refusé, contact retiré accepté avec l'instantané (nom, numéro composé), identifiant choisi par le téléphone (idempotence) | — (ajout seul : aucun UPDATE accordé) | purge à 90 jours (NAR-153) ; cascade depuis l'enfant ; contact retiré → `contact_id` effacé, instantané gardé |

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
Tests : `server/test/devices.test.js`.

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
