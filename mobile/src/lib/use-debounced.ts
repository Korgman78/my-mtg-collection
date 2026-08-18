import { useEffect, useState } from 'react';

/** Valeur retardée. Sert à ne pas interroger Scryfall à chaque frappe :
 *  l'API est gratuite et sans clé, la moindre des politesses est de ne pas
 *  lui envoyer une requête par caractère. */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
