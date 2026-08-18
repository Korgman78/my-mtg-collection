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

import { frameRectInPhoto } from '@/lib/card-frame';
import { phashWindows } from '@/lib/phash';
import { base64ToBytes, decodePng } from '@/lib/png';
import { supabase } from '@/lib/supabase';

export { CARD_ASPECT, FRAME_FILL, frameRect, frameRectInPhoto } from '@/lib/card-frame';

/** Largeur de travail. 256 px suffisent très largement pour un hachage 32×32,
 *  et maintiennent les 25 fenêtres à quelques millisecondes de calcul. */
const WORK_WIDTH = 256;

export type HashedPhoto = {
  hashes: { whole: string[]; art: string[] };
  /** L'image réellement hachée. Affichée après un scan raté : voir ce que
   *  l'app a regardé vaut tous les journaux du monde. */
  previewUri: string;
};

/** Photo → les 25 hachages qui serviront à interroger la référence.
 *
 *  Les dimensions de l'aperçu sont indispensables : sans elles, on ne peut
 *  pas savoir quelle partie de la photo le joueur voyait, et on découpe à
 *  côté. C'était le défaut du premier jet. */
export async function hashPhoto(
  uri: string,
  photoWidth: number,
  photoHeight: number,
  previewWidth: number,
  previewHeight: number
): Promise<HashedPhoto> {
  const crop = frameRectInPhoto(photoWidth, photoHeight, previewWidth, previewHeight);

  const context = ImageManipulator.manipulate(uri);
  context.crop(crop).resize({ width: WORK_WIDTH });

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error("L'image n'a pas pu être lue.");

  const { data, width, height } = decodePng(base64ToBytes(saved.base64));

  // Trace de géométrie. Elle remonte dans le journal Metro, seul endroit
  // d'où l'on peut observer ce qui se passe vraiment sur l'appareil.
  // Ce qu'elle permet de trancher d'un coup d'œil :
  //   - une image analysée en paysage (width > height) = orientation ratée ;
  //   - un rapport largeur/hauteur loin de 0,716 = découpe fausse ;
  //   - une découpe plus large que la zone visible = mauvais mapping.
  console.log(
    `[scan] photo=${photoWidth}x${photoHeight} apercu=${Math.round(previewWidth)}x${Math.round(
      previewHeight
    )} decoupe=${crop.width}x${crop.height}@(${crop.originX},${crop.originY}) ` +
      `analyse=${width}x${height} rapport=${(width / height).toFixed(3)}`
  );

  return { hashes: phashWindows(data, width, height), previewUri: saved.uri };
}

export type ScanMatch = {
  card_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  rarity: string | null;
  image_small: string | null;
  image_normal: string | null;
  /** Distance retenue : celle de l'illustration, qui décide. */
  distance: number;
  /** Distance sur la carte entière. Utile au diagnostic : très proche sur la
   *  carte mais loin sur l'illustration = deux cartes au même gabarit. */
  whole_distance: number | null;
};

/** Interroge la référence. Renvoie des candidats CLASSÉS, pas une réponse.
 *
 *  C'est délibéré : les mesures montrent que la plage des bonnes réponses
 *  (jusqu'à ~12 bits dans les cas difficiles) recouvre celle des cartes
 *  différentes les plus proches (8 bits). Trancher seul produirait des
 *  ajouts silencieusement faux dans la collection — bien pire qu'un choix
 *  à confirmer. */
export async function matchPhoto(
  hashes: { whole: string[]; art: string[] },
  maxDistance = 18
): Promise<ScanMatch[]> {
  const { data, error } = await supabase.rpc('match_card_hashes', {
    query_hashes: hashes.whole,
    art_hashes: hashes.art,
    max_distance: maxDistance,
    max_results: 5,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ScanMatch[];
}

/**
 * Quand rien ne correspond sous le seuil, on redemande SANS seuil.
 *
 * C'est la mesure qui tranche, et elle vaut mieux que toutes les
 * suppositions : la distance de la meilleure correspondance dit lequel des
 * trois mondes on habite.
 *
 *   ≤ 14  la carte est reconnue, c'était le seuil qui bloquait ;
 *   15–22 on regarde bien la bonne carte, mais dégradée : reflets, angle,
 *         cadrage approximatif. C'est un problème de robustesse.
 *   ≥ 25  on hache autre chose que la carte. Géométrie, orientation, ou
 *         set absent de l'index. Aucun réglage de seuil n'y changera rien.
 */
export async function diagnoseScan(hashes: {
  whole: string[];
  art: string[];
}): Promise<ScanMatch[]> {
  return matchPhoto(hashes, 64);
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
