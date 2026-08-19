# My MTG Collection — Plan & état d'avancement

> Document vivant : mis à jour à chaque session de travail.
> Dernière mise à jour : **2026-08-19**

## Vision

App de collection Magic: The Gathering, belle et modulaire :
dossiers manuels, ajout par recherche intelligente ou scan caméra,
suivi des prix avec couloirs, alertes configurables sur les mouvements,
digest hebdo par email. Objectif scan : nettement plus rapide que Dragon Shield
(reconnaissance on-device, mode rafale).

## Stack (décisions arrêtées)

| Brique | Choix | Note |
|---|---|---|
| App mobile | Expo **SDK 54** / React Native 0.81, expo-router 6 | `mobile/` — app nommée **My MTG Collection**, thème grimoire : encre chaude, parchemin, or vieilli |
| Backend | Supabase (Postgres, Auth, RLS) | projet `lrpyrbhemwutvfkwpgah` |
| Données cartes & prix | Scryfall (bulk quotidien + API autocomplete) | EUR Cardmarket / USD TCGplayer ; attribution obligatoire |
| Historique prix | Construit par nous (Scryfall n'en fournit pas) | snapshots en base pour les cartes suivies + archives complètes dans `archives/` |
| Ingestion | GitHub Actions, cron 04:30 UTC | `.github/workflows/daily-prices.yml` |
| Emails | Resend (phase 2) | digest hebdo |
| Push | Expo Notifications | **débloqué** : l'app a un build natif depuis le 2026-08-19 |

## Phases

- [x] **Phase 0 — Fondation prix** *(livrée 2026-06-12)*
  Schéma SQL (cards, folders, collection_items, price_snapshots,
  collection_value_snapshots, vue card_price_stats), ingestion quotidienne,
  archives compressées, script de backfill.
- [x] **Phase 1 — App mobile core** *(livrée 2026-06-12)*
  Auth email/mdp, dashboard (valeur totale + dossiers), vue dossier,
  ajout par autocomplete Scryfall (nom → édition → finish/quantité),
  fiche carte (prix, moyenne 30 j, couloir P10–P90, graphe SVG maison).
- [x] **Phase 2 — Alertes & digest** *(code livré 2026-07-23)*
  Tables alert_rules / alert_events + fonction `evaluate_alert_rules`
  (métriques : variation %, sortie de couloir, seuils ; fenêtres 1/7/30 j ;
  canaux digest/immédiat ; dédup sur la fenêtre). Évaluation branchée dans
  `ingest.mjs` après l'ingestion. Écran Alertes dans l'app (règles avec
  activation/suppression + fil d'événements + badge non-lus au dashboard +
  bouton alerte sur la fiche carte). Emails via Resend : `send-digest.mjs`
  (immédiat après ingestion, digest hebdo le dimanche).
  Migration appliquée en base et code commité le 2026-08-18.
  **Reste manuel** : secrets GitHub `RESEND_API_KEY` et `DIGEST_FROM`.
- [x] **Phase 2.5 — Refonte UI** *(livrée 2026-08-18)*
  Direction sobre & premium : palette neutre + accent froid unique réservé
  aux actions, jeu d'icônes SVG maison en remplacement des emoji, système
  de primitives dans `ui.tsx`, barre d'onglets Collection / Alertes.
  Actions cachées derrière un appui long rendues explicites.
- [x] **Phase 3 — Scanner v1** *(code livré 2026-08-18)*
  Photo → découpe du cadre → pHash **calculé sur le téléphone** → distance de
  Hamming en SQL → candidats classés → confirmation → ajout.
  Écart assumé avec le plan initial : le hachage se fait sur l'appareil et non
  sur le serveur. On n'envoie que 25 × 64 bits au lieu d'une photo, donc pas
  de Storage ni d'Edge Function — et c'est déjà la brique de la phase 4.
  Base de référence dans Supabase : **construite une fois, elle sert à tous
  les appareils** (ni par machine, ni par téléphone). Job reprenable, il saute
  ce qui est déjà indexé. Débit mesuré : 0,21 s/carte.
  **Éprouvé sur S24 Ultra le 2026-08-19 : reconnaissance quasi systématique.**
  Deux corrections décisives après les premiers essais, tous deux invisibles
  en simulation :
  — la géométrie (orientation Android non appliquée, et découpe faite sur la
  photo entière au lieu de la zone réellement cadrée) ;
  — le descripteur : hacher la carte entière ne discrimine pas assez, toutes
  les cartes partageant la même charpente. Deux cartes différentes pouvaient
  n'être qu'à 10 bits, quand une photo à main levée en dégrade 14. **Seule
  l'illustration est hachée désormais** (paire la plus proche à 16 bits).
  Détection de carte ajoutée **en complément** du balayage de fenêtres.
  Index : 15 995 empreintes, 39 sets.
- [x] **Phase 3.5 — Publication** *(2026-08-19)*
  APK installable produit par EAS, `com.korgman.grimoire`. Six tentatives :
  verrou npm généré sous Windows inutilisable sous Linux (retiré du dépôt),
  puis deux contraintes de version Node. L'app ne dépend plus d'Expo Go.
- [ ] **Phase 4 — Scanner temps réel on-device**
  vision-camera + détection contour + pHash/embeddings locaux + vote
  multi-frames + mode rafale.
- [ ] **Phase 5 — Confort**
  Import/export CSV (Dragon Shield, Moxfield), top movers sur le dashboard,
  prix d'achat éditable, push notifications (dev build), onboarding, animations.

## Reprendre ici — au 2026-08-19

L'app tourne **en vrai** sur un S24 Ultra, installée depuis un APK. Le scanner
reconnaît les cartes. Tout est poussé sur `phase-2-alerts`.

### À faire en premier — fusionner `phase-2-alerts` dans `master`

Ce n'est pas du rangement, c'est le préalable à tout historique de prix.
Vérifié le 2026-08-19 en interrogeant la base : `price_snapshots` ne contient
que deux jours, le 17 (1 ligne) et le 18 (780 lignes), qui correspondent
exactement aux cartes ajoutées depuis l'app — celle-ci insère le prix du jour
à l'ajout. **L'ETL nocturne n'a donc jamais rien écrit**, y compris au passage
de 04:30 UTC ce matin.

Deux causes, la seconde étant la vraie :

1. le workflow n'a jamais été lancé une première fois à la main ;
2. **GitHub ne déclenche les tâches planifiées que depuis la branche par
   défaut.** Or `master` ignore encore `4f03f9d`, le commit qui répare le
   changement de format des exports Scryfall (`download_uri` →
   `jsonl_download_uri`). Le cron y exécuterait la version qui télécharge
   `undefined`.

Tant que ça n'est pas fait, ni les tendances ni les alertes n'ont de quoi se
nourrir : deux écrans entiers restent vides par construction.

Ensuite seulement : Actions → *Daily price ingestion* → Run workflow, et
vérifier qu'il passe au vert (et que l'archive est bien committée).

