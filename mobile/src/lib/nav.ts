// Retour arrière sûr.
//
// `router.back()` ne fait rien quand la pile de navigation est vide : le
// journal Metro affiche « The action 'GO_BACK' was not handled by any
// navigator », mais à l'écran le bouton semble simplement mort. Le cas
// arrive plus souvent qu'on ne croit — rechargement de l'app sur un écran
// profond, arrivée par un lien, ou passage par un onglet qui a dérouté la
// pile.
//
// Le piège est double : un écran qui appelle `back()` après une action
// réussie (ajouter une carte, par exemple) laisse croire que l'action a
// échoué, alors qu'elle a parfaitement fonctionné.
//
// D'où cette règle dans l'app : jamais de `router.back()` nu, toujours une
// destination de repli.

import { router, type Href } from 'expo-router';

export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
