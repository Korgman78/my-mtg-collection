// Lance un build EAS.
//
// Ce fichier existe pour poser UNE variable d'environnement, et ça mérite une
// explication.
//
// Depuis une version récente d'`eas-cli`, la commande refuse de démarrer si le
// projet n'a pas de verrou npm : « A lockfile is required to ensure
// deterministic dependency installation in EAS ». Or ce dépôt en est
// délibérément dépourvu — voir `.gitignore` et le commit 2c954bf. Le verrou
// généré sous Windows décrit un arbre que npm ne reconstruit pas à l'identique
// sous Linux (hoisting des dépendances optionnelles), et `npm ci` échouait donc
// sur le serveur de build, sur des paquets tirés par eslint dont le build n'a
// même pas besoin. Sans verrou commité, EAS lance `npm install` et résout pour
// sa propre plateforme. C'est la solution retenue après six tentatives.
//
// `EAS_BUILD_SKIP_LOCKFILE_CHECK` est la porte de sortie prévue par l'outil
// pour exactement ce cas.
//
// Pourquoi un script et pas un préfixe dans package.json : sous Windows, npm
// exécute ses scripts avec cmd.exe, où `VAR=1 commande` n'est pas une syntaxe
// valide. Un wrapper Node marche partout sans ajouter de dépendance.
//
// Usage : node scripts/eas-build.mjs [profil]   (défaut : preview)

import { spawnSync } from 'node:child_process';

const profile = process.argv[2] ?? 'preview';

console.log(`Build EAS — plateforme android, profil ${profile}.`);

const result = spawnSync(
  'npx',
  ['eas-cli@latest', 'build', '--platform', 'android', '--profile', profile],
  {
    stdio: 'inherit',
    env: { ...process.env, EAS_BUILD_SKIP_LOCKFILE_CHECK: '1' },
    // `npx` est un script batch sous Windows : sans shell, spawn ne le trouve pas.
    shell: process.platform === 'win32',
  }
);

process.exit(result.status ?? 1);
