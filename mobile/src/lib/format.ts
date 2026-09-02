export function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')} %`;
}

/** Comparaison souple : sans accents, sans casse.
 *
 *  « Édition » doit sortir sur « edition ». Sur un clavier de téléphone,
 *  personne ne va chercher l'accent pour filtrer une liste.
 *
 *  U+0300–U+036F est la plage des diacritiques combinants, que la
 *  décomposition NFD isole des lettres. On l'écrit ainsi plutôt qu'avec
 *  `\p{Diacritic}` : les classes Unicode ne sont pas acquises sur Hermes.
 *
 *  Partagée par le filtre de dossiers du tableau de bord et par la recherche
 *  dans un dossier : deux copies d'une subtilité pareille finiraient par
 *  diverger, et c'est le genre d'écart qu'on ne remarque jamais. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d);
  } catch {
    return iso.slice(5, 10);
  }
}