### Reconstruire l'app après un changement

L'APK ne se met plus à jour tout seul :

```sh
cd mobile && npm run build:apk     # ~20 min, puis QR d'installation
npm run qr                         # QR du serveur de dev, si besoin d'Expo Go
```

Pour éviter un build à chaque retouche, la piste est `expo-updates` : mises à
jour du JavaScript à distance, sans repasser par un APK.

### Prochain gain sur le scanner

Mesuré, chiffré, prêt à faire : un **ajustement de droites sur les quatre
bords** de la carte. La détection actuelle trouve la carte 25 fois sur 25 mais
la délimite mal (extrêmes de diagonale, sensibles à un pixel aberrant).

Ça débloquerait deux choses d'un coup :
- le reste du levier « détection » — 21/25 aujourd'hui contre 25/25 avec une
  détection parfaite ;
- **l'illustration en 2×2**, prête mais inutilisable en l'état : 8-16/25 avec
  la détection actuelle, 25/25 avec une détection parfaite. Elle porterait la
  marge de 25 % à 38 % des bits, ce qui deviendra nécessaire quand l'index
  passera de 16 000 à 100 000 cartes.

`scripts/phash-eval-next.mjs` compare les stratégies ; `scripts/scan-smoke.mjs`
teste contre la vraie base.

## Checklist de mise en route (étapes manuelles)

À cocher au fur et à mesure — détails dans le README :

- [x] Projet Supabase créé (ancien projet mis en pause)
- [x] Migrations SQL appliquées — **les 3 sont passées**, vérifié le 2026-08-18
      en interrogeant les tables via l'API REST
- [x] Secret GitHub `DATABASE_URL` configuré (string **Session pooler**)
- [ ] Premier run du workflow *Daily price ingestion* vérifié (vert + archive committée)
- [x] `mobile/.env` rempli (clé anon Supabase) — corrigé le 2026-08-18,
      le fichier contenait encore `placeholder-…` d'où un `Invalid API key`
