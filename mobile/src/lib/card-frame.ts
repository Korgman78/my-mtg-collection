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

export type Rect = { originX: number; originY: number; width: number; height: number };

/** Le repère en valeurs exactes. Séparé de `frameRect` pour que la
 *  conversion vers les pixels de la photo n'arrondisse qu'une seule fois :
 *  arrondir avant de multiplier par le facteur d'échelle amplifie l'erreur. */
function frameRectExact(width: number, height: number): Rect {
  let w = width * FRAME_FILL;
  let h = w / CARD_ASPECT;

  // Sur une zone peu haute, c'est la hauteur qui contraint.
  if (h > height * 0.9) {
    h = height * 0.9;
    w = h * CARD_ASPECT;
  }

  return { originX: (width - w) / 2, originY: (height - h) / 2, width: w, height: h };
}

/** Le repère, en coordonnées de la zone où il est dessiné : rectangle au
 *  format carte, centré, occupant `FRAME_FILL` de la largeur. */
export function frameRect(width: number, height: number): Rect {
  const r = frameRectExact(width, height);
  return {
    originX: Math.round(r.originX),
    originY: Math.round(r.originY),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/**
 * Le repère de l'écran, converti en pixels de la PHOTO.
 *
 * C'est le calcul qui manquait, et sans lui le scanner hachait autre chose
 * que ce que le joueur cadrait. `CameraView` affiche l'aperçu en « cover » :
 * la photo est mise à l'échelle pour remplir la zone d'aperçu, et ce qui
 * dépasse est coupé. L'écran ne montre donc qu'une SOUS-RÉGION de la photo,
 * d'autant plus étroite que les deux formats diffèrent — et un capteur en
 * 3:4 dans un aperçu en 9:19, c'est un écart considérable.
 *
 * On refait donc le trajet dans l'autre sens : facteur de couverture, région
 * réellement visible, puis position du repère à l'intérieur.
 */
export function frameRectInPhoto(
  photoWidth: number,
  photoHeight: number,
  previewWidth: number,
  previewHeight: number
): Rect {
  // Sans dimensions d'aperçu exploitables, on ne peut rien mapper : on
  // retombe sur la photo entière, ce qui reste mieux que des coordonnées
  // fausses.
  if (previewWidth <= 0 || previewHeight <= 0) {
    return frameRect(photoWidth, photoHeight);
  }

  const scale = Math.max(previewWidth / photoWidth, previewHeight / photoHeight);
  const visibleW = previewWidth / scale;
  const visibleH = previewHeight / scale;
  const offsetX = (photoWidth - visibleW) / 2;
  const offsetY = (photoHeight - visibleH) / 2;

  const onScreen = frameRectExact(previewWidth, previewHeight);

  const rect = {
    originX: Math.round(offsetX + onScreen.originX / scale),
    originY: Math.round(offsetY + onScreen.originY / scale),
    width: Math.round(onScreen.width / scale),
    height: Math.round(onScreen.height / scale),
  };

  // Garde-fou : un rectangle qui déborde ferait échouer le découpage natif.
  rect.originX = Math.max(0, Math.min(rect.originX, photoWidth - 1));
  rect.originY = Math.max(0, Math.min(rect.originY, photoHeight - 1));
  rect.width = Math.max(1, Math.min(rect.width, photoWidth - rect.originX));
  rect.height = Math.max(1, Math.min(rect.height, photoHeight - rect.originY));
  return rect;
}
