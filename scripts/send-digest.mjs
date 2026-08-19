// Envoi des emails d'alerte via Resend.
//
//   --mode weekly     digest hebdomadaire : tous les événements non envoyés
//                     des règles channel='digest', + résumé de la collection.
//   --mode immediate  événements du jour des règles channel='immediate'
//                     (lancé après l'ingestion quotidienne).
//   --preview [fic]   n'envoie rien et ne marque rien : écrit le HTML sur
//                     disque, avec de vraies cartes de la collection et des
//                     mouvements d'exemple. Sert à juger la mise en page.
//
// Sans RESEND_API_KEY, le script sort en succès sans rien faire (le job
// reste vert tant que l'utilisateur n'a pas configuré l'email).
//
// Usage : DATABASE_URL=... RESEND_API_KEY=... node scripts/send-digest.mjs --mode weekly
//         node --env-file=.env scripts/send-digest.mjs --preview apercu.html
//
// UNE CONTRAINTE EXPLIQUE TOUT LE RESTE DU FICHIER : un client mail n'est pas
// un navigateur. Outlook rend le HTML avec le moteur de Word. Donc pas de
// flexbox, pas de grille, pas de feuille de style, pas de SVG, pas d'image de
// fond — des tableaux imbriqués et des styles en ligne, y compris là où trois
// lignes de CSS suffiraient sur le web. Les arrondis tombent en angles droits
// sur Outlook, et c'est acceptable : rien ne dépend d'eux pour être lisible.

import fs from 'node:fs';

import pg from 'pg';

const argv = process.argv;
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const mode = flag('--mode', 'weekly');
if (!['weekly', 'immediate'].includes(mode)) throw new Error(`Mode inconnu : ${mode}`);
const preview = flag('--preview');

const APP = 'My MTG Collection';
const FROM = process.env.DIGEST_FROM ?? `${APP} <onboarding@resend.dev>`;

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

// Le parchemin de l'app, transposé en clair. Un mail sombre se fait recolorer
// par la moitié des clients, et Outlook n'a pas de mode sombre du tout : on
// garde donc l'encre sur crème, avec l'or comme unique accent.
const C = {
  page: '#EEE7D7',
  sheet: '#FFFDF7',
  panel: '#F7F1E1',
  ink: '#1A1613',
  soft: '#6E6353',
  faint: '#9B9384',
  gold: '#B8912A',
  goldSoft: '#D9C489',
  rule: '#E4DAC3',
  up: '#2E7D4F',
  upBg: '#E7F2EA',
  down: '#B4483C',
  downBg: '#FAEAE8',
};

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/* -------------------------------------------------------------------------- */
/* Formatage                                                                   */
/* -------------------------------------------------------------------------- */

const eur = (v) =>
  v === null || v === undefined ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`;
const pct = (v) =>
  v === null || v === undefined
    ? ''
    : `${v > 0 ? '+' : ''}${Number(v).toFixed(1).replace('.', ',')} %`;

/** Échappement : un nom de carte peut porter une esperluette ou un chevron. */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function describeEvent(ev) {
  if (ev.metric === 'corridor_breakout')
    return ev.direction === 'up' ? 'sortie du couloir par le haut' : 'sortie du couloir par le bas';
  if (ev.metric === 'threshold_above') return 'seuil franchi';
  if (ev.metric === 'threshold_below') return 'passé sous le seuil';
  return pct(ev.change_pct);
}

/** L'illustration seule, en bandeau. Scryfall la sert à cette adresse pour
 *  tout identifiant de carte ; on ne la stocke donc pas en base. */
const artUrl = (cardId) =>
  `https://cards.scryfall.io/art_crop/front/${cardId[0]}/${cardId[1]}/${cardId}.jpg`;

/** Pastille de variation. `white-space:nowrap` n'est pas décoratif : sans lui
 *  Gmail coupe « +18,4 % » entre le nombre et le signe pourcent. */
function badge(ev) {
  const up = ev.direction === 'up';
  return `<span style="display:inline-block;padding:3px 9px;border-radius:11px;background:${
    up ? C.upBg : C.downBg
  };color:${up ? C.up : C.down};font:600 12px/1.4 ${SANS};white-space:nowrap;">${
    up ? '▲' : '▼'
  } ${esc(describeEvent(ev))}</span>`;
}

const overline = (text) =>
  `<div style="font:600 11px/1 ${SANS};letter-spacing:1.6px;text-transform:uppercase;color:${C.gold};">${esc(text)}</div>`;

