// Pipeline du scanner, côté téléphone.
//
//   photo → découpe du cadre → 256 px de large → PNG → pixels →
//   25 hachages perceptuels → une requête SQL → candidats classés
//
// Le hachage se fait ICI et pas sur le serveur : on n'envoie que 25 × 64 bits
// au lieu d'une photo. Pas de Storage, pas d'Edge Function, rien à nettoyer,
// et c'est déjà la brique dont la phase 4 (reconnaissance temps réel) aura
// besoin sur l'appareil.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { frameRect } from '@/lib/card-frame';
import { phashWindows } from '@/lib/phash';
import { base64ToBytes, decodePng } from '@/lib/png';
import { supabase } from '@/lib/supabase';

export { CARD_ASPECT, FRAME_FILL, frameRect } from '@/lib/card-frame';

/** Largeur de travail. 256 px suffisent très largement pour un hachage 32×32,
 *  et maintiennent les 25 fenêtres à quelques millisecondes de calcul. */
const WORK_WIDTH = 256;

/** Photo → les 25 hachages qui serviront à interroger la référence. */
export async function hashPhoto(
  uri: string,
  photoWidth: number,
  photoHeight: number
): Promise<string[]> {
  const context = ImageManipulator.manipulate(uri);
  context.crop(frameRect(photoWidth, photoHeight)).resize({ width: WORK_WIDTH });

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error("L'image n'a pas pu être lue.");

  const { data, width, height } = decodePng(base64ToBytes(saved.base64));
  return phashWindows(data, width, height);
}

export type ScanMatch = {
  card_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  rarity: string | null;
  image_small: string | null;
  image_normal: string | null;
  distance: number;
};

/** Interroge la référence. Renvoie des candidats CLASSÉS, pas une réponse.
 *
 *  C'est délibéré : les mesures montrent que la plage des bonnes réponses
 *  (jusqu'à ~12 bits dans les cas difficiles) recouvre celle des cartes
 *  différentes les plus proches (8 bits). Trancher seul produirait des
 *  ajouts silencieusement faux dans la collection — bien pire qu'un choix
 *  à confirmer. */
export async function matchPhoto(hashes: string[]): Promise<ScanMatch[]> {
  const { data, error } = await supabase.rpc('match_card_hashes', {
    query_hashes: hashes,
    max_distance: 14,
    max_results: 5,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ScanMatch[];
}

/** Degré de confiance, pour le dire à l'écran plutôt que d'afficher « 6 ».
 *
 *  Le second candidat compte autant que le premier : une correspondance à 4
 *  bits talonnée par une autre à 5 bits n'est pas une certitude. */
export function confidenceOf(matches: ScanMatch[]): 'sure' | 'likely' | 'unsure' {
  if (matches.length === 0) return 'unsure';
  const best = matches[0].distance;
  const margin = matches.length > 1 ? matches[1].distance - best : 64;
  if (best <= 6 && margin >= 4) return 'sure';
  if (best <= 10) return 'likely';
  return 'unsure';
}
