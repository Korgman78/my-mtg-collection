export type Finish = 'nonfoil' | 'foil' | 'etched';

export type Folder = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  kind: 'collection' | 'wishlist';
  created_at: string;
};

export type CardRow = {
  id: string;
  oracle_id: string | null;
  name: string;
  set_code: string;
  collector_number: string;
  rarity: string | null;
  image_normal: string | null;
  image_small: string | null;
  finishes: string[];
  released_at: string | null;
};

export type CollectionItem = {
  id: string;
  folder_id: string;
  card_id: string;
  finish: Finish;
  condition: string;
  language: string;
  quantity: number;
  purchase_price_eur: number | null;
  added_at: string;
  card?: CardRow;
};

export type CardPriceStats = {
  card_id: string;
  latest_date: string;
  eur: number | null;
  eur_foil: number | null;
  avg_eur_30d: number | null;
  p10_eur_30d: number | null;
  p90_eur_30d: number | null;
  avg_eur_foil_30d: number | null;
  p10_eur_foil_30d: number | null;
  p90_eur_foil_30d: number | null;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  change_7d_pct_foil: number | null;
  change_30d_pct_foil: number | null;
};

export type PriceSnapshot = {
  card_id: string;
  snapped_on: string;
  eur: number | null;
  eur_foil: number | null;
  eur_etched: number | null;
  usd: number | null;
  usd_foil: number | null;
  usd_etched: number | null;
};

/** Prix pertinent pour un finish donné, avec repli raisonnable. */
export function priceForFinish(
  row: { eur: number | null; eur_foil: number | null; eur_etched?: number | null },
  finish: Finish
): number | null {
  if (finish === 'foil') return row.eur_foil ?? row.eur;
  if (finish === 'etched') return row.eur_etched ?? row.eur_foil ?? row.eur;
  return row.eur;
}
