# Akaiky (akaiky-v2)

Application parent et téléphone d'enfant (CdC v0.1). Décisions : `CLAUDE.md` ; maquettes : `docs/DESIGN.md`.

Vue 3 + TypeScript (front) et Fastify + PostgreSQL (API), dans une seule image
servie sur une seule origine. Authentification au modèle Deploy4000 :
session serveur en cookie `HttpOnly`, protection CSRF en trois couches, scrypt,
garde de connexion, double authentification TOTP obligatoire pour les admins,
récupération de compte, journal d'audit. Pour l'application native, jeton
Bearer court et jeton de renouvellement tourné à chaque usage.

## Développer

```bash
npm install                       # installe aussi server/
cp server/.env.dev.example server/.env.dev
npm run dev:db                    # PostgreSQL sur 127.0.0.1:5433
npm run dev:seed                  # comptes de test, affichés dans le terminal
npm run dev:api                   # API sur :8787 (migrations au démarrage)
npm run dev                       # front sur :5173, /api relayé vers l'API
```

Sans `SMTP_HOST`, les emails (confirmation, réinitialisation) s'affichent dans
le terminal de l'API, lien compris.

Admin local : `admin@local.test` doit activer sa double authentification à la
première connexion. Invitation :

```bash
cd server && node --env-file=.env.dev bin/mfa-invite.js admin@local.test /tmp/invitation.txt && cat /tmp/invitation.txt
```

## Tester

```bash
npm run test:all                  # vérification de types + build, tests front, tests API
```

Les tests de l'API tournent contre une **vraie PostgreSQL jetable** lancée par
Docker (ou `TEST_DATABASE_URL`) : verrous, contraintes et droits SQL sont
justement ce qu'ils vérifient.

## Où mettre quoi

| | |
|---|---|
| Nouvelle ressource métier | `server/src/routes/<ressource>.js` sur le modèle de `notes.js`, sa migration, son test « A ne touche pas la ressource de B » sur le modèle de `test/notes.test.js` |
| Route publique | `{ config: { public: true } }` — sinon elle exige une session |
| Route d'administration | `{ config: { admin: true } }` |
| Nouvelle variable | `server/src/config.js` (refus de démarrer si dangereuse en production) + `NOSYHOST.md` |
| Texte d'interface | `src/i18n/messages.ts`, en malgache, français et anglais |

`notes` est un exemple : à remplacer par les ressources du projet.

Hébergement : `NOSYHOST.md`. Limites assumées : `HANDOFF.md`.
