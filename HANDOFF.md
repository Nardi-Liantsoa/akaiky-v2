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
- **Journal d'audit** : durée de conservation à fixer (RGPD), l'IP n'y reste pas indéfiniment.
- **Traductions malgaches** : à faire relire par une personne de langue maternelle.
