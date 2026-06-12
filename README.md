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
- **App mobile** (phase 1) : Expo / React Native — à venir dans `app/`.

## Mise en route (une seule fois)

1. **Créer le projet Supabase** sur [supabase.com](https://supabase.com)
   (si besoin, mettre en pause un ancien projet : Settings → General → Pause project).
2. **Appliquer la migration** : dashboard → SQL Editor → coller le contenu de
   `supabase/migrations/20260612000000_init.sql` → Run.
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

## Scripts

| Commande | Rôle |
|---|---|
| `npm run ingest` | Ingestion du jour (fait par l'Action ; utilisable en local avec `DATABASE_URL`) |
| `npm run backfill` | Rejoue les archives pour combler l'historique des cartes suivies |

## Modèle de données (résumé)

| Table | Rôle |
|---|---|
| `cards` | Cache Scryfall, 1 ligne par impression — définit les cartes « suivies » |
| `folders` | Dossiers créés par l'utilisateur (`kind`: collection ou wishlist) |
| `collection_items` | Cartes possédées (finish, condition, langue, quantité, prix d'achat) |
| `price_snapshots` | 1 prix par carte suivie et par jour |
| `collection_value_snapshots` | Valeur quotidienne de chaque folder (graphe portfolio) |
| `card_price_stats` (vue) | Moyenne 30 j, couloir P10–P90, variations 7 j / 30 j |

## Roadmap

- [x] **Phase 0** — fondation prix : schéma, ingestion quotidienne, archives, backfill
- [ ] **Phase 1** — app Expo : auth, folders, recherche autocomplete, fiche carte + graphe
- [ ] **Phase 2** — moteur d'alertes modulaire, push, digest hebdo par email (Resend)
- [ ] **Phase 3** — scanner v1 (photo → reconnaissance pHash)
- [ ] **Phase 4** — scanner temps réel on-device (mode rafale)
- [ ] **Phase 5** — import/export CSV, wishlist, polish