- [ ] « Confirm email » désactivé dans Supabase Auth (`mailer_autoconfirm`
      était encore à `false` le 2026-08-18)
- [ ] Secrets GitHub `RESEND_API_KEY` et `DIGEST_FROM` (pour le digest email)
- [x] Migration `20260818120000_card_hashes.sql` appliquée (scanner)
- [x] Sets principaux indexés — 39 sets, 15 995 empreintes
- [x] Un vrai scan réussi (APK sur S24 Ultra)
- [ ] `phase-2-alerts` fusionnée dans `master`

## Notes techniques à retenir

- **Le pHash est un contrat.** `mobile/src/lib/phash.ts` est importé tel quel
  par l'app ET par le job d'indexation (strip-types natif de Node ≥ 22). Le
  modifier rend incomparables tous les hachages déjà en base : il faudrait
  réindexer chaque set. `scripts/phash-selftest.mjs` fige un vecteur de
  référence et le job refuse d'écrire s'il ne passe plus.
- **Ce qui fait ou défait un scan, c'est le cadrage** — pas la lumière.
  Mesuré sur 60 cartes : pénombre et surexposition restent à 60/60, tandis
  qu'une photo laissant 10 % de fond autour de la carte tombe à 31/60 avec un
  seul hachage. D'où les 25 fenêtres d'interrogation (5 échelles × 5 centres)
  qui ramènent à 60/60. De bout en bout (`scripts/scan-e2e.mjs`) : 93 % dans
  le pire cas testé, 100 % bien cadré.
- **Le scanner ne tranche jamais seul.** Les bonnes réponses vont jusqu'à
  ~12 bits de distance, et les deux cartes différentes les plus proches d'un
  set sont à 8 bits : les plages se recouvrent. L'app propose donc des
  candidats classés avec leur illustration.
- **Scryfall refuse les User-Agent par défaut** (`400 generic_user_agent`).
  Le client mobile en pose un en natif ; sur le web c'est un en-tête interdit,
  le navigateur envoie le sien.
- **`Alert.alert` n'existe pas sur react-native-web** (`static alert() {}`) :
  toute confirmation passe par `ConfirmDialog` dans `ui.tsx`.

- **Expo SDK 56** : expo-router est indépendant de React Navigation,
  structure `src/app/`, vérifier la doc v56 avant d'utiliser une API.
  Export web en mode `single` (le rendu statique casse sur AsyncStorage).
- **Free tier** : on ne snapshot en base que les cartes présentes en collection ;
  l'historique complet vit dans `archives/*.csv.gz` (~2-3 Mo/jour) et
  `npm run backfill` reconstruit l'historique d'une carte ajoutée après coup.
- **L'app insère le prix du jour** à l'ajout d'une carte (policy RLS dédiée,
  insert du jour uniquement) pour ne pas attendre l'ingestion nocturne.
- **Expo Go ne supporte plus le push** (SDK 53+) : les notifications push
  attendront un development build ; en attendant, alertes in-app + email.

## Journal

- **2026-08-19 (suite)** — Matinée ouverte sur une panne : la collection ne
  chargeait plus. Ni le serveur ni la session n'y étaient pour quelque chose —
  c'est l'ajout en masse de la veille qui a fait franchir un seuil. PostgREST
  passe ses filtres dans l'URL ; 780 UUID font 28 947 caractères, et la
  passerelle Supabase refuse au-delà de 24 Ko. Mesuré contre le serveur :
  600 ids passent, 700 repartent en 400. Requête découpée en lots de 200.
  **Ce qui a coûté le plus cher, c'est que la panne était muette** :
  `if (isLoading || !data) return <Loading />` transforme toute erreur en
  spinner éternel. Le serveur répondait un 400 franc et immédiat pendant que
  l'app tournait dans le vide. D'où `ErrorState`, branché sur les quatre
  onglets. **Leçon, jumelle de celle d'hier** : hier il fallait lire le log,
  aujourd'hui il fallait qu'il y en ait un. Une requête qui échoue doit le dire.
  Corrigé dans la foulée, un build étant de toute façon nécessaire : la barre
  d'onglets réintègre l'inset système, et `Screen` gagne `safeBottom` pour les
  écrans empilés qui ancrent un contrôle en bas.
  Ajouts : filtre de dossiers dans l'onglet Collection (sans accents ni casse,
  à partir de 5 dossiers), renommage en **My MTG Collection**, et un logo —
  trois cartes en éventail, généré par `scripts/make-icons.mjs` en six
  variantes depuis une seule description de forme.
  Découverte du jour, en répondant à « à quelle heure tourne l'ETL ? » :
  **il ne tourne pas du tout**. Voir « À faire en premier », en haut.

