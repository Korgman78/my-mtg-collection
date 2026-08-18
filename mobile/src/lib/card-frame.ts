// Géométrie du cadre de scan.
//
// Isolé de scan.ts, et sans aucun import, pour deux raisons :
//   - le repère affiché à l'écran et la découpe appliquée à la photo doivent
//     venir du MÊME calcul, sinon on hache autre chose que ce que le joueur
//     a cadré ;
//   - les essais côté Node (scripts/scan-e2e.mjs) rejouent cette découpe, et
//     ils ne peuvent pas charger les modules natifs d'Expo.

/** Format d'une carte Magic : 63 × 88 mm. */
export const CARD_ASPECT = 63 / 88;

/** Part de la largeur de l'image occupée par le repère. */
export const FRAME_FILL = 0.82;

/** Le rectangle au format carte, centré, tel que le repère le dessine.
 *  Coordonnées en pixels de l'image d'origine — c'est ce qu'attend
 *  `ImageManipulator.crop()`. */
export function frameRect(width: number, height: number) {
  let w = width * FRAME_FILL;
  let h = w / CARD_ASPECT;

  // Sur une photo peu haute, c'est la hauteur qui contraint.
  if (h > height * 0.9) {
    h = height * 0.9;
    w = h * CARD_ASPECT;
  }

  return {
    originX: Math.round((width - w) / 2),
    originY: Math.round((height - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  };
}
