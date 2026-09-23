---
name: cube-helper
description: Lance le cube helper sur un cube de l'app Grimoire — taguer les cartes (thèmes, rôles, fonctions, puissance), proposer ~10 archétypes peasant cohérents, suggérer sorties et ajouts depuis la collection. À utiliser quand l'utilisateur dit « lance le cube helper », « aide-moi à équilibrer mon cube », « propose des archétypes pour <cube> ».
---

# Cube helper

Tu joues ici le rôle du LLM du helper, gratuitement, à la place d'une API
payante. Ta part est le **jugement** : ce que fait une carte, quels plans de
jeu le pool soutient. Le **calcul** (comptes, équilibre, optimisation) est
fait par les scripts et par l'app — ne recompte jamais à la main ce qu'un
script peut compter.

Contexte fixé avec l'utilisateur (2026-09-23) :
- format **peasant** (communes et peu communes) ;
- ajouts suggérés **uniquement depuis sa collection** (les candidats de l'export) ;
- les cartes **verrouillées** (`IN*` dans pool.txt) ne sortent jamais ;
- archétypes **libres mais orientés vers les 10 paires de couleurs** ;
- échanges en français.

## Déroulé

### 0. Préalables
- Les migrations `20260923120000_cubes.sql` et `20260923130000_cube_helper.sql`
  doivent être appliquées (l'utilisateur les passe à la main dans le SQL
  Editor). Si l'export se plaint d'une table absente, c'est ça.
- `.env` à la racine contient `DATABASE_URL`.

### 1. Exporter
```
npm run cube:export -- --cube "<nom>" [--top 600]
```
Lis la sortie : taille du cube, verrous, candidats, cartes à taguer, cartes
non peasant dans le cube (à signaler). `--top` borne les candidats envoyés
au tagging (classés par rang EDHREC — approximation, biaisée Commander ; dis-le
si ça semble écarter des cartes de cube évidentes). Les tags sont en cache
permanent : un premier passage coûte, les suivants presque rien.

### 2. Taguer — `.cube-helper/<slug>/to-tag.txt` → `tags.json`
Une ligne par carte : `Nom | coût | type P/T | texte`.

Pour chaque carte, écris dans `tags.json` :
```json
"Carrier Thrall": {
  "themes": [{"theme": "sacrifice", "role": "enabler"}, {"theme": "tokens", "role": "enabler"}],
  "functions": ["blocker"],
  "power": 3,
  "note": "facultatif, court"
}
```
- Vocabulaire **fermé** : `scripts/cube-helper/vocabulary.mjs` (lis-le avant de
  commencer). N'invente pas de thème ; s'il en manque vraiment un, propose à
  l'utilisateur de l'ajouter (et d'incrémenter `VOCAB_VERSION`).
- `enabler` fait tourner le plan, `payoff` en profite. Une carte peut être les
  deux dans deux thèmes différents. Pas de thème du tout est une réponse
  valable (un removal sec n'a que des fonctions).
- N'attribue un thème que si la carte **pousse** vers lui. « A le vol » ne fait
  pas une carte `flyers` ; un 2/2 volant à 2 dans un deck skies, si.
- `power` se juge **en peasant** : 5 = carte pour laquelle on change de
  couleur (Pestermite-niveau), 3 = bon playable, 1 = remplissage.
- **Écris par lots de ~100 cartes** dans `tags.json` (fusionne, n'écrase pas) :
  le contexte peut être compacté en route, le fichier ne l'est pas.
- `npm run cube:pool -- --cube "<nom>"` valide le vocabulaire et dit combien
  il en reste. Relance-le à chaque lot.

### 3. Proposer — `pool.txt` + `themes.txt` → `proposal.json`
`themes.txt` donne, par paire et par thème, moteurs (E) et récompenses (P)
dans le cube et en réserve dans la collection. C'est ta matière première.

Règles de la proposition :
- **~10 archétypes**, un par paire par défaut. Tu t'écartes des paires quand
  le pool le justifie (deux archétypes dans une paire, un thème incolore), et
  tu l'expliques.
- Un archétype tient s'il a **des moteurs ET des récompenses** dans le cube,
  ou atteignables avec la collection. Signale ceux qui n'en ont pas.
- `cards` = cartes qui servent vraiment l'archétype (cube ou candidats).
  `key_cards` = 2 à 4 cartes qui donnent envie de le draguer.
- `suggestions.cuts` : cartes du cube qui ne servent aucun archétype et ne
  sont pas assez fortes pour se jouer seules — **jamais une carte `IN*`**.
- `suggestions.adds` : **uniquement des candidats de l'export** (lignes `CAND`),
  chacune justifiée par un trou précis (« Orzhov n'a que 2 moteurs de jetons »).
- Garde en tête la taille visée : autant d'ajouts que de sorties, sauf si le
  cube est sous sa cible.
- Format exact : en tête de `scripts/cube-helper/import.mjs`.

### 4. Présenter, puis écrire
1. `npm run cube:import -- --cube "<nom>"` (simulation, n'écrit rien) : doit
   passer sans erreur.
2. Présente à l'utilisateur les archétypes (couleurs, plan, forces/manques),
   les sorties et les ajouts, **avant** d'écrire.
3. Sur son accord seulement : `--write` (tags + proposition), et
   `--apply-archetypes` s'il veut les archétypes créés tout de suite dans le
   cube (un archétype du même nom est mis à jour et ses cartes remplacées).

Ne supprime jamais rien en base en dehors de ce que `import.mjs` fait.
