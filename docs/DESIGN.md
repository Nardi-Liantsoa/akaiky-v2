# Akaiky — maquettes et jetons d'apparence

Source : « Akaiky — mobile app design.pdf » (10 écrans, reçu le 17/11/2026, hors
dépôt). Couleurs relevées sur le rendu du PDF ; la police y est vectorisée, donc
non identifiable avec certitude : arrondie et très grasse, proche de **Nunito**
(800–900 pour les titres) — à confirmer avec le designer. Retenue en attendant :
Nunito variable (Fontsource 5.3.0), sous-ensemble latin `woff2` de 39 Ko servi
par l'app (`src/assets/fonts/`, haché par Vite ; licence SIL OFL 1.1 dans `public/licenses/`), repli `ui-rounded`.

**Refonte UI/UX (NAR-221, 25/11/2026)** : audit et 7 maquettes de référence dans
`docs/maquettes/2026-11/` (accueil parent mobile et bureau, accueil public mobile et bureau,
réglages bureau, administration mobile, ajout d'un enfant). Elles priment sur le PDF du
17/11/2026 pour les écrans qu'elles montrent ; chantiers NAR-222 à NAR-226.

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

### Jetons de structure (NAR-182)

| Jeton | Valeur | Usage |
|---|---|---|
| `--on-color` | `#ffffff` | texte et fond blanc posés sur une couleur (bandeau marine, fond du QR) |
| `--warning-bg` / `--warning-ink` | `--tint-butter` / `#5c3d00` | avertissement (ni erreur ni succès), encre ≥ 7:1 |
| `--fs-h1` / `--fs-h2` | `2rem` / `1.15rem` | titres de page et de section (règles globales `h1`, `h2`) |
| `--fs-body` / `--fs-small` | `1rem` / `0.9rem` | texte courant, texte secondaire et petits boutons |
| `--space-1` … `--space-6` | 4, 8, 12, 16, 24, 32 px | espacements (échelle de 4 px) |
| `--radius-pill` | `999px` | boutons et puces |
| `--tap` / `--tap-child` | `48px` / `64px` | zone tactile minimale, app parent / app enfant |
| `--focus-ring` / `--focus-offset` | `3px solid var(--accent)` / `2px` | anneau de focus clavier |

`h1` et `h2` sont stylés globalement (`src/style.css`) : un composant ne redéfinit que
la marge, ou la taille quand l'écran l'exige (écrans enfant, titres de jour du journal).

## Composants d'interface (`src/components/ui/`)

- **`AppButton`** — tout bouton d'action. `variant` : `primary` (défaut, fond `--accent`),
  `ghost` (contour), `danger` (fond `--danger`), `link` (texte souligné), `danger-link`
  (texte souligné rouge) ; `small` (texte `--fs-small`, moins de marge interne) et
  `block` (pleine largeur) se combinent avec toute variante. Toujours ≥ `--tap` (48 px) de
  haut, `type="button"` par défaut (`type="submit"` à demander), anneau `--focus-ring` au
  clavier ; désactivé en couleurs pleines (`--text-mute` sur `--surface-muted`), lisible.
  **Jamais désactivé pour une saisie incomplète** (NAR-222) : seulement pendant un envoi
  (`busy`). Le formulaire (`novalidate`) vérifie à l'envoi, montre l'erreur sous chaque champ
  fautif (`FormField` `error`, textes `t.forms.*`) et met le focus sur le premier
  (`focusFirstInvalid`, `src/lib/formErrors.ts`) ; rien à enregistrer : un message le dit.
  Les classes globales `.btn`, `.btn-ghost`… restent pour un `RouterLink` présenté en bouton.
- **`AppIcon`** — icône du jeu unique `src/components/ui/icons.ts` (tracés en ligne, sans
  bibliothèque), par `name`. Décorative par défaut (`aria-hidden`) ; avec `label`, image
  nommée (`role="img"`). `size` fixe la largeur (24 par défaut), la hauteur suit le cadre.
  Une icône nouvelle s'ajoute au jeu, jamais en `<svg>` local.
- **`StatusBlock`** (NAR-183) — tout état de chargement, d'erreur de chargement ou de liste
  vide. `state` : `loading` (anneau `--accent` sur `--surface-muted` et texte visibles, zone
  `role="status"` lue une fois ; anneau immobile sous `prefers-reduced-motion`), `error`
  (bandeau `.error`, `role="alert"`, « Réessayer » en `AppButton` ghost, événement `retry`),
  `empty` (texte `--text-soft`, emplacement `action` facultatif). `fill` réserve la hauteur
  d'une zone de page, `card` le présente en carte. Un écran garde **un seul** bloc de
  chargement du début à la fin (famille puis enfants) pour n'être annoncé qu'une fois ; les
  relectures qui laissent le contenu affiché gardent leur estompage (`aria-busy`).
- **`SectionCard`** (NAR-186) — carte de section : `title` en `h2` qui nomme la `<section>`,
  `help` facultatif dessous (classe globale `.help`, `--text-soft`), emplacement `aside` à
  droite du titre (compteur), contenu en emplacement par défaut. `level="1"` (NAR-185) : le
  titre devient le `h1` de la page quand la carte l'occupe seule, avec l'apparence d'un `h2`.
- **`ToggleSwitch`** (NAR-186) — interrupteur : `<button role="switch" aria-checked>`, zone
  ≥ `--tap`, `v-model` contrôlé (l'état affiché reste celui du parent, pas d'affichage
  anticipé), `disabled`, libellé dans le bouton (`hideLabel` : lu seulement), `description`
  reliée par `aria-describedby`. Sélectionnable en e2e par `getByRole('switch', { name })`.
- **`FormField`** (NAR-186) — champ : libellé (`for`/`id`), `help` et `error` reliés par
  `aria-describedby`, `aria-invalid` sur erreur. Le champ vient de l'emplacement, qui reçoit
  `control` à poser dessus (`v-bind="control"`) ; id généré si absent. Libellés de champ en
  casse normale, `--fs-small`, `--text-soft` (≥ 7:1).
- **`PageHeader`** (NAR-222, maquette 07) — en-tête des sous-écrans : flèche de retour seule
  (vrai lien, ≥ `--tap`, nommée par `backLabel`, clic par `backTo`), `title` en `h1` centré
  (absent pendant un chargement), emplacement `aside` à droite (sélecteur d'enfant). Ajout et
  modification d'un enfant ou d'un contact, appairage, Mon compte. Les sections de Réglages
  gardent `BackLink` jusqu'au maître/détail de NAR-223.
- **`ColorPicker`** (NAR-207, NAR-222) — couleur d'avatar : vrais boutons radio (flèches du
  clavier), nom écrit sous chaque pastille, coche sur fond `--ink` sur la couleur choisie ;
  à l'ajout, la moins portée est choisie d'office (`leastUsedColor`, même règle que le serveur).
- **Champs** (NAR-222) : `.input` blanc (`--surface`), bord `--border-strong` de 1,5 px, anneau
  de 3 px au focus, bord `--danger` si `aria-invalid` ; exemple de saisie en italique
  `--text-mute`, jamais confondu avec une valeur. Case de consentement encadrée, texte en
  taille normale, bord `--danger` sur erreur.
- **Mise en page de l'ordinateur** (NAR-223, maquettes 02 et 05) — ≥ 1024 px (`DESKTOP`,
  `useMediaQuery`) : barre latérale de `--rail-width` (248 px) pleine hauteur, nom de l'app en
  tête, onglets en lignes (actif sur `--accent-soft`), compte (nom, famille) en bas vers Mon
  compte ; seuls les onglets portent `aria-current`. Routes `meta.wide` (accueil, Réglages) :
  colonne de 1200 px, les autres gardent 720 px. Accueil : cartes à gauche, « Aujourd'hui » de
  l'enfant choisi à droite (sa carte ne le répète pas). Réglages : maître/détail, liste montée à
  gauche (rien n'est relu en changeant de section, `aria-current` sur la section ouverte),
  section à droite en `h2` sous le `h1` « Réglages » ; `/espace/reglages` ouvre la première
  section par `replace`. Sous 1024 px : rien ne change (une page par section). Tests e2e de
  parcours à 960 px ; mise en page de l'ordinateur : `desktop-layout.spec.ts`,
  `wide-navigation.spec.ts`.
- **Accueil parent et carte enfant** (NAR-227, maquettes 01 et 02) — en-tête « Bonjour Hanta »
  + initiale du compte (téléphone), date du jour + « + Ajouter un enfant » (ordinateur), titre
  « Vos enfants ». Carte : bord jaune (à vérifier) ou rouge (ne répond plus), badge d'état et
  « vu à », bandeau « Batterie faible · 12 % » + « Signalé il y a … . Pensez à lui rappeler de
  charger. », puis **Appeler** (plein) et **Message** (teinté `--accent-soft` / `--accent-deep`),
  puis pastilles compactes icône + valeur (en défaut : rouge), puis la ligne « Aujourd'hui · N
  appels, N bloqués › » (`TodaySummary`). Sans téléphone : « Téléphone non relié », phrase en
  3 étapes, « Relier le téléphone » avec l'icône QR. « ⋯ » sans contour. Ordinateur : panneau
  « Derniers événements » à droite, « Voir tout le journal › » en bas ; actions teintées
  (« Autoriser ce numéro »).
- **`DisclosureCard`** (NAR-228) — section repliable d'une page longue : `<details>`/`<summary>`
  natifs (clavier et lecteur d'écran sans code), pastille d'icône ronde (`icon`, comme les lignes
  de Réglages), titre en `h2`, résumé d'une ligne, chevron qui tourne à l'ouverture ; `open`
  pour la déplier d'office. Une `.card` rangée dedans perd son cadre (pas de double marge).
- **Page Famille** (NAR-228, design créé sans maquette d'après Réglages) — carte du nom
  (« Renommer » avec icône crayon), puis « Membres et invitations » (dépliée d'office,
  « N membres »), « Données de la famille » (gestionnaires ; texte à gauche, « Exporter » à
  droite), lien « Mon compte » au même gabarit (icône compte, résumé, chevron) ; zone sensible
  seule en bas. Boutons de formulaire avec icône : créer (plus), enregistrer (coche), annuler,
  retirer et quitter (croix), envoyer l'invitation (enveloppe), exporter (téléchargement).
  Création de la famille : la langue, puis deux liens discrets « Mon compte » (seul accès au
  compte sans famille) et « Déconnexion ».
- **Mon compte** (NAR-228) — chaque carte (`SectionCard` `icon`) porte sa pastille : langue et
  session (globe), notifications (cloche), double authentification (bouclier), navigateurs
  (écran), application mobile (téléphone) ; boutons avec icône : déconnexion, nouveaux codes,
  retirer (croix), supprimer (corbeille).
- **Configurer le téléphone** (NAR-229, design créé sans maquette) — étapes en pastilles
  numérotées (cercle `--accent`), chacune avec son icône dans une tuile `--surface-muted`
  (réinitialiser, toucher l'écran, scanner le QR) ; « Étape n sur 3 » lu seulement. Ordinateur
  (`meta.wide`) : étapes à gauche, QR à droite, affiché au clic comme sur téléphone (un nouveau
  jeton annule le QR déjà affiché ailleurs : jamais créé sans geste). Boutons avec icône (QR, nouveau QR, retirer) ; titre « Téléphones
  appairés » avec la pastille téléphone, cartes des téléphones sans icône (demande utilisateur).
- **Journal** (NAR-231, design créé sans maquette, d'après les cartes et les lignes du journal) —
  tuiles du jour sans titre visible (« Aujourd'hui en bref » lu par les lecteurs d'écran seulement), blanches (`--surface`, `--radius`), pastille d'icône teintée
  44 px identique à celle des lignes (appels `--tint-sky`, bloqués rouge, messages `--tint-mint`,
  sorties du verrou `--tint-butter`), nombre puis libellé ; nombre de bloqués en rouge dès 1 ;
  tuile active : bord `--accent`, fond `--accent-soft`, coche dans la pastille `--accent`. « Aujourd'hui » défile dans sa
  carte (440 px ou la moitié de l'écran au plus ; au bout, le défilement passe à la page) ; numéro d'un appel bloqué jamais coupé (heure en haut à droite de la ligne).
  Sélecteur de jour (NAR-233) sous le titre : ‹ · [calendrier] jour affiché · ›, pastilles de 48 px
  bordées comme le sélecteur d'enfant ; « Aujourd'hui », « Hier », sinon la date en toutes lettres ;
  le bouton du milieu ouvre le calendrier natif ; 90 jours au plus, jamais demain (› grisé). Une
  seule carte par jour affiché, sans titre de jour (le sélecteur le dit) ; « Rien ce jour-là. »
  Sélecteur d'enfant (dès deux enfants) à droite du titre, sur la même ligne (position de la
  maquette 05 ; les onglets avatars de la maquette viendront avec Réglages, NAR-232). Réglages au
  téléphone : même place, à droite du titre ou du retour « ‹ Réglages » dans une section.
- **Invitation** (NAR-230, design créé sans maquette) — carte centrée, pastille enveloppe
  (`--accent-soft` / `--accent-deep`), « Hanta vous invite dans « Famille Rakoto » comme
  Contact. » (sans invitant connu : « Vous êtes invité à rejoindre… »), « Rejoindre la famille »
  pleine largeur avec coche ; connexion et inscription avec
  leurs icônes.
- **`BackLink`** (NAR-195) — lien de retour en tête d'écran (« ‹ Réglages », « ‹ Accueil ») :
  chevron + libellé `--accent`, ≥ `--tap`, vrai lien (`href`) dont le clic passe par `backTo`
  (`src/lib/navigation.ts` : retour de l'historique si l'écran précédent est la cible, sinon
  remplacement) ; `ariaLabel` donne le nom complet lu. Remplace tout « Annuler » de navigation.

Tout autre contrôle sans règle de focus propre reçoit l'anneau par une règle globale de
spécificité nulle (`:where(button, a, …):focus-visible`).

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

App **parent** (Android + iOS), barre d'onglets Accueil · Journal · Réglages · Famille. Selon la
largeur (NAR-208) : barre du bas sur téléphone ; à partir de 768 px, onglets regroupés au centre
sous la colonne de contenu (720 px) ; à partir de 1024 px, rail à gauche (`--rail-width`, 96 px),
onglets empilés en haut, colonne centrée dans la place restante. Mêmes liens et même ordre partout :

6. **Accueil** — sélecteur d'enfant en puces (+ ajouter), carte enfant (joignable / vu
   il y a…, mode), tuiles Batterie · Réseau · Carte SIM, « Appeler Fy », « Où est Fy ? »
   (+ mention « Fy verra que vous consultez sa position »), « Aujourd'hui » (extrait du journal).
7. **Alerte SOS** — bandeau rouge « Fy a besoin d'aide », heure, batterie ; carte avec
   cercle de précision ; adresse approximative « En direct · mis à jour il y a 8 s ·
   ±15 m » ; qui est appelé / qui a vu ; Appeler · J'arrive · Je prends en charge.
8. **Réglages** (téléphone de l'enfant) — contacts autorisés ordonnés par glisser
   (« L'ordre sert aussi pour les appels SOS », 4 sur 6, rôle de chacun), applications
   autorisées en puces, plage « École », sirène pendant un SOS, « Déverrouiller 15 min ».
   Depuis NAR-185 : un **résumé** (une ligne ≥ 48 px par section : icône, titre, état réel
   en une ligne, chevron ; tient sans défiler à 360 px pour un enfant), chaque section sur
   sa page (`/espace/reglages/<section>`, retour « ‹ Réglages » = retour de l'historique),
   sélecteur d'enfant en haut, même enfant partout.
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
