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
    hors Play Store. Variante Android à poser dans le ticket d'appairage.
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
| `invitations` (jeton haché, adresse invitée, rôle `manager`/`member`, 7 jours) | `family_id` (lu sur l'adhésion de la session) | `owner`, `manager` (en attente, avec adresse) | `owner`, `manager` (10 en attente par famille ; une par adresse, la nouvelle remplace l'ancienne ; courriel envoyé avant validation) | acceptation par le seul compte de l'adresse invitée, invitant encore gestionnaire, jeton consommé une fois (`UPDATE (used_at)` seul) | `owner`, `manager` (annulation) ; invitations d'un gestionnaire retiré ou rétrogradé ; cascade depuis `families` |

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
