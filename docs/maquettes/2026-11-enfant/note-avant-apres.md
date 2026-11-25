# Akaiky enfant : maquette allégée, note avant/après

Aucun code de l'app n'a été modifié.

## Principes

1. **SOS compact.** Le footer occupait environ 31 % de la hauteur de l'écran, il en occupe maintenant environ 14 %. Il ne reste qu'un bouton SOS de 172×60 px au lieu d'un bouton pleine largeur de 130 px de haut. Il est toujours au même endroit, en bas au centre.
2. **Le 117 quitte l'accueil.** Il reste dans l'écran SOS en cours, dans l'écran d'alerte et sur les écrans sans famille.
3. **Code parent.** Il devient une petite icône cadenas en haut à droite.
4. **Horloge réduite.** Elle passe à 44 px, alignée à gauche, et la ligne Wi-Fi / batterie en double disparaît.
5. **Pastilles d'une ligne.** Les infos destinées aux parents (filtrage, localisation, école, mode parent) tiennent chacune sur une ligne.
6. **Une seule action par tuile contact.** Toute la tuile sert à appeler, avec la mention « Appeler ».
7. **Retour visuel pendant l'appui long.** L'appui de 3 s est conservé. C'est l'écran qui montre la progression, avec un voile rouge, un compte à rebours et un anneau autour du bouton.

## Écran par écran

| # | Écran (capture) | Avant | Après |
|---|---|---|---|
| 01 | Accueil (07) | Horloge géante. SOS pleine largeur, 117 et Code parent en bas. Tuile Messages coupée. | Contacts plus grands. Bouton « Dire à mes parents ». Dock SOS compact. Cadenas en haut. |
| 02 | Accueil sans contacts (04) | Deux paragraphes sur le filtrage et un bouton vert, alors que ce texte s'adresse au parent. | Une pastille « Appels pas encore filtrés » et un état vide illustré. |
| 03 | Accueil avec applis (15, 17) | Il faut faire défiler. Les applis passent sous le SOS. | Tout tient sur un écran. Les applis forment une rangée de petites icônes et « Plus » donne accès aux autres. |
| 04 | Plage école (16) | Gros bandeau bleu marine et texte redondant. | Pastille « École jusqu'à 23:30 ». Les contacts masqués apparaissent en fantôme avec l'heure de retour. |
| 05 | Mode parent (12) | Encadré blanc avec deux gros boutons. Les contacts sont coupés. | Barre verte compacte en haut avec une icône Réglages et le bouton « Reverrouiller ». |
| 06 | Paysage (26) | On ne voit qu'une demi-rangée de contacts. | Trois colonnes : l'heure à gauche, les 4 contacts au centre, le SOS rond à droite. |
| 07 | Dire à mes parents (08, 09) | Confirmation en petit texte. Bouton « Fermer » au milieu de l'écran. | Notification qui indique à qui le message est parti. La tuile envoyée est cochée. Flèche retour. |
| 08 | Code parent (10, 11) | « Fermer » est dans le pavé. L'erreur s'affiche loin des points. | Les points passent en rouge et l'erreur s'affiche juste en dessous. Touches pleines. Flèche retour. |
| 09 | Téléphone retiré (28, 29) | Boutons empilés sans hiérarchie claire. | Une carte parent avec une seule action principale. Le 117 reste disponible, avec un libellé explicite. |
| 10 | SOS, appui long (19) | Seule une bande plus foncée montre la progression. | Voile rouge, compte à rebours, anneau de progression et message « Lâche pour annuler ». |
| 11 | SOS en cours (20) | Bandeaux rouges sur fond rouge. | Liste d'étapes (fait, en cours, à venir). Le 117 en bouton blanc. « Annuler l'alerte ». |
| 12 | Alerte envoyée (23) | L'échec a la même forme que les réussites. | Les réussites apparaissent en coches. L'échec est présenté dans une carte blanche avec le bouton 117. |

Écrans non redessinés, car déjà sobres ou gérés par le système : appairage (01 à 03, 30), appel entrant (13, 14), composeur et appel Android (21, 22, 24), dialogues système (05, 06), Horloge (18), version malgache (25, même mise en page), hors ligne (27).

## À valider

- Retirer le 117 de l'accueil veut dire qu'il faut passer par le SOS pour appeler les secours. C'est un choix produit, voire réglementaire, à confirmer.
- Ajouter une vibration à chaque seconde de l'appui long sur SOS.

## Contenu de l'export

- `maquette-akaiky-allegee.pdf` : les 12 planches avant/après, une par page
- `ecrans-png/` : les 12 planches en PNG (résolution x2)
- `sources-html/` : les maquettes en HTML statique, à ouvrir dans un navigateur, avec leur CSS et leurs images
- `captures-avant/` : les captures d'origine utilisées dans les planches
