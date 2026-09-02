// Fabrique le récap hebdomadaire de chaque utilisateur.
//
// Tout le travail est en SQL (`build_weekly_reports`), et ce n'est pas de la
// paresse : le rapport agrège des lignes qui croissent avec la collection —
// exemplaires, relevés de prix, événements d'alerte. Les rapatrier pour les
// sommer ici serait exactement l'erreur que le tableau de bord a déjà payée,
// quand PostgREST tronquait sa réponse à 1000 lignes en silence.
//
// Ce script remplace `send-digest.mjs`. Il ne demande aucune clé tierce : le
// rapport est lu dans l'app, il ne part nulle part.
//
// Usage : DATABASE_URL=postgres://... node scripts/build-weekly-report.mjs
//         node --env-file=.env scripts/build-weekly-report.mjs

import pg from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  try {
    const { rows } = await db.query('select public.build_weekly_reports() as built');
    const built = rows[0].built;
    console.log(`Rapports fabriqués : ${built}`);

    // Un aperçu de ce qui vient d'être écrit. Un job qui se contente de dire
    // « fait » ne permet pas de distinguer un rapport vide d'un rapport
    // absent — et c'est précisément ce silence-là qui a fait passer douze
    // jours sans récap sans que personne le voie.
    const { rows: summary } = await db.query(
      `select period_end,
              value_eur,
              jsonb_array_length(risers) as risers,
              jsonb_array_length(fallers) as fallers,
              event_count
         from weekly_reports
        where period_end = current_date
        order by value_eur desc nulls last`
    );

    for (const r of summary) {
      console.log(
        `  ${r.period_end.toISOString().slice(0, 10)} · valeur ${r.value_eur ?? '—'} € · ` +
          `${r.risers} hausse(s), ${r.fallers} baisse(s), ${r.event_count} alerte(s)`
      );
    }

    if (summary.every((r) => r.risers === 0 && r.fallers === 0 && r.event_count === 0)) {
      console.warn(
        'Aucun mouvement retenu cette semaine. Causes possibles : historique de ' +
          'prix trop court pour une fenêtre de 7 jours, ou aucune carte au-dessus ' +
          'du plancher d’un euro.'
      );
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
