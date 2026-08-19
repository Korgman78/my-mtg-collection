-- Les tendances raisonnent en prix UNITAIRE.
--
-- `change_eur` multipliait l'ecart par le nombre d'exemplaires. L'intention
-- etait de dire ce que le mouvement rapporte reellement sur la collection,
-- mais ca melange deux choses : combien la CARTE a bouge, et combien j'en
-- possede. Trois exemplaires d'une commune qui prend deux centimes
-- remontaient devant une rare qui en prend cinq, ce qui ne dit rien du
-- marche et tout de mes achats.
--
-- Le classement porte donc sur l'ecart unitaire, cote a cote avec le
-- pourcentage. La colonne quantity reste exposee : l'ecran peut toujours
-- afficher le nombre d'exemplaires, il ne s'en sert simplement plus pour
-- ordonner.

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
    round(p.price_now - p.price_then, 2) as change_eur
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
      case when order_by = 'eur' then (p.price_now - p.price_then)
           else (p.price_now - p.price_then) / p.price_then end
    end desc nulls last,
    case when direction = 'down' then
      case when order_by = 'eur' then (p.price_now - p.price_then)
           else (p.price_now - p.price_then) / p.price_then end
    end asc nulls last
  limit max_results;
$$;
