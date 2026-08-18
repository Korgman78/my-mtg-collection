# my-mtg-collection

Application de gestion de collection Magic: The Gathering avec suivi de prix,
couloirs de prix et alertes. Données cartes et prix : [Scryfall](https://scryfall.com)
(prix EUR Cardmarket / USD TCGplayer, mis à jour quotidiennement).

> L'app affichera l'attribution « Powered by Scryfall » (exigée par leurs CGU).

## Architecture

- **Supabase** : Postgres + Auth + RLS — schéma dans `supabase/migrations/`.
- **GitHub Actions** (`.github/workflows/daily-prices.yml`) : chaque nuit,
  télécharge le bulk Scryfall, snapshot les prix des cartes suivies en base,
  et archive un extrait `(id, prix)` de toutes les cartes dans `archives/`.
- **`archives/`** : un `csv.gz` (~2-3 Mo) par jour. Permet de reconstruire
  l'historique d'une carte ajoutée à la collection après coup (`npm run backfill`).
- **App mobile « Grimoire »** (`mobile/`) : Expo / React Native (SDK 56, expo-router).
  Auth email/mot de passe, dossiers, recherche autocomplete Scryfall, fiche carte
  avec graphe de prix et couloir P10–P90.

## Mise en route (une seule fois)

1. **Créer le projet Supabase** sur [supabase.com](https://supabase.com)
   (si besoin, mettre en pause un ancien projet : Settings → General → Pause project).
2. **Appliquer les migrations** : dashboard → SQL Editor → coller puis exécuter,
   dans l'ordre, le contenu de chaque fichier de `supabase/migrations/`.
   (Ou avec la CLI : `supabase link --project-ref <ref>` puis `supabase db push`.)
3. **Récupérer la connection string** : dashboard → Connect →
   *Session pooler* (port 5432). ⚠️ Prendre le **pooler** (`...pooler.supabase.com`),
   pas la connexion directe : GitHub Actions n'a pas d'IPv6.
4. **Créer le repo GitHub** (privé) et pousser ce projet.
5. **Ajouter le secret** : repo GitHub → Settings → Secrets and variables →
   Actions → New repository secret → nom `DATABASE_URL`, valeur = la connection
   string de l'étape 3 (avec le mot de passe).
6. **Tester** : onglet Actions → *Daily price ingestion* → Run workflow.
   Le run doit se terminer en vert et commiter `archives/<date>.csv.gz`.

Ensuite le job tourne tout seul chaque nuit à 04:30 UTC.

## Lancer l'app mobile

1. `cd mobile` puis copie `.env.example` vers `.env` et renseigne
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` (dashboard Supabase → Settings → API Keys →
   clé `anon` / `publishable`).
2. Optionnel mais recommandé pour tester vite : dashboard → Authentication →
   Sign In / Up → Email → désactiver **Confirm email** (sinon chaque compte
   doit cliquer un lien de confirmation).
3. `npm install` (si pas déjà fait) puis `npx expo start`.
4. Scanne le QR code avec l'app **Expo Go** (iOS/Android), ou tape `w` pour
   ouvrir la version web.

## Activer le scanner

Le scanner reconnaît une carte en comparant l'empreinte perceptuelle de la
photo à une base de référence. **Cette base vit dans Supabase : on la construit
une fois, elle sert à tous les appareils.** Un set non indexé ne peut pas être
reconnu — c'est la seule limite.

1. Applique la migration `supabase/migrations/20260818120000_card_hashes.sql`.
2. Indexe les sets principaux des deux dernières années (~7 000 cartes, ~24 min) :
   - depuis GitHub : workflow **Index set for scanner**, entrée `--main-sets` ;
   - en local, avec `DATABASE_URL` : `node scripts/hash-set.mjs --main-sets`.
3. Ensuite, au besoin, un set à la fois : `node scripts/hash-set.mjs otj mh3`
   (~1 min 30 par set). Voir la liste sans rien lancer : `--main-sets --list`,
   et remonter plus loin : `--main-sets --since 2020-01-01`.

Le job est **reprenable** : il saute ce qui est déjà indexé. On peut donc
l'interrompre, le relancer, ou le reprendre depuis une autre machine.
Débit mesuré : 0,21 s par carte.

Ce que couvrent les « sets principaux » : les sorties qu'on drafte
(`expansion`, `core`, `masters`, `draft_innovation`). Sont exclus les jetons,
promos, memorabilia, masterpieces et Secret Lair. Les decks Commander sont à
indexer explicitement par leur code.

Le calcul du hachage se fait sur le téléphone : la photo ne quitte jamais
l'appareil, seules 25 empreintes de 64 bits partent vers la base.

> ⚠️ `mobile/src/lib/phash.ts` est importé à la fois par l'app et par le job
> d'indexation. Le modifier rend incomparables tous les hachages déjà stockés
> et impose de réindexer chaque set. `scripts/phash-selftest.mjs` fige son
> comportement, et le workflow refuse d'écrire si le test ne passe plus.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run ingest` | Ingestion du jour (fait par l'Action ; utilisable en local avec `DATABASE_URL`) |
| `npm run backfill` | Rejoue les archives pour combler l'historique des cartes suivies |
| `node scripts/hash-set.mjs <set…>` | Indexe un ou plusieurs sets pour le scanner |
| `node scripts/phash-selftest.mjs` | Fige le pHash sur un vecteur de référence |
| `node scripts/png-selftest.mjs` | Vérifie le décodeur PNG contre un vrai encodeur |
| `node scripts/scan-e2e.mjs [set] [n]` | Mesure la reconnaissance de bout en bout |

## Modèle de données (résumé)

| Table | Rôle |
|---|---|
| `cards` | Cache Scryfall, 1 ligne par impression — définit les cartes « suivies » |
| `folders` | Dossiers créés par l'utilisateur (`kind`: collection ou wishlist) |
| `collection_items` | Cartes possédées (finish, condition, langue, quantité, prix d'achat) |
| `price_snapshots` | 1 prix par carte suivie et par jour |
| `collection_value_snapshots` | Valeur quotidienne de chaque folder (graphe portfolio) |
| `card_price_stats` (vue) | Moyenne 30 j, couloir P10–P90, variations 7 j / 30 j |
| `card_hashes` | Empreintes perceptuelles du scanner — sans FK vers `cards`, on doit pouvoir reconnaître une carte non possédée |
| `hashed_sets` | Sets déjà indexés, c'est-à-dire ce que le scanner sait reconnaître |

## Roadmap

- [x] **Phase 0** — fondation prix : schéma, ingestion quotidienne, archives, backfill
- [x] **Phase 1** — app Expo : auth, folders, recherche autocomplete, fiche carte + graphe
- [ ] **Phase 2** — moteur d'alertes modulaire, push, digest hebdo par email (Resend)
- [ ] **Phase 3** — scanner v1 (photo → reconnaissance pHash)
- [ ] **Phase 4** — scanner temps réel on-device (mode rafale)
- [ ] **Phase 5** — import/export CSV, wishlist, polish
