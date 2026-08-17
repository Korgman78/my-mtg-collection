# Grimoire — Plan & état d'avancement

> Document vivant : mis à jour à chaque session de travail.
> Dernière mise à jour : **2026-08-18**

## Vision

App de collection Magic: The Gathering, belle et modulaire :
dossiers manuels, ajout par recherche intelligente ou scan caméra,
suivi des prix avec couloirs, alertes configurables sur les mouvements,
digest hebdo par email. Objectif scan : nettement plus rapide que Dragon Shield
(reconnaissance on-device, mode rafale).

## Stack (décisions arrêtées)

| Brique | Choix | Note |
|---|---|---|
| App mobile | Expo SDK 56 / React Native, expo-router | `mobile/` — app nommée **Grimoire**, thème sombre bleu nuit + or |
| Backend | Supabase (Postgres, Auth, RLS) | projet `lrpyrbhemwutvfkwpgah` |
| Données cartes & prix | Scryfall (bulk quotidien + API autocomplete) | EUR Cardmarket / USD TCGplayer ; attribution obligatoire |
| Historique prix | Construit par nous (Scryfall n'en fournit pas) | snapshots en base pour les cartes suivies + archives complètes dans `archives/` |
| Ingestion | GitHub Actions, cron 04:30 UTC | `.github/workflows/daily-prices.yml` |
| Emails | Resend (phase 2) | digest hebdo |
| Push | Expo Notifications (nécessite un dev build, pas Expo Go) | reporté après phase 2 |

## Phases

- [x] **Phase 0 — Fondation prix** *(livrée 2026-06-12)*
  Schéma SQL (cards, folders, collection_items, price_snapshots,
  collection_value_snapshots, vue card_price_stats), ingestion quotidienne,
  archives compressées, script de backfill.
- [x] **Phase 1 — App mobile core** *(livrée 2026-06-12)*
  Auth email/mdp, dashboard (valeur totale + dossiers), vue dossier,
  ajout par autocomplete Scryfall (nom → édition → finish/quantité),
  fiche carte (prix, moyenne 30 j, couloir P10–P90, graphe SVG maison).
- [x] **Phase 2 — Alertes & digest** *(code livré 2026-07-23)*
  Tables alert_rules / alert_events + fonction `evaluate_alert_rules`
  (métriques : variation %, sortie de couloir, seuils ; fenêtres 1/7/30 j ;
  canaux digest/immédiat ; dédup sur la fenêtre). Évaluation branchée dans
  `ingest.mjs` après l'ingestion. Écran Alertes dans l'app (règles avec
  activation/suppression + fil d'événements + badge non-lus au dashboard +
  bouton alerte sur la fiche carte). Emails via Resend : `send-digest.mjs`
  (immédiat après ingestion, digest hebdo le dimanche).
  Migration appliquée en base et code commité le 2026-08-18.
  **Reste manuel** : secrets GitHub `RESEND_API_KEY` et `DIGEST_FROM`.
- [x] **Phase 2.5 — Refonte UI** *(livrée 2026-08-18)*
  Direction sobre & premium : palette neutre + accent froid unique réservé
  aux actions, jeu d'icônes SVG maison en remplacement des emoji, système
  de primitives dans `ui.tsx`, barre d'onglets Collection / Alertes.
  Actions cachées derrière un appui long rendues explicites.
- [ ] **Phase 3 — Scanner v1**
  Photo → rectification → reconnaissance pHash côté serveur → confirmation.
- [ ] **Phase 4 — Scanner temps réel on-device**
  vision-camera + détection contour + pHash/embeddings locaux + vote
  multi-frames + mode rafale.
- [ ] **Phase 5 — Confort**
  Import/export CSV (Dragon Shield, Moxfield), top movers sur le dashboard,
  prix d'achat éditable, push notifications (dev build), onboarding, animations.

## Checklist de mise en route (étapes manuelles)

À cocher au fur et à mesure — détails dans le README :

- [x] Projet Supabase créé (ancien projet mis en pause)
- [x] Migrations SQL appliquées — **les 3 sont passées**, vérifié le 2026-08-18
      en interrogeant les tables via l'API REST
- [ ] Secret GitHub `DATABASE_URL` configuré (string **Session pooler**)
- [ ] Premier run du workflow *Daily price ingestion* vérifié (vert + archive committée)
- [x] `mobile/.env` rempli (clé anon Supabase) — corrigé le 2026-08-18,
      le fichier contenait encore `placeholder-…` d'où un `Invalid API key`
- [ ] « Confirm email » désactivé dans Supabase Auth (`mailer_autoconfirm`
      était encore à `false` le 2026-08-18)
- [ ] Secrets GitHub `RESEND_API_KEY` et `DIGEST_FROM` (pour le digest email)

## Notes techniques à retenir

- **Expo SDK 56** : expo-router est indépendant de React Navigation,
  structure `src/app/`, vérifier la doc v56 avant d'utiliser une API.
  Export web en mode `single` (le rendu statique casse sur AsyncStorage).
- **Free tier** : on ne snapshot en base que les cartes présentes en collection ;
  l'historique complet vit dans `archives/*.csv.gz` (~2-3 Mo/jour) et
  `npm run backfill` reconstruit l'historique d'une carte ajoutée après coup.
- **L'app insère le prix du jour** à l'ajout d'une carte (policy RLS dédiée,
  insert du jour uniquement) pour ne pas attendre l'ingestion nocturne.
- **Expo Go ne supporte plus le push** (SDK 53+) : les notifications push
  attendront un development build ; en attendant, alertes in-app + email.

## Journal

- **2026-08-18** — Phase 2 commitée (elle dormait en working tree depuis
  trois semaines) sur la branche `phase-2-alerts`, puis refonte UI complète.
  Vérifications faites en séance : les 3 migrations SQL sont bien appliquées,
  `mobile/.env` contenait un placeholder au lieu de la clé anon (cause du
  `Invalid API key` à l'inscription), et les polices web tombaient en silence
  sur le serif par défaut faute d'import de `global.css`.
  **Non vérifié** : les écrans derrière l'authentification n'ont pas été
  rendus (il aurait fallu saisir le mot de passe) — seul l'écran de connexion
  a été validé visuellement. Le rendu de la barre d'onglets reste à confirmer.
  Prochaine étape : se connecter et éprouver la refonte, puis phase 3 (scanner).
- **2026-07-23** — Phase 2 (code) livrée. Moteur d'alertes SQL + évaluation
  nocturne, écran Alertes dans l'app (règles, fil d'événements, badge non-lus,
  alerte depuis la fiche carte), emails immédiat + digest hebdo via Resend.
  Typecheck et lint verts, types de routes expo-router régénérés.
  Note : `init.sql` avait été vidé par accident — restauré depuis git.
  Prochaine étape : appliquer la migration alertes + secrets Resend, puis
  démarrer la phase 3 (scanner v1).
- **2026-06-12** — Phases 0 et 1 livrées. Repo créé, workflow d'ingestion en
  place (premier run à valider), app Grimoire fonctionnelle (auth, dossiers,
  recherche, fiche carte avec graphe). Démarrage phase 2.
