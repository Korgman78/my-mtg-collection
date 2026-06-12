-- Phase 0 : fondation prix + structure de collection minimale.
-- Les tables d'alertes (alert_rules, alert_events) arriveront en phase 2.

-- ---------------------------------------------------------------------------
-- Cache des cartes Scryfall : 1 ligne par impression (id = scryfall_id).
-- Alimentée par l'app au moment où une carte est ajoutée à une collection,
-- puis rafraîchie chaque nuit par le job d'ingestion.
-- ---------------------------------------------------------------------------
create table public.cards (
  id uuid primary key,
  oracle_id uuid,
  name text not null,
  set_code text not null,
  collector_number text not null,
  rarity text,
  image_normal text,
  image_small text,
  finishes text[] not null default '{}',
  released_at date,
  updated_at timestamptz not null default now()
);

create index cards_name_idx on public.cards (name);
create index cards_oracle_idx on public.cards (oracle_id);

-- ---------------------------------------------------------------------------
-- Folders : créés manuellement par l'utilisateur. kind='wishlist' permet
-- les alertes de baisse de prix sur des cartes qu'on ne possède pas encore.
-- ---------------------------------------------------------------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text,
  color text,
  position int not null default 0,
  kind text not null default 'collection' check (kind in ('collection', 'wishlist')),
  created_at timestamptz not null default now()
);

create index folders_user_idx on public.folders (user_id);

-- ---------------------------------------------------------------------------
-- Items : une ligne par (carte, finish, condition, langue) dans un folder.
-- ---------------------------------------------------------------------------
create table public.collection_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders (id) on delete cascade,
  card_id uuid not null references public.cards (id),
  finish text not null default 'nonfoil' check (finish in ('nonfoil', 'foil', 'etched')),
  condition text not null default 'NM' check (condition in ('M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO')),
  language text not null default 'en',
  quantity int not null default 1 check (quantity > 0),
  purchase_price_eur numeric(10, 2),
  added_at timestamptz not null default now()
);

create index collection_items_folder_idx on public.collection_items (folder_id);
create index collection_items_card_idx on public.collection_items (card_id);

-- ---------------------------------------------------------------------------
-- Historique de prix : 1 snapshot par carte suivie et par jour.
-- Seules les cartes présentes dans `cards` sont snapshotées en base ;
-- l'extrait complet de toutes les cartes part dans archives/ (git) et
-- permet de reconstruire l'historique d'une carte ajoutée plus tard.
-- ---------------------------------------------------------------------------
create table public.price_snapshots (
  card_id uuid not null references public.cards (id) on delete cascade,
  snapped_on date not null,
  eur numeric(10, 2),
  eur_foil numeric(10, 2),
  eur_etched numeric(10, 2),
  usd numeric(10, 2),
  usd_foil numeric(10, 2),
  usd_etched numeric(10, 2),
  primary key (card_id, snapped_on)
);

-- ---------------------------------------------------------------------------
-- Valeur quotidienne de chaque folder -> graphe d'évolution du portfolio.
-- ---------------------------------------------------------------------------
create table public.collection_value_snapshots (
  folder_id uuid not null references public.folders (id) on delete cascade,
  user_id uuid not null,
  snapped_on date not null,
  value_eur numeric(12, 2) not null default 0,
  primary key (folder_id, snapped_on)
);

create index cvs_user_idx on public.collection_value_snapshots (user_id, snapped_on);

-- Appelée par le job d'ingestion après l'insertion des snapshots du jour.
create or replace function public.snapshot_collection_values()
returns void
language sql
security definer
set search_path = public
as $$
  insert into collection_value_snapshots (folder_id, user_id, snapped_on, value_eur)
  select
    f.id,
    f.user_id,
    current_date,
    coalesce(sum(
      case ci.finish
        when 'foil'   then coalesce(ps.eur_foil, ps.eur)
        when 'etched' then coalesce(ps.eur_etched, ps.eur_foil, ps.eur)
        else ps.eur
      end * ci.quantity
    ), 0)
  from folders f
  left join collection_items ci on ci.folder_id = f.id
  left join price_snapshots ps
    on ps.card_id = ci.card_id and ps.snapped_on = current_date
  group by f.id, f.user_id
  on conflict (folder_id, snapped_on)
    do update set value_eur = excluded.value_eur;
