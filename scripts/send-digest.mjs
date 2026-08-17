// Envoi des emails d'alerte via Resend.
//
//   --mode weekly     digest hebdomadaire : tous les événements non envoyés
//                     des règles channel='digest', + résumé de la collection.
//   --mode immediate  événements du jour des règles channel='immediate'
//                     (lancé après l'ingestion quotidienne).
//
// Sans RESEND_API_KEY, le script sort en succès sans rien faire (le job
// reste vert tant que l'utilisateur n'a pas configuré l'email).
//
// Usage : DATABASE_URL=... RESEND_API_KEY=... node scripts/send-digest.mjs --mode weekly

import pg from 'pg';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'weekly';
if (!['weekly', 'immediate'].includes(mode)) throw new Error(`Mode inconnu : ${mode}`);

const FROM = process.env.DIGEST_FROM ?? 'Grimoire <onboarding@resend.dev>';

const eur = (v) =>
  v === null || v === undefined ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`;
const pct = (v) =>
  v === null || v === undefined ? '' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1).replace('.', ',')} %`;

function describeEvent(ev) {
  if (ev.metric === 'corridor_breakout')
    return ev.direction === 'up' ? 'sortie du couloir par le haut' : 'sortie du couloir par le bas';
  if (ev.metric === 'threshold_above') return `a franchi le seuil`;
  if (ev.metric === 'threshold_below') return `est passé sous le seuil`;
  return pct(ev.change_pct);
}

function eventRow(ev) {
  const color = ev.direction === 'up' ? '#15803d' : '#b91c1c';
  const arrow = ev.direction === 'up' ? '▲' : '▼';
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;">
        <strong>${ev.card_name}</strong>${ev.finish !== 'nonfoil' ? ' ✦' : ''}
        <span style="color:#777;font-size:13px;"> · ${ev.set_code.toUpperCase()} #${ev.collector_number}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
        <strong>${eur(ev.price_now)}</strong>
        <span style="color:${color};font-size:13px;"> ${arrow} ${describeEvent(ev)}</span>
      </td>
    </tr>`;
}

function buildHtml({ title, intro, ups, downs, others, summary }) {
  const section = (label, rows) =>
    rows.length
      ? `<h3 style="margin:24px 0 4px;font-size:15px;">${label}</h3>
         <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows.map(eventRow).join('')}</table>`
      : '';
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
    <div style="padding:28px 0 12px;border-bottom:2px solid #E8B64C;">
      <span style="font-size:22px;">✦ Grimoire</span>
      <span style="color:#777;font-size:14px;"> — ${title}</span>
    </div>
    ${summary ?? ''}
    <p style="font-size:14px;color:#444;">${intro}</p>
    ${section('📈 Hausses', ups)}
    ${section('📉 Baisses', downs)}
    ${section('🔔 Seuils & couloirs', others)}
    <p style="margin-top:32px;font-size:12px;color:#999;">
      Prix Cardmarket (EUR) · Powered by Scryfall · Grimoire
    </p>
  </div>`;
}

async function sendEmail(apiKey, to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('RESEND_API_KEY absent — envoi d’emails sauté.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const { rows: events } = await db.query(
    `select ev.id, ev.user_id, ev.finish, ev.metric, ev.direction, ev.price_now,
            ev.change_pct, ev.triggered_on,
            c.name as card_name, c.set_code, c.collector_number,
            u.email
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
    const ups = userEvents.filter((e) => e.metric === 'pct_change' && e.direction === 'up');
    const downs = userEvents.filter((e) => e.metric === 'pct_change' && e.direction === 'down');
    const others = userEvents.filter((e) => e.metric !== 'pct_change');

    // Résumé de la valeur de collection (digest hebdo uniquement).
    let summary = null;
    if (mode === 'weekly') {
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
      if (rows.length > 0) {
        const now = Number(rows[0].total);
        const before = rows.length > 1 ? Number(rows[rows.length - 1].total) : null;
        const delta = before !== null ? now - before : null;
        const deltaColor = delta !== null && delta < 0 ? '#b91c1c' : '#15803d';
        summary = `
          <div style="background:#faf6ec;border-radius:10px;padding:16px 20px;margin-top:18px;">
            <div style="font-size:13px;color:#777;">Valeur de ta collection</div>
            <div style="font-size:26px;font-weight:bold;">${eur(now)}</div>
            ${delta !== null ? `<div style="font-size:13px;color:${deltaColor};">${delta >= 0 ? '+' : ''}${eur(Math.abs(delta))} sur 7 jours</div>` : ''}
          </div>`;
      }
    }

    const subject =
      mode === 'weekly'
        ? `✦ Grimoire — ton récap hebdo (${userEvents.length} mouvement${userEvents.length > 1 ? 's' : ''})`
        : `✦ Grimoire — ${userEvents[0].card_name}${userEvents.length > 1 ? ` et ${userEvents.length - 1} autre(s)` : ''}`;

    const html = buildHtml({
      title: mode === 'weekly' ? 'récap hebdomadaire' : 'alerte prix',
      intro:
        mode === 'weekly'
          ? 'Voici les mouvements notables de la semaine, selon tes règles d’alerte.'
          : 'Un mouvement correspondant à une de tes alertes immédiates vient d’être détecté.',
      ups,
      downs,
      others,
      summary,
    });

    await sendEmail(apiKey, userEvents[0].email, subject, html);
    await db.query(`update alert_events set digested_at = now() where id = any($1)`, [
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
