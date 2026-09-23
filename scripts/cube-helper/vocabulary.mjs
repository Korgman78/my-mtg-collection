// Vocabulaire du cube helper.
//
// Un vocabulaire FERMÉ : c'est ce qui rend les tags comparables d'une
// session à l'autre. Laissé libre, « aristocrats », « sac » et
// « sacrifice » cohabiteraient, et l'app ne saurait plus compter les
// moteurs d'un archétype. Ajouter un thème est permis — en l'ajoutant ICI,
// en incrémentant VOCAB_VERSION, jamais en l'inventant au fil de l'eau.
//
// Orienté peasant (communes et peu communes) : pas de thème « planeswalkers »
// ou « bombes », mais le monarque, qui y structure beaucoup de cubes.

export const VOCAB_VERSION = 1;

/** Thèmes de synergie. Dans chacun, une carte est :
 *  - `enabler` (moteur) : elle fait tourner le plan — produit des jetons,
 *    remplit le cimetière, fournit des corps à sacrifier ;
 *  - `payoff` (récompense) : elle rapporte quand le plan tourne.
 *  Un archétype sain a les deux. Vingt récompenses sans moteur, c'est un
 *  archétype qui ne se draft pas. */
export const THEMES = {
  aggro: 'Créatures efficaces à bas coût, pression dès les premiers tours ; récompenses : pump de masse, dégâts à l’attaque.',
  tokens: 'Plusieurs créatures pour une carte ; récompenses : anthem, convoke, « pour chaque créature ».',
  sacrifice: 'Sacrifier ses permanents ; moteurs : fourrage et sacrifice outlets ; récompenses : déclencheurs de mort, drain.',
  graveyard: 'Remplir son cimetière (self-mill, défausse volontaire) et en tirer parti : flashback, recursion, delve.',
  reanimator: 'Remettre en jeu une grosse créature depuis le cimetière ; moteurs : défausse/mill + sorts de réanimation ; récompenses : les cibles.',
  spells: 'Éphémères et rituels en nombre ; récompenses : prowess, magecraft, « chaque fois que vous lancez un sort non-créature ».',
  artifacts: 'Artefacts en nombre (y compris jetons trésor/indice) ; récompenses : affinité, métallurgie, « pour chaque artefact ».',
  enchantments: 'Enchantements et auras en nombre ; récompenses : constellation, « chaque fois qu’un enchantement arrive ».',
  counters: 'Marqueurs +1/+1 : les poser, et en profiter (proliferate, « créature avec un marqueur »).',
  flicker: 'Effets d’arrivée en jeu (ETB) et moyens de les rejouer (blink, bounce de ses propres créatures).',
  lifegain: 'Gagner des points de vie souvent ; récompenses : « chaque fois que vous gagnez de la vie ».',
  flyers: 'Évasion aérienne comme plan principal (skies) ; récompenses : bonus aux volants.',
  ramp: 'Accélérer vers des sorts chers ; moteurs : mana supplémentaire ; récompenses : les gros sorts.',
  control: 'Répondre à tout puis gagner tard : contresorts, removal, avantage de cartes, finisseurs.',
  tempo: 'Menaces bon marché protégées par une interaction légère : flash, bounce, contresorts peu chers.',
  burn: 'Dégâts directs au joueur comme plan de victoire.',
  discard: 'Vider la main adverse ; récompenses : « si un adversaire n’a pas de carte en main ».',
  landfall: 'Terrains qui arrivent en jeu : récupérer, fetcher, jouer des terrains supplémentaires.',
  voltron: 'Équipements et auras sur une créature résistante ou évasive.',
  cycling: 'Recyclage : cartes qui se recyclent, et récompenses « chaque fois que vous recyclez ».',
  monarch: 'Devenir et rester le monarque (ou prendre l’initiative) : l’effet et ceux qui le protègent.',
  mill: 'Meuler l’adversaire comme plan de victoire.',
  tribal: 'Synergie de type de créature (préciser le type dans la note).',
};

export const ROLES = ['enabler', 'payoff'];

/** Fonctions génériques : ce que la carte fait pour n'importe quel deck.
 *  C'est avec elles qu'on vérifie qu'une couleur a assez de removal, ou
 *  qu'une paire a assez de terrains qui la fixent. */
export const FUNCTIONS = {
  removal: 'Détruit, exile ou neutralise durablement une créature (ou un permanent) adverse.',
  'conditional-removal': 'Removal sous condition forte : petite endurance seulement, créature attaquante, etc.',
  counterspell: 'Contresort.',
  bounce: 'Renvoie un permanent adverse en main.',
  'card-advantage': 'Rapporte plus d’une carte : pioche nette, 2-pour-1, recursion d’une carte.',
  cantrip: 'Remplace sa propre carte (pioche 1, scry+pioche).',
  ramp: 'Produit du mana supplémentaire ou cherche un terrain.',
  fixing: 'Produit ou cherche du mana de couleurs différentes.',
  evasion: 'Créature difficile à bloquer : vol, menace, imblocable…',
  finisher: 'Termine une partie seule en quelques tours.',
  blocker: 'Stabilise le sol : grosse endurance, contact mortel, défenseur.',
  'combat-trick': 'Éphémère qui gagne un combat : pump, protection, first strike.',
  protection: 'Protège ses propres permanents (hexproof, indestructible, regenerate, contre).',
  recursion: 'Récupère une carte du cimetière.',
  'hand-disruption': 'Défausse forcée chez l’adversaire.',
  reach: 'Dégâts directs capables de finir l’adversaire.',
  sweeper: 'Effet de masse sur les créatures.',
};

export function validateTag(name, tag) {
  const errors = [];
  for (const t of tag.themes ?? []) {
    if (!(t.theme in THEMES)) errors.push(`${name} : thème inconnu « ${t.theme} »`);
    if (!ROLES.includes(t.role)) errors.push(`${name} : rôle inconnu « ${t.role} » (${t.theme})`);
  }
  for (const f of tag.functions ?? []) {
    if (!(f in FUNCTIONS)) errors.push(`${name} : fonction inconnue « ${f} »`);
  }
  if (tag.power != null && !(Number.isInteger(tag.power) && tag.power >= 1 && tag.power <= 5)) {
    errors.push(`${name} : puissance hors 1–5 (${tag.power})`);
  }
  return errors;
}
