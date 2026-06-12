-- L'app insère le prix Scryfall du jour au moment où une carte est ajoutée,
-- pour afficher une valeur immédiatement sans attendre l'ingestion nocturne.
-- (insert seulement, jamais d'update : le job nocturne reste la source de vérité.)
create policy "app can seed today's price" on public.price_snapshots
  for insert to authenticated
  with check (snapped_on = current_date);
