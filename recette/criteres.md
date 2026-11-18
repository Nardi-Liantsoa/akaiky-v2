# Critères d'acceptation — Akaiky

Liste écrite au cadrage, validée avec le client : c'est ce qui a été vendu.
Chaque ligne `[Cnn]` doit être couverte par au moins un test de recette marqué
`@Cnn` (`tests/recette/` sur le vrai back, `tests/visual/` pour les rendus), et
tous ces tests doivent passer avant la préproduction. `npm run recette` vérifie
les deux et écrit `test-results/recette-rapport.md`.

Règles : une phrase par critère, du point de vue de l'utilisateur, vérifiable
par oui ou non. Un changement de périmètre = une ligne ajoutée, modifiée ou
retirée ici, dans le même commit que ses tests. Un numéro retiré n'est jamais
réutilisé. Un critère pas encore construit s'écrit `- [Cnn] (prévu) …` : il
n'empêche pas une PR, mais la préproduction exige qu'il n'en reste aucun.

## Compte (fourni par le starter app-propre)

- [C01] Un visiteur crée un compte, confirme son adresse par le lien reçu par email et entre dans son espace.
- [C02] Un mauvais mot de passe est refusé ; un client connecté se déconnecte et ne voit plus son espace.

## Métier

Source : cahier des charges Akaiky v0.1 du 16/11/2026, §11 (numéro du cahier
entre parenthèses). Ceux marqués « natif » se vérifient sur un vrai téléphone
Android (mode appareil dédié, appels, SMS) : Playwright ne les atteint pas,
leur moyen de preuve est à fixer avec le ticket qui les construit.

- [C03] Un parent crée un compte, ajoute un enfant et obtient un QR d'appairage. (CdC C01)
- [C04] (prévu) Un téléphone Android réinitialisé, qui scanne ce QR, se configure et s'ouvre sur l'écran de l'enfant sans autre manipulation. (CdC C02, natif)
- [C05] (prévu) Sur le téléphone de l'enfant, il est impossible d'ouvrir les réglages, le Play Store, le navigateur ou une application non autorisée sans le code parent. (CdC C03, natif)
- [C06] (prévu) Après un redémarrage, le téléphone de l'enfant revient directement sur son écran d'accueil. (CdC C04, natif)
- [C07] (prévu) L'enfant appelle un contact autorisé en un seul appui. (CdC C05, natif)
- [C08] (prévu) Un numéro qui n'est pas dans les contacts autorisés ne fait pas sonner le téléphone de l'enfant, et l'appel apparaît dans le journal du parent. (CdC C06, natif)
- [C09] (prévu) Le numéro d'urgence du pays est toujours appelable depuis le téléphone de l'enfant. (CdC C07, natif)
- [C10] (prévu) Un appui de 3 secondes sur SOS déclenche, en moins de 10 secondes, une alerte avec la position sur l'application de chaque parent. (CdC C08)
- [C11] (prévu) Sans Internet sur le téléphone de l'enfant, un SOS envoie quand même un SMS avec la position à chaque parent. (CdC C09, natif)
- [C12] (prévu) Pendant un SOS, si le parent 1 ne décroche pas, le téléphone appelle le parent 2. (CdC C10, natif)
- [C13] (prévu) Un parent qui marque le SOS « pris en charge » est visible comme tel par les autres parents. (CdC C11)
- [C14] (prévu) Un message rapide envoyé par l'enfant arrive chez les parents. (CdC C12)
- [C15] (prévu) Une modification des contacts ou des applications autorisées faite par le parent s'applique sur le téléphone de l'enfant en moins d'une minute, s'il est connecté. (CdC C13)
- [C16] (prévu) Pendant une plage horaire « école », seuls les parents et le SOS restent utilisables. (CdC C14)
- [C17] (prévu) Le parent reçoit une alerte quand la batterie de l'enfant passe sous 15 %. (CdC C15)
- [C18] (prévu) Un proche invité avec le rôle « contact » appelle l'enfant et reçoit les SOS, mais ne peut modifier aucun réglage. (CdC C16)
- [C19] (prévu) Un parent ne voit jamais les données d'une autre famille. (CdC C17)
- [C20] (prévu) Les positions de plus de 30 jours sont supprimées. (CdC C18)
- [C21] (prévu) La suppression du compte efface les données de la famille. (CdC C19)
- [C22] (prévu) L'application est disponible en malgache, en français et en anglais. (CdC C20)

## Qualité, sur toutes les pages

- [C90] Aucune page ne produit d'erreur JavaScript ni d'appel vers un service tiers.
- [C91] Toute modification visuelle des pages clés est signalée avant fusion (comparaison avec `main`, ordinateur et iPhone).
