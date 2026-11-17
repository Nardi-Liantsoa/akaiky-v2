# Akaiky — maquettes et jetons d'apparence

Source : « Akaiky — mobile app design.pdf » (10 écrans, reçu le 17/11/2026, hors
dépôt). Couleurs relevées sur le rendu du PDF ; la police y est vectorisée, donc
non identifiable avec certitude : arrondie et très grasse, proche de **Nunito**
(800–900 pour les titres) — à confirmer avec le designer. Retenue en attendant :
Nunito variable (Fontsource 5.3.0), sous-ensemble latin `woff2` de 39 Ko servi
par l'app (`src/assets/fonts/`, haché par Vite ; licence SIL OFL 1.1 dans `public/licenses/`), repli `ui-rounded`.

**Mode sombre** : absent des maquettes, désactivé explicitement (`color-scheme: light`).

## Jetons (posés dans `src/style.css`, jamais de valeur en dur dans un composant)

| Jeton | Valeur | Usage |
|---|---|---|
| `--bg-child` | `#fff8ee` | fond de l'app enfant |
| `--bg-child-school` | `#e9f0f8` | fond enfant pendant la plage « école » |
| `--bg-parent` | `#f6f3ee` | fond de l'app parent |
| `--surface-card` (alias `--surface`) | `#ffffff` | cartes |
| `--surface-muted` | `#e9e5dc` | puces, tuiles d'état |
| `--ink` | `#1c2431` | texte principal, bouton « Je prends en charge », toast |
| `--sos` | `#c8261b` | bouton SOS, écran de maintien, bandeau d'alerte parent |
| `--sos-deep` | `#8e170f` | écran « Alerte envoyée » |
| `--call` | `#0b795c` | appeler, actions positives, onglet actif |
| `--navy` | `#203f82` | « J'arrive », bandeau « école » |
| `--tint-peach` / `--accent-orange` | `#ffe3ce` / `#e9814a` | contact 1 (Maman), « Viens me chercher » |
| `--tint-sky` / `--accent-blue` | `#d6edff` / `#3d80d1` | contact 2 (Papa), « Tout va bien », « Où est … ? » |
| `--tint-lilac` / `--accent-violet` | `#e9e1f9` / `#7b5ccc` (approx.) | contact 3 |
| `--tint-mint` | `#d5f1e3` | contact 4, « Je suis arrivé », puces « autorisé » |
| `--tint-butter` / `--accent-yellow` | `#fef0c1` / `#f6b82f` | « Je suis en retard », avertissements, Messages |

Rayons généreux (≈ 24 px pour les cartes, pilule pour boutons et puces).
Zones tactiles enfant ≥ 64 px (CdC §7.3) ; les vignettes de contact en font bien plus.

## Écrans

App **enfant** (Android, mode appareil dédié) :

1. **Accueil** — heure et date en grand, réseau et batterie ; indicateur « Papa regarde
   où tu es » ; grille 2×2 de contacts (initiale ou photo, prénom, pastille d'appel,
   une teinte par contact) ; rangée d'apps autorisées (Messages, Photo, Calcul, École) ;
   bouton SOS « Appuie fort 3 secondes ».
2. **SOS — maintien** — fond rouge, « Continue d'appuyer… », anneau de progression et
   décompte, trois traits d'étape, « Lâche pour arrêter » ; vibration à chaque seconde,
   rien n'est envoyé tant que le cercle n'est pas plein.
3. **SOS — envoyée** — « Alerte envoyée », trois étapes (parents prévenus, cascade
   d'appels en cours, position partagée toutes les 30 s), « Appeler les secours · 117 »
   (numéro selon le pays), « Annuler · encore 4 s ».
4. **Messages rapides** — « Dire à mes parents », quatre grandes tuiles icône + texte,
   toast de confirmation « … envoyé · Maman l'a vu · 16:05 ».
5. **Plage « école »** — bandeau « C'est l'heure de l'école · Jusqu'à 16:00 », seuls les
   parents restent, « Le reste revient à 16:00 », SOS toujours là.

App **parent** (Android + iOS), barre d'onglets Accueil · Journal · Réglages · Famille :

6. **Accueil** — sélecteur d'enfant en puces (+ ajouter), carte enfant (joignable / vu
   il y a…, mode), tuiles Batterie · Réseau · Carte SIM, « Appeler Fy », « Où est Fy ? »
   (+ mention « Fy verra que vous consultez sa position »), « Aujourd'hui » (extrait du journal).
7. **Alerte SOS** — bandeau rouge « Fy a besoin d'aide », heure, batterie ; carte avec
   cercle de précision ; adresse approximative « En direct · mis à jour il y a 8 s ·
   ±15 m » ; qui est appelé / qui a vu ; Appeler · J'arrive · Je prends en charge.
8. **Réglages** (téléphone de l'enfant) — contacts autorisés ordonnés par glisser
   (« L'ordre sert aussi pour les appels SOS », 4 sur 6, rôle de chacun), applications
   autorisées en puces, plage « École », sirène pendant un SOS, « Déverrouiller 15 min ».
9. **Journal** — filtres Tout · Appels · Bloqués · Messages · SOS, groupé par jour,
   « Autoriser » sur un appel bloqué, mention « gardé 90 jours, puis effacé ».
10. **Appairage, étape 3 sur 3** — QR « Valable 15 minutes · usage unique », liste des
    étapes (réinitialisé, 6 touches sur l'écran de bienvenue, scanner + Wi-Fi), mise en
    garde « verrouillé, sortie avec le code parent à 6 chiffres ».

## Écarts à trancher entre maquette et cahier des charges

- **Carte** (écran 7) : fond de carte à choisir sans service tiers qui verrait les
  positions d'enfants (CdC §7.1) — `ampy-carte`.
- **« Appeler les secours · 117 »** : 117 est le numéro de police à Madagascar ; dépend
  du marché (CdC §12.1).
- **« Messages » dans la rangée d'apps enfant** : la maquette en fait une app ; le CdC
  la place à part (§4.4). Même écran, à garder hors du quota de 2 à 4 apps autorisées.
- **Écran 6 « Mode libre »** : correspond à la sortie temporaire du mode verrouillé
  (§5.3) ; libellé à valider.
- Écrans absents de la maquette : inscription, famille / invitations, code parent,
  back-office, réception d'un appel entrant, journal d'une plage horaire, consentement RGPD.