const subLine = (ev) =>
  [
    ev.set_code ? ev.set_code.toUpperCase() : null,
    ev.collector_number ? `#${ev.collector_number}` : null,
    ev.finish && ev.finish !== 'nonfoil' ? '✦ foil' : null,
  ]
    .filter(Boolean)
    .join(' · ');

/* -------------------------------------------------------------------------- */
/* Blocs                                                                       */
/* -------------------------------------------------------------------------- */

/** Une ligne d'événement : vignette, identité, prix et variation.
 *
 *  La vignette montre la carte entière et non son illustration : à 52 px,
 *  c'est la silhouette et la couleur du cadre qui la font reconnaître d'un
 *  coup d'œil, pas le détail du dessin. */
function eventRow(ev, last) {
  const border = last ? 'none' : `1px solid ${C.rule}`;
  const thumb = ev.image_small
    ? `<img src="${ev.image_small}" width="52" height="73" alt="" style="display:block;width:52px;height:73px;border:1px solid ${C.rule};border-radius:4px;">`
    : '';
  return `
      <tr>
        <td width="52" valign="top" style="padding:12px 0;border-bottom:${border};">${thumb}</td>
        <td valign="middle" style="padding:12px 14px;border-bottom:${border};">
          <div style="font:600 15px/1.3 ${SERIF};color:${C.ink};">${esc(ev.card_name)}</div>
          <div style="font:12px/1.5 ${SANS};color:${C.soft};padding-top:3px;">${esc(subLine(ev))}</div>
        </td>
        <td valign="middle" align="right" style="padding:12px 0;border-bottom:${border};white-space:nowrap;">
          <div style="font:700 15px/1.3 ${SANS};color:${C.ink};">${eur(ev.price_now)}</div>
          <div style="padding-top:5px;">${badge(ev)}</div>
        </td>
      </tr>`;
}

function section(label, rows) {
  if (!rows.length) return '';
  return `
        <tr><td style="padding:26px 28px 0;">
          ${overline(label)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:6px;">
            ${rows.map((ev, i) => eventRow(ev, i === rows.length - 1)).join('')}
          </table>
        </td></tr>`;
}

/** Le mouvement le plus marquant, en bandeau illustré.
 *
 *  Un seul, jamais deux : c'est ce qui donne au message un point d'entrée.
 *  Trois bandeaux à la suite et il n'y a plus de hiérarchie, seulement une
 *  liste coûteuse à charger. */
function hero(ev) {
  if (!ev || !ev.card_id) return '';
  return `
        <tr><td style="padding:24px 28px 0;">
          ${overline('Le mouvement de la semaine')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:8px;background:#FFFFFF;border:1px solid ${C.rule};border-radius:12px;">
            <tr><td style="padding:0;">
              <img src="${artUrl(ev.card_id)}" width="542" alt="${esc(ev.card_name)}"
                   style="display:block;width:100%;max-width:542px;height:auto;border:0;border-radius:12px 12px 0 0;">
            </td></tr>
            <tr><td style="padding:14px 18px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td valign="middle">
                  <div style="font:600 18px/1.3 ${SERIF};color:${C.ink};">${esc(ev.card_name)}</div>
                  <div style="font:12px/1.5 ${SANS};color:${C.soft};padding-top:3px;">${esc(subLine(ev))}</div>
                </td>
                <td valign="middle" align="right" style="white-space:nowrap;">
                  <div style="font:700 20px/1.2 ${SANS};color:${C.ink};">${eur(ev.price_now)}</div>
                  <div style="padding-top:6px;">${badge(ev)}</div>
                </td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>`;
}

/** Petit histogramme de la valeur de collection.
 *
 *  Dessiné en cellules de tableau, pas en SVG : Gmail supprime purement et
 *  simplement les balises SVG. Une cellule de hauteur fixe est la seule
 *  primitive graphique sur laquelle tous les clients s'accordent. */
