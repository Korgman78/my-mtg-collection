-- Onglet Tendances : les plus fortes hausses et baisses de la collection.
--
-- Deux manques à combler avant de pouvoir l'écrire :
--
--   1. la fenêtre 3 jours n'existait pas (on avait 1, 7 et 30) ;
--   2. la vue n'exposait que des POURCENTAGES. Or on veut aussi classer en
--      euros, et reconstituer le prix d'il y a N jours à partir du prix
--      courant et d'un pourcentage arrondi au dixième donne un résultat
--      faux sur les petites valeurs. On expose donc les prix d'origine.
--
-- Les colonnes sont ajoutées EN FIN de vue : `create or replace view` exige
-- que les colonnes existantes gardent leur nom, leur type et leur position.

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
  round((latest.eur_foil - d.eur_foil) / nullif(d.eur_foil, 0) * 100, 1) as change_1d_pct_foil,
  -- Nouveau : fenêtre 3 jours.
  round((latest.eur - t.eur) / nullif(t.eur, 0) * 100, 1) as change_3d_pct,
  round((latest.eur_foil - t.eur_foil) / nullif(t.eur_foil, 0) * 100, 1) as change_3d_pct_foil,
  -- Nouveau : prix de référence de chaque fenêtre, pour des écarts en euros
  -- exacts plutôt que reconstitués.
  d.eur as eur_1d_ago,
  d.eur_foil as eur_foil_1d_ago,
  t.eur as eur_3d_ago,
  t.eur_foil as eur_foil_3d_ago,
  w.eur as eur_7d_ago,
  w.eur_foil as eur_foil_7d_ago,
  m.eur as eur_30d_ago,
  m.eur_foil as eur_foil_30d_ago
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
) d on true
left join lateral (
  select eur, eur_foil
  from price_snapshots p
  where p.card_id = c.id and p.snapped_on <= latest.snapped_on - 3
  order by snapped_on desc
  limit 1
) t on true;

-- ---------------------------------------------------------------------------
-- Les mouvements de la collection, calculés en base.
--
-- Côté serveur et non dans l'app : une collection qui a reçu deux blocs de
-- set dépasse le millier de lignes, et rapatrier tout ça pour n'en afficher
-- que dix serait absurde.
--
-- Un exemplaire par (carte, finish) : les quantités sont sommées, parce que
-- ce qu'on veut classer c'est le mouvement de ce qu'on POSSÈDE. Quatre
-- exemplaires d'une carte qui prend un euro, c'est quatre euros.
--
-- Les wishlists sont exclues : on n'y possède rien, leur variation ne
-- change pas la valeur de la collection.
-- ---------------------------------------------------------------------------
create or replace function public.collection_price_movers(
  window_days int default 7,
  order_by text default 'pct',
  direction text default 'up',
  max_results int default 12
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
    round((p.price_now - p.price_then) * p.quantity, 2) as change_eur
  from priced p
  where p.price_now is not null
    and p.price_then is not null
    -- Un prix d'origine nul rendrait la variation infinie ; et une carte qui
    -- n'a pas bougé n'a rien à faire dans un classement de mouvements.
    and p.price_then > 0
    and p.price_now <> p.price_then
    and case direction
          when 'up' then p.price_now > p.price_then
          else p.price_now < p.price_then
        end
  order by
    case when direction = 'up' then
      case when order_by = 'eur' then (p.price_now - p.price_then) * p.quantity
           else (p.price_now - p.price_then) / p.price_then end
    end desc nulls last,
    case when direction = 'down' then
      case when order_by = 'eur' then (p.price_now - p.price_then) * p.quantity
           else (p.price_now - p.price_then) / p.price_then end
    end asc nulls last
  limit max_results;
$$;
