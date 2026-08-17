-- Phase 2 : moteur d'alertes modulaire.
-- Une règle = (portée, métrique, fenêtre, seuil, direction, canal).
-- L'évaluation tourne chaque nuit après l'ingestion (evaluate_alert_rules)
-- et produit des alert_events, dédupliqués sur la fenêtre de la règle.

-- ---------------------------------------------------------------------------
-- Variation 1 jour ajoutée à la vue de stats (les règles peuvent porter
-- sur 1, 7 ou 30 jours). Colonnes ajoutées en fin -> create or replace ok.
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
  round((latest.eur_foil - m.eur_foil) / nullif(m.eur_foil, 0) * 100, 1) as change_30d_pct_foil,
  round((latest.eur - d.eur) / nullif(d.eur, 0) * 100, 1) as change_1d_pct,
  round((latest.eur_foil - d.eur_foil) / nullif(d.eur_foil, 0) * 100, 1) as change_1d_pct_foil
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
) m on true
left join lateral (
  select eur, eur_foil
  from price_snapshots p
  where p.card_id = c.id and p.snapped_on <= latest.snapped_on - 1
  order by snapped_on desc
  limit 1
) d on true;

-- ---------------------------------------------------------------------------
-- Règles d'alerte.
-- ---------------------------------------------------------------------------
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  scope text not null default 'collection' check (scope in ('collection', 'folder', 'card')),
  folder_id uuid references public.folders (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  finish text check (finish in ('nonfoil', 'foil', 'etched')),
  metric text not null check (metric in ('pct_change', 'corridor_breakout', 'threshold_above', 'threshold_below')),
  window_days int not null default 7 check (window_days in (1, 7, 30)),
  threshold numeric(10, 2),
  direction text not null default 'both' check (direction in ('up', 'down', 'both')),
  channel text not null default 'digest' check (channel in ('digest', 'immediate')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check (scope <> 'folder' or folder_id is not null),
  check (scope <> 'card' or card_id is not null),
  check (metric = 'corridor_breakout' or threshold is not null)
);

create index alert_rules_user_idx on public.alert_rules (user_id);

-- ---------------------------------------------------------------------------
-- Événements déclenchés (fil in-app + matière première des emails).
-- ---------------------------------------------------------------------------
create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.alert_rules (id) on delete cascade,
  user_id uuid not null,
  card_id uuid not null references public.cards (id) on delete cascade,
  finish text not null default 'nonfoil',
  triggered_on date not null,
  metric text not null,
  direction text not null,
  price_now numeric(10, 2),
  change_pct numeric(10, 1),
  digested_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rule_id, card_id, finish, triggered_on)
);

create index alert_events_user_idx on public.alert_events (user_id, created_at desc);

alter table public.alert_rules enable row level security;
alter table public.alert_events enable row level security;

create policy "own rules" on public.alert_rules
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own events" on public.alert_events
  for select to authenticated using (user_id = auth.uid());

-- L'app ne peut que marquer ses événements comme lus.
create policy "mark events seen" on public.alert_events
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Évaluation : appelée par le job nocturne après l'insertion des snapshots.
-- Déduplication : pas de nouvel événement pour la même (règle, carte, finish)
-- tant que la fenêtre de la règle n'est pas écoulée.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_alert_rules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  with targets as (
    -- Portée collection / folder : toutes les cartes possédées concernées.
    select r.id as rule_id, r.user_id, ci.card_id, ci.finish,
           r.metric, r.direction, r.window_days, r.threshold
    from alert_rules r
    join folders f
      on f.user_id = r.user_id
     and (r.scope = 'collection' or f.id = r.folder_id)
    join collection_items ci on ci.folder_id = f.id
    where r.enabled and r.scope in ('collection', 'folder')
    union
    -- Portée carte : la carte désignée, dans le finish de la règle.
    select r.id, r.user_id, r.card_id, coalesce(r.finish, 'nonfoil'),
           r.metric, r.direction, r.window_days, r.threshold
    from alert_rules r
    where r.enabled and r.scope = 'card'
  ),
  evaluated as (
    select distinct on (t.rule_id, t.card_id, t.finish)
      t.*,
      case when t.finish in ('foil', 'etched')
           then coalesce(s.eur_foil, s.eur) else s.eur end as price_now,
      case t.window_days
        when 1 then case when t.finish in ('foil', 'etched')
                         then coalesce(s.change_1d_pct_foil, s.change_1d_pct)
                         else s.change_1d_pct end
        when 30 then case when t.finish in ('foil', 'etched')
                          then coalesce(s.change_30d_pct_foil, s.change_30d_pct)
                          else s.change_30d_pct end
        else case when t.finish in ('foil', 'etched')
                  then coalesce(s.change_7d_pct_foil, s.change_7d_pct)
                  else s.change_7d_pct end
      end as change_pct,
      case when t.finish in ('foil', 'etched')
           then coalesce(s.p10_eur_foil_30d, s.p10_eur_30d) else s.p10_eur_30d end as p10,
      case when t.finish in ('foil', 'etched')
           then coalesce(s.p90_eur_foil_30d, s.p90_eur_30d) else s.p90_eur_30d end as p90
    from targets t
    join card_price_stats s on s.card_id = t.card_id
  ),
  fired as (
    select *
    from evaluated e
    where e.price_now is not null
      and (
        (e.metric = 'pct_change'
          and e.change_pct is not null
          and abs(e.change_pct) >= e.threshold
          and (e.direction = 'both'
            or (e.direction = 'up' and e.change_pct > 0)
            or (e.direction = 'down' and e.change_pct < 0)))
        or (e.metric = 'corridor_breakout'
          and e.p10 is not null and e.p90 is not null
          and ((e.direction in ('both', 'up') and e.price_now > e.p90)
            or (e.direction in ('both', 'down') and e.price_now < e.p10)))
        or (e.metric = 'threshold_above' and e.price_now >= e.threshold)
        or (e.metric = 'threshold_below' and e.price_now <= e.threshold)
      )
  )
  insert into alert_events (rule_id, user_id, card_id, finish, triggered_on,
                            metric, direction, price_now, change_pct)
  select f.rule_id, f.user_id, f.card_id, f.finish, current_date, f.metric,
         case
           when f.metric = 'corridor_breakout' and f.price_now > f.p90 then 'up'
           when f.metric = 'corridor_breakout' then 'down'
           when coalesce(f.change_pct, 0) >= 0 then 'up'
           else 'down'
         end,
         f.price_now, f.change_pct
  from fired f
  where not exists (
    select 1 from alert_events ev
    where ev.rule_id = f.rule_id
      and ev.card_id = f.card_id
      and ev.finish = f.finish
      and ev.triggered_on > current_date - f.window_days
  )
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
