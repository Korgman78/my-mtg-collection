// Génère le QR code d'ouverture dans Expo Go, à la racine du projet.
//
// Pourquoi ce script : `npx expo start` affiche un QR dans le terminal, mais
// il est invisible quand le serveur tourne en arrière-plan. On se rabat alors
// sur l'adresse, et c'est là que ça dérape — une adresse en `http://` ouvre
// le navigateur, seul `exp://` ouvre le projet dans Expo Go.
//
// L'IP locale change (DHCP, changement de réseau) : on la relit à chaque fois
// plutôt que de la figer.
//
// Usage : node scripts/dev-qr.mjs [port]

import { networkInterfaces } from 'node:os';
import path from 'node:path';

import QRCode from 'qrcode';

const OUTPUT = path.resolve('expo-go-qr.png');

/** L'adresse IPv4 du réseau local, en écartant loopback et auto-attribuées. */
function lanAddress() {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      return { ip: address.address, interface: name };
    }
  }
  return null;
}

async function main() {
  const port = process.argv[2] ?? '8081';
  const lan = lanAddress();

  if (!lan) {
    console.error('Aucune adresse IPv4 locale trouvée. Es-tu connecté au réseau ?');
    process.exit(1);
  }

  const url = `exp://${lan.ip}:${port}`;
  await QRCode.toFile(OUTPUT, url, { width: 600, margin: 2 });

  console.log(`URL Expo Go : ${url}   (interface ${lan.interface})`);
  console.log(`QR écrit dans : ${OUTPUT}`);
  console.log('\nScanne-le avec l’appareil photo du téléphone, pas depuis Expo Go.');
  console.log('Le téléphone doit être sur le même Wi-Fi que cette machine.');

  // Le QR dans le terminal, pour qui lance ce script à la main.
  console.log(`\n${await QRCode.toString(url, { type: 'terminal', small: true })}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
