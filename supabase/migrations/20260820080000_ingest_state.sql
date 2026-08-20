-- Retenir quelle génération de prix a déjà été ingérée.
--
-- Scryfall régénère son export « default_cards » plusieurs fois par jour, mais
-- les prix qu'il contient ne changent qu'environ une fois par vingt-quatre
-- heures. Deux ingestions tombant dans la même génération enregistrent donc
-- deux journées strictement identiques.
--
-- C'est arrivé le 2026-08-20 : les rattrapages manuels du 19 et du 20 ont
-- capté le même jeu de prix, et les 2559 relevés du 20 étaient au centime près
-- ceux du 19. Conséquence visible dans l'app : l'onglet Tendances se vidait,
-- puisqu'il écarte — à raison — les cartes qui n'ont pas bougé. Conséquence
-- invisible : la moyenne 30 jours comptait deux fois la même génération.
--
-- Le job compare donc `updated_at` de l'export à ce qui est enregistré ici, et
-- sort sans rien écrire si la génération est déjà connue. `--force` passe outre.
--
-- Table à une seule ligne : la clé primaire booléenne contrainte à `true`
-- rend un second enregistrement impossible, ce qui vaut mieux qu'un `limit 1`
-- posé par convention et oublié un jour.

create table if not exists public.ingest_state (
  singleton boolean primary key default true check (singleton),
  bulk_updated_at timestamptz not null,
  bulk_uri text,
  snapshots int,
  ingested_at timestamptz not null default now()
);

-- Aucune politique : cette table ne concerne que le job d'ingestion, qui se
-- connecte en direct. L'application n'a rien à y lire, RLS activée la lui
-- ferme entièrement.
alter table public.ingest_state enable row level security;

comment on table public.ingest_state is
  'Generation de prix Scryfall deja ingeree. Empeche deux ingestions dans la '
  'meme generation de creer deux journees identiques.';