function bars(values) {
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const cells = values
    .map((v, i) => {
      const h = 8 + Math.round(((v - min) / span) * 32);
      const color = i === values.length - 1 ? C.gold : C.goldSoft;
      return `<td valign="bottom" style="padding:0 2px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td height="${h}" width="9" bgcolor="${color}" style="height:${h}px;width:9px;font-size:0;line-height:0;border-radius:2px 2px 0 0;">&nbsp;</td>
            </tr></table></td>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr>${cells}</tr></table>`;
}

/** Le résumé de valeur, en tête du digest hebdo. */
function summaryBlock({ now, delta, history }) {
  const up = delta === null || delta >= 0;
  return `
        <tr><td style="padding:22px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${C.panel};border-radius:12px;">
            <tr>
              <td valign="middle" style="padding:18px 20px;">
                ${overline('Valeur de la collection')}
                <div style="font:700 30px/1.2 ${SERIF};color:${C.ink};padding-top:6px;">${eur(now)}</div>
                ${
                  delta === null
                    ? ''
                    : `<div style="font:600 13px/1.5 ${SANS};color:${up ? C.up : C.down};padding-top:4px;">${
                        up ? '+' : '−'
                      }${eur(Math.abs(delta))} sur 7 jours</div>`
                }
              </td>
              <td valign="bottom" align="right" style="padding:18px 20px;">${bars(history)}</td>
            </tr>
          </table>
        </td></tr>`;
}

/* -------------------------------------------------------------------------- */
/* Le message                                                                  */
/* -------------------------------------------------------------------------- */

function buildHtml({ title, intro, ups, downs, others, summary, heroEvent, count }) {
  return `<div style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.sheet};border:1px solid ${C.rule};border-radius:14px;">

        <tr><td style="padding:28px 28px 0;">
          ${overline(`◆ ${APP}`)}
          <div style="font:400 26px/1.25 ${SERIF};color:${C.ink};padding-top:10px;">${esc(title)}</div>
          <div style="font:13px/1.6 ${SANS};color:${C.soft};padding-top:6px;">${esc(intro)}</div>
        </td></tr>

        <tr><td style="padding:18px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td height="2" bgcolor="${C.goldSoft}" style="height:2px;font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
        </td></tr>

        ${summary ?? ''}
        ${hero(heroEvent)}
        ${section('Hausses', ups)}
        ${section('Baisses', downs)}
        ${section('Seuils et couloirs', others)}

        <tr><td style="padding:28px 28px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td height="1" bgcolor="${C.rule}" style="height:1px;font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
          <div style="font:12px/1.7 ${SANS};color:${C.faint};padding-top:14px;">
            ${count} mouvement${count > 1 ? 's' : ''} relevé${count > 1 ? 's' : ''} selon tes règles d'alerte.<br>
            Prix Cardmarket en euros, fournis par Scryfall. Illustrations © Wizards of the Coast.<br>
            ${esc(APP)}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</div>`;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

/** Le message d'un utilisateur, à partir de ses événements. */
function composeFor(userEvents, summary) {
  const ups = userEvents.filter((e) => e.metric === 'pct_change' && e.direction === 'up');
  const downs = userEvents.filter((e) => e.metric === 'pct_change' && e.direction === 'down');
  const others = userEvents.filter((e) => e.metric !== 'pct_change');

  // Le bandeau prend le plus fort mouvement chiffré, et cette carte est alors
  // retirée de sa rubrique : la voir deux fois se lirait comme un doublon,
  // pas comme une mise en avant.
  const ranked = [...ups, ...downs].sort(
    (a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)
  );
  const heroEvent = mode === 'weekly' ? (ranked[0] ?? null) : null;
  const without = (list) => (heroEvent ? list.filter((e) => e !== heroEvent) : list);

  const subject =
    mode === 'weekly'
      ? `${APP} — ton récap hebdo (${userEvents.length} mouvement${userEvents.length > 1 ? 's' : ''})`
      : `${APP} — ${userEvents[0].card_name}${userEvents.length > 1 ? ` et ${userEvents.length - 1} autre(s)` : ''}`;

  const html = buildHtml({
    title: mode === 'weekly' ? 'Récap hebdomadaire' : 'Alerte prix',
    intro:
      mode === 'weekly'
        ? 'Les mouvements notables de la semaine sur ta collection.'
        : 'Un mouvement correspondant à une de tes alertes immédiates vient d’être détecté.',
    ups: without(ups),
    downs: without(downs),
    others,
    summary,
    heroEvent,
    count: userEvents.length,
  });

  return { subject, html };
}

const EVENT_COLUMNS = `ev.id, ev.user_id, ev.card_id, ev.finish, ev.metric, ev.direction,
            ev.price_now, ev.change_pct, ev.triggered_on,
            c.name as card_name, c.set_code, c.collector_number, c.image_small`;

/** Total courant, écart sur la fenêtre, et l'historique pour l'histogramme. */
async function summaryFor(db, userId) {
  const { rows } = await db.query(
    `select snapped_on, sum(value_eur) as total
       from collection_value_snapshots cvs
       join folders f on f.id = cvs.folder_id and f.kind = 'collection'
      where cvs.user_id = $1
      group by snapped_on
      order by snapped_on desc
      limit 8`,
    [userId]
  );
  if (rows.length === 0) return null;
  const now = Number(rows[0].total);
  const before = rows.length > 1 ? Number(rows[rows.length - 1].total) : null;
  return summaryBlock({
    now,
    delta: before === null ? null : now - before,
    history: rows.map((r) => Number(r.total)).reverse(),
  });
}

async function sendEmail(apiKey, to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/* -------------------------------------------------------------------------- */
/* Aperçu                                                                      */
/* -------------------------------------------------------------------------- */

/** Écrit le message sur disque, avec de vraies cartes et des mouvements
 *  inventés. Aucun envoi, aucun `digested_at` touché. */
async function writePreview(db, file) {
  const { rows: cards } = await db.query(
    `select c.id as card_id, c.name as card_name, c.set_code, c.collector_number,
            c.image_small, s.eur
       from cards c
       join collection_items i on i.card_id = c.id
       join card_price_stats s on s.card_id = c.id
      where s.eur is not null
      group by c.id, c.name, c.set_code, c.collector_number, c.image_small, s.eur
      order by s.eur desc nulls last
      limit 8`
  );
  if (cards.length === 0) throw new Error('Aucune carte avec un prix : rien à mettre en aperçu.');

  const at = (i, extra) => {
    const card = cards[i % cards.length];
    return { ...card, price_now: Number(card.eur), ...extra };
  };
  const events = [
    at(0, { metric: 'pct_change', direction: 'up', change_pct: 18.4, finish: 'nonfoil' }),
    at(1, { metric: 'pct_change', direction: 'up', change_pct: 9.7, finish: 'foil' }),
    at(2, { metric: 'pct_change', direction: 'up', change_pct: 6.1, finish: 'nonfoil' }),
    at(3, { metric: 'pct_change', direction: 'down', change_pct: -12.6, finish: 'nonfoil' }),
    at(4, { metric: 'pct_change', direction: 'down', change_pct: -5.2, finish: 'nonfoil' }),
    at(5, { metric: 'corridor_breakout', direction: 'up', change_pct: null, finish: 'nonfoil' }),
    at(6, { metric: 'threshold_below', direction: 'down', change_pct: null, finish: 'nonfoil' }),
  ];

  const { rows: users } = await db.query('select id from auth.users limit 1');
  let summary = users.length ? await summaryFor(db, users[0].id) : null;
  if (!summary) {
    // Pas encore d'historique : on montre quand même le bloc, sinon l'aperçu
    // ne dit rien de ce à quoi le message ressemblera une fois nourri.
    const total = events.reduce((s, e) => s + e.price_now, 0);
    summary = summaryBlock({
      now: total,
      delta: total * 0.043,
      history: [0.94, 0.96, 0.95, 0.98, 0.99, 1.01, 1.0, 1.043].map((k) => total * k),
    });
  }

  const { subject, html } = composeFor(events, summary);
  fs.writeFileSync(file, html);
  console.log(`Objet : ${subject}`);
  console.log(`Aperçu écrit dans ${file}`);
}

/* -------------------------------------------------------------------------- */

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!preview && !apiKey) {
    console.log('RESEND_API_KEY absent — envoi d’emails sauté.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  if (preview) {
    await writePreview(db, typeof preview === 'string' ? preview : 'apercu-digest.html');
    await db.end();
    return;
  }

  const { rows: events } = await db.query(
    `select ${EVENT_COLUMNS}, u.email
     from alert_events ev
     join alert_rules r on r.id = ev.rule_id
     join cards c on c.id = ev.card_id
     join auth.users u on u.id = ev.user_id
     where ev.digested_at is null
       and r.channel = $1
       ${mode === 'immediate' ? 'and ev.triggered_on = current_date' : ''}
     order by abs(coalesce(ev.change_pct, 0)) desc`,
    [mode === 'immediate' ? 'immediate' : 'digest']
  );

  if (events.length === 0) {
    console.log('Aucun événement à envoyer.');
    await db.end();
    return;
  }

  const byUser = new Map();
  for (const ev of events) {
    if (!byUser.has(ev.user_id)) byUser.set(ev.user_id, []);
    byUser.get(ev.user_id).push(ev);
  }

  for (const [userId, userEvents] of byUser) {
    const summary = mode === 'weekly' ? await summaryFor(db, userId) : null;
    const { subject, html } = composeFor(userEvents, summary);
    await sendEmail(apiKey, userEvents[0].email, subject, html);
    await db.query('update alert_events set digested_at = now() where id = any($1)', [
      userEvents.map((e) => e.id),
    ]);
    console.log(`Email envoyé à ${userEvents[0].email} (${userEvents.length} événements).`);
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
