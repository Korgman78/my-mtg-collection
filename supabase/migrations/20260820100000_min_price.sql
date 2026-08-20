-- Prix plancher : ignorer les mouvements sur les cartes qu'on ne vendra pas.
--
-- Le filtre de rareté (20260818210000) partait d'une intuition juste mais
-- d'un mauvais indicateur. Mesuré le 2026-08-20 : sur les 16 cartes ayant
-- pris 50 % ou plus dans la journée, **les 16 valaient moins de 20 centimes**
-- et **aucune n'atteignait 1 euro**. Une commune à 2 centimes qui passe à 5
-- fait +150 % et déclenche tout ; une rare à 15 euros qui prend 8 % — soit
-- 1,20 euro réel, exactement ce qu'on veut savoir pour vendre — ne déclenche
-- rien.
--
-- Rareté et valeur ne sont que faiblement corrélées. Ce qui décide d'une
-- vente, c'est le NIVEAU DE PRIX, pas la classification de la carte.
--
-- `null` = pas de plancher, pour que les règles existantes gardent
-- exactement le comportement qu'elles avaient.

alter table public.alert_rules add column if not exists min_price numeric;

comment on column public.alert_rules.min_price is
  'Prix courant minimal (EUR) pour qu''un mouvement compte. NULL = aucun plancher.';

-- ---------------------------------------------------------------------------
-- Évaluation : le plancher porte sur le prix COURANT, pas sur le prix
-- d'origine. On veut savoir si la carte vaut la peine d'être vendue
-- maintenant ; ce qu'elle valait la semaine dernière ne change rien à cette
-- décision.
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
           r.metric, r.direction, r.window_days, r.threshold, r.min_price
    from alert_rules r
    join folders f
      on f.user_id = r.user_id
     and (r.scope = 'collection' or f.id = r.folder_id)
    join collection_items ci on ci.folder_id = f.id
    join cards c on c.id = ci.card_id
    where r.enabled and r.scope in ('collection', 'folder')
      and (r.rarities is null or c.rarity = any (r.rarities))
    union
    -- Portée carte : la carte désignée, dans le finish de la règle.
    select r.id, r.user_id, r.card_id, coalesce(r.finish, 'nonfoil'),
           r.metric, r.direction, r.window_days, r.threshold, r.min_price
    from alert_rules r
    join cards c on c.id = r.card_id
    where r.enabled and r.scope = 'card'
      and (r.rarities is null or c.rarity = any (r.rarities))
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
      -- Le plancher, appliqué avant toute autre condition.
      and (e.min_price is null or e.price_now >= e.min_price)
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

-- ---------------------------------------------------------------------------
-- Tendances : le même plancher, en filtre d'écran.
--
-- `drop` avant `create` : ajouter un paramètre ne remplace pas une fonction,
-- il la surcharge. Les deux versions coexisteraient, et un appel à quatre
-- arguments deviendrait ambigu — donc une erreur.
-- ---------------------------------------------------------------------------
drop function if exists public.collection_price_movers(int, text, text, int);

create or replace function public.collection_price_movers(
  window_days int default 7,
  order_by text default 'pct',
  direction text default 'up',
  max_results int default 12,
  min_price numeric default null
)
returns table (
  card_id uuid,
  name text,
  set_code text,
  collector_number text,
  rarity text,
  image_small text,
  finish text,
  quantity int,
  price_now numeric,
  price_then numeric,
  change_pct numeric,
  change_eur numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with owned as (
    select ci.card_id, ci.finish, sum(ci.quantity)::int as quantity
    from collection_items ci
    join folders f on f.id = ci.folder_id
    where f.user_id = auth.uid()
      and f.kind = 'collection'
    group by ci.card_id, ci.finish
  ),
  priced as (
    select
      o.card_id,
      c.name,
      c.set_code,
      c.collector_number,
      c.rarity,
      c.image_small,
      o.finish,
      o.quantity,
      case when o.finish in ('foil', 'etched')
           then coalesce(s.eur_foil, s.eur) else s.eur end as price_now,
      case window_days
        when 1 then case when o.finish in ('foil', 'etched')
                         then coalesce(s.eur_foil_1d_ago, s.eur_1d_ago) else s.eur_1d_ago end
        when 3 then case when o.finish in ('foil', 'etched')
                         then coalesce(s.eur_foil_3d_ago, s.eur_3d_ago) else s.eur_3d_ago end
        when 30 then case when o.finish in ('foil', 'etched')
                          then coalesce(s.eur_foil_30d_ago, s.eur_30d_ago) else s.eur_30d_ago end
        else case when o.finish in ('foil', 'etched')
                  then coalesce(s.eur_foil_7d_ago, s.eur_7d_ago) else s.eur_7d_ago end
      end as price_then
    from owned o
    join cards c on c.id = o.card_id
    join card_price_stats s on s.card_id = o.card_id
  )
  select
    p.card_id,
    p.name,
    p.set_code,
    p.collector_number,
    p.rarity,
    p.image_small,
    p.finish,
    p.quantity,
    p.price_now,
    p.price_then,
    round((p.price_now - p.price_then) / p.price_then * 100, 1) as change_pct,
    round(p.price_now - p.price_then, 2) as change_eur
  from priced p
  where p.price_now is not null
    and p.price_then is not null
    -- Un prix d'origine nul rendrait la variation infinie ; et une carte qui
    -- n'a pas bougé n'a rien à faire dans un classement de mouvements.
    and p.price_then > 0
    and p.price_now <> p.price_then
    -- Le plancher porte sur le prix courant : ce qui compte, c'est ce que la
    -- carte vaut aujourd'hui, pas ce qu'elle valait avant de monter.
    and (min_price is null or p.price_now >= min_price)
    and case direction
          when 'up' then p.price_now > p.price_then
          else p.price_now < p.price_then
        end
  order by
    case when direction = 'up' then
      case when order_by = 'eur' then (p.price_now - p.price_then)
           else (p.price_now - p.price_then) / p.price_then end
    end desc nulls last,
    case when direction = 'down' then
      case when order_by = 'eur' then (p.price_now - p.price_then)
           else (p.price_now - p.price_then) / p.price_then end
    end asc nulls last
  limit max_results;
$$;