- **2026-08-19** — Le scanner marche pour de vrai, sur un vrai téléphone.
  Deux causes profondes trouvées et corrigées, aucune visible en simulation :
  la géométrie (orientation Android, découpe hors du cadre visé) puis le
  descripteur — hacher la carte entière ne discrimine pas assez, seules les
  illustrations le font. Détection de carte ajoutée en complément.
  Ajouts du jour : onglet Tendances (hausses/baisses 3 j / 7 j / 1 mois, en %
  ou en €), filtre de rareté sur les alertes, tri des dossiers, exemplaires
  cumulés et éditables, vue liste, déclencheur silencieux.
  Deux pannes de fond réparées : Scryfall a changé le format de ses exports
  (l’ingestion nocturne aurait échoué même une fois le secret posé), et le
  verrou npm généré sous Windows rendait tout build EAS impossible.
  Enfin : APK installé sur S24 Ultra, l’app ne dépend plus d’Expo Go.
  **Leçon de la journée** : trois pannes ont été diagnostiquées en lisant un
  journal (Metro, puis les logs de build EAS) après avoir perdu du temps à
  supposer. Lire le log d’abord.

- **2026-08-18 (suite)** — Trois chantiers. **Corrections** : les trois boutons
  de suppression ne faisaient rien sur le web (`Alert.alert` y est une méthode
  vide) → primitive `ConfirmDialog` ; `<button>` imbriqué dans la ligne de
  dossier → deux zones sœurs. **Refonte grimoire** : encre chaude, parchemin,
  or vieilli, équerres d'angle, rubriques gravées — typographie système
  inchangée. **Bulk de set** : bouton dans un dossier, ajoute une copie de
  chaque commune et peu commune (hors terrains de base), dédoublonné.
  **Phase 3 scanner** livrée (voir ci-dessus). Découverte en passant :
  Scryfall rejette les User-Agent par défaut, la recherche de cartes était
  donc probablement déjà cassée en natif.
  **Non vérifié** : rien n'a été éprouvé à l'écran ni en base — l'extension
  Chrome n'était pas connectée et tout demande d'être authentifié.
  Correction d'usage en fin de séance : l'indexation « set par set » que
  j'avais proposée passait à côté du but (scanner n'importe quelle carte).
  D'où `--main-sets`, qui indexe les 15 sets draftables des deux dernières
  années d'un coup, et un job reprenable.
  Prochaine étape : tout est dans « Reprendre ici », en haut.
- **2026-08-18** — Phase 2 commitée (elle dormait en working tree depuis
  trois semaines) sur la branche `phase-2-alerts`, puis refonte UI complète.
  Vérifications faites en séance : les 3 migrations SQL sont bien appliquées,
  `mobile/.env` contenait un placeholder au lieu de la clé anon (cause du
  `Invalid API key` à l'inscription), et les polices web tombaient en silence
  sur le serif par défaut faute d'import de `global.css`.
  **Non vérifié** : les écrans derrière l'authentification n'ont pas été
  rendus (il aurait fallu saisir le mot de passe) — seul l'écran de connexion
  a été validé visuellement. Le rendu de la barre d'onglets reste à confirmer.
  Prochaine étape : se connecter et éprouver la refonte, puis phase 3 (scanner).
- **2026-07-23** — Phase 2 (code) livrée. Moteur d'alertes SQL + évaluation
  nocturne, écran Alertes dans l'app (règles, fil d'événements, badge non-lus,
  alerte depuis la fiche carte), emails immédiat + digest hebdo via Resend.
  Typecheck et lint verts, types de routes expo-router régénérés.
  Note : `init.sql` avait été vidé par accident — restauré depuis git.
  Prochaine étape : appliquer la migration alertes + secrets Resend, puis
  démarrer la phase 3 (scanner v1).
- **2026-06-12** — Phases 0 et 1 livrées. Repo créé, workflow d'ingestion en
  place (premier run à valider), app Grimoire fonctionnelle (auth, dossiers,
  recherche, fiche carte avec graphe). Démarrage phase 2.