$$;

-- ---------------------------------------------------------------------------
-- Stats de prix : moyenne mobile 30 j, couloir percentiles 10/90,
-- variations 7 j / 30 j. Lue par l'app ET par le futur moteur d'alertes,
-- pour que tout le monde voie exactement les mêmes chiffres.
-- ---------------------------------------------------------------------------
create or replace view public.card_price_stats as
select
  c.id as card_id,
  latest.snapped_on as latest_date,
  latest.eur,
  latest.eur_foil,
  s.avg_eur_30d,
  s.p10_eur_30d,
  s.p90_eur_30d,
  s.avg_eur_foil_30d,
  s.p10_eur_foil_30d,
  s.p90_eur_foil_30d,
  round((latest.eur - w.eur) / nullif(w.eur, 0) * 100, 1) as change_7d_pct,
  round((latest.eur - m.eur) / nullif(m.eur, 0) * 100, 1) as change_30d_pct,
  round((latest.eur_foil - w.eur_foil) / nullif(w.eur_foil, 0) * 100, 1) as change_7d_pct_foil,
  round((latest.eur_foil - m.eur_foil) / nullif(m.eur_foil, 0) * 100, 1) as change_30d_pct_foil
from cards c
join lateral (
  select snapped_on, eur, eur_foil
  from price_snapshots p
  where p.card_id = c.id
  order by snapped_on desc
  limit 1
) latest on true
left join lateral (
  select
    round(avg(eur), 2) as avg_eur_30d,
    round((percentile_cont(0.1) within group (order by eur) filter (where eur is not null))::numeric, 2) as p10_eur_30d,
    round((percentile_cont(0.9) within group (order by eur) filter (where eur is not null))::numeric, 2) as p90_eur_30d,
    round(avg(eur_foil), 2) as avg_eur_foil_30d,
    round((percentile_cont(0.1) within group (order by eur_foil) filter (where eur_foil is not null))::numeric, 2) as p10_eur_foil_30d,
    round((percentile_cont(0.9) within group (order by eur_foil) filter (where eur_foil is not null))::numeric, 2) as p90_eur_foil_30d
  from price_snapshots p
  where p.card_id = c.id
    and p.snapped_on > current_date - 30
) s on true
left join lateral (
  select eur, eur_foil
  from price_snapshots p
  where p.card_id = c.id and p.snapped_on <= latest.snapped_on - 7
  order by snapped_on desc
  limit 1
) w on true
left join lateral (
  select eur, eur_foil
  from price_snapshots p
  where p.card_id = c.id and p.snapped_on <= latest.snapped_on - 30
  order by snapped_on desc
  limit 1
) m on true;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.cards enable row level security;
alter table public.folders enable row level security;
alter table public.collection_items enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.collection_value_snapshots enable row level security;

-- Données partagées : lisibles par tout utilisateur connecté. L'app peut
-- insérer une carte dans le cache au moment de l'ajout ; seules les
-- mises à jour passent par le job (service role, qui contourne la RLS).
create policy "cards are readable" on public.cards
  for select to authenticated using (true);
create policy "cards can be cached" on public.cards
  for insert to authenticated with check (true);

create policy "prices are readable" on public.price_snapshots
  for select to authenticated using (true);

-- Données privées : chacun ne voit que les siennes.
create policy "own folders" on public.folders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own items" on public.collection_items
  for all to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_id and f.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.folders f
    where f.id = folder_id and f.user_id = auth.uid()
  ));

create policy "own value history" on public.collection_value_snapshots
  for select to authenticated using (user_id = auth.uid());
