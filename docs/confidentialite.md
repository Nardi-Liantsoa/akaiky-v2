# Politique de confidentialité d'Akaiky

> **BROUILLON (NAR-178, 19/11/2026)** — à valider avec le client et un juriste avant toute
> publication. Les passages « à compléter » ou « à préciser » ne sont pas encore tranchés.

## 1. Qui traite vos données

Le responsable du traitement est **à compléter** (nom de la société cliente, adresse, numéro
d'immatriculation). L'application est développée par NosyTech et hébergée par NosyHost.

Contact pour toute question sur vos données : **à compléter** (adresse électronique dédiée).

## 2. Les données que nous gardons

Akaiky relie des parents au téléphone de leurs enfants. Nous ne gardons que ce qui sert à ce
service.

- **Votre compte** : nom, adresse électronique, mot de passe (jamais en clair : seule une
  empreinte irréversible est gardée), date de votre consentement, date de confirmation de
  l'adresse, et, si vous l'activez, la double authentification.
- **Vos sessions** : les appareils et navigateurs connectés à votre compte, pour que vous
  restiez connecté et puissiez les déconnecter à distance.
- **Votre famille** : son nom, son fuseau horaire, la liste de ses membres et leur rôle
  (parent principal, gestionnaire, contact), et les invitations en attente (adresse invitée,
  rôle, date d'expiration).
- **Vos enfants** : prénom (chiffré), couleur de l'avatar, date d'ajout, date et auteur du
  consentement parental, date du dernier code parent (le code lui-même n'est gardé que sous
  forme d'empreinte).
- **Les contacts autorisés de chaque enfant** : nom et numéro de téléphone (chiffrés), ordre,
  et, s'il y a lieu, le membre de la famille auquel le contact correspond.
- **Le téléphone de l'enfant** : modèle, versions du système et de l'application, date
  d'appairage, dernier passage, date de déconnexion le cas échéant.
- **Les plages horaires « école »** : nom (chiffré), jours et heures.
- **Les messages rapides** : texte des quatre messages choisis par les parents (chiffré), et
  chaque message envoyé par l'enfant (emplacement, date, texte en vigueur, qui l'a vu).
- **Le journal du téléphone** : appels passés, reçus et refusés (nom et numéro chiffrés,
  durée), sorties du mode verrouillé (code ou à distance, durée).
- **Les positions** : pas encore collectées. Quand cette fonction existera, elles seront
  décrites ici.
- **Le journal de sécurité** : connexions, changements sensibles et adresse IP, pour détecter
  et comprendre une attaque.

Les données les plus sensibles (prénoms, noms, numéros, textes) sont chiffrées dans la base.

## 3. Pourquoi

- Faire fonctionner le service : appels entre parents et enfant, filtrage des appels, plages
  « école », messages rapides, alertes.
- Permettre aux parents de suivre l'activité du téléphone de leur enfant (journal).
- Protéger les comptes : connexion, double authentification, détection des abus.

Aucune donnée n'est vendue, ni utilisée pour de la publicité ou du profilage.

## 4. Combien de temps

| Donnée | Durée |
|---|---|
| Journal du téléphone (appels, sorties du verrou) | 90 jours, comptés depuis sa réception par le serveur |
| Messages rapides envoyés par l'enfant | 90 jours, comptés depuis leur réception par le serveur |
| Journal de sécurité | 1 an ; l'adresse IP en est effacée au bout de 90 jours |
| Sessions | 30 jours après la fin de leur renouvellement |
| Liens de confirmation et de réinitialisation | jusqu'à leur expiration |
| Positions (fonction à venir) | 30 jours |
| Compte, famille, enfants, contacts, réglages | tant que le compte ou la famille existe |

## 5. Suppression

- **Supprimer la famille** (parent principal, depuis l'application) efface immédiatement
  la famille, ses enfants, leurs contacts, téléphones, réglages, messages et journal ; les
  téléphones sont déconnectés et les autres membres prévenus par courriel.
- **Supprimer son compte** (depuis « Sécurité ») efface immédiatement le compte, ses
  sessions et son adhésion. Un parent principal doit d'abord céder ce rôle ou supprimer la
  famille.

**Sauvegardes** : les données supprimées restent dans les sauvegardes de la base jusqu'à leur
rotation, puis disparaissent. Durée de conservation des sauvegardes : **à préciser avec
NosyHost**.

## 6. Où

Toutes les données sont hébergées en Europe, chez NosyHost. Aucun service tiers de stockage,
de cartographie ou de mesure d'audience ne les voit.

Les notifications (à venir) passeront par les services de Google (Firebase Cloud Messaging, Android) et
d’Apple (APNs, iOS), qui ne recevront que le contenu de la notification.

## 7. Aucun traceur

L'application et le site n'utilisent ni publicité, ni mesure d'audience, ni traceur tiers.
Les seuls cookies sont ceux de la connexion (session, appareil de confiance), indispensables
au service.

## 8. Consentement

- À l'inscription, vous confirmez être majeur·e, être titulaire de l'autorité parentale sur
  les enfants que vous ajouterez.
- À l'ajout de chaque enfant, vous confirmez être titulaire de l'autorité parentale sur lui
  et accepter que ses appels et messages soient journalisés pendant 90 jours.

La date de chacun de ces consentements est gardée. Les comptes créés avant l'existence de ces
cases n'en ont pas.

## 9. Vos droits

- **Accès et portabilité** : le parent principal et les gestionnaires téléchargent toutes les
  données de la famille depuis « Sécurité » → « Exporter les données de la famille » (fichier
  JSON, depuis la version web). Par enfant, le fichier contient les 5000 derniers évènements du
  journal et les 2000 derniers messages rapides ; une mention signale les plus anciens non
  inclus. Un contact peut demander cet export au parent principal.
- **Rectification** : noms, prénoms, contacts et réglages se modifient dans l'application.
- **Effacement** : voir § 5.
- **Opposition, limitation, réclamation** : écrire au contact ci-dessus. Vous pouvez aussi
  saisir l'autorité de protection des données compétente (**à compléter** selon le marché :
  CNIL en France, Commission Malagasy sur l'Informatique et les Libertés à Madagascar).
