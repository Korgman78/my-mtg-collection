-- Alertes : filtre de rareté.
--
-- Le besoin, tel qu'exprimé : une commune qui prend 100 % et une mythique
-- qui prend 100 % ne sont pas le même événement. La commune passe de 5 à
-- 10 centimes — anecdotique ; la mythique de 20 à 40 euros — on veut le
-- savoir. Un seuil unique pour toute la collection oblige donc à choisir
-- entre se noyer sous les communes et rater les mythiques.
--
-- Avec ce filtre, on crée plusieurs règles côte à côte : un seuil élevé sur
-- les communes et peu communes, un seuil bas sur les rares et mythiques.
--
-- `null` = toutes les raretés, pour que les règles existantes gardent
-- exactement le comportement qu'elles avaient.

alter table public.alert_rules add column rarities text[];

comment on column public.alert_rules.rarities is
  'Raretés surveillées (valeurs Scryfall). NULL = toutes.';

-- ---------------------------------------------------------------------------
-- Évaluation : même moteur, avec le filtre de rareté appliqué à la source.
--
-- Le filtre porte sur `cards.rarity`, donc sur l'impression réellement
-- possédée : une réimpression en commune d'une carte jadis rare est traitée
-- comme la commune qu'elle est aujourd'hui.
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
    join cards c on c.id = ci.card_id
    where r.enabled and r.scope in ('collection', 'folder')
      and (r.rarities is null or c.rarity = any (r.rarities))
    union
    -- Portée carte : la carte désignée, dans le finish de la règle.
    select r.id, r.user_id, r.card_id, coalesce(r.finish, 'nonfoil'),
           r.metric, r.direction, r.window_days, r.threshold
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
