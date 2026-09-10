# TransitPulse AI — Crowd-Aware Transit Intelligence

> **Predict → Avoid → Optimize.**
> Passengers usually pick a route without knowing how crowded it will be.
> TransitPulse forecasts occupancy *before* boarding and recommends the itinerary
> that gets you there comfortably — explaining every trade-off it made.

A full-stack hackathon prototype: **React + TypeScript + Tailwind CSS** on the front,
**Express + Supabase/Postgres** on the back, with a transparent, explainable crowd
model in between.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Commuter Dashboard   Route Results   Route Details   Operator   Alerts     │
├─────────────────────────────────────────────────────────────────────────────┤
│  React 19 · TypeScript · Tailwind v4 · React Query · React Router           │
│                          ⇅  typed /api client                               │
│  Express API · services (planner, crowd model) · repositories               │
│                          ⇅  SQL (schema + views + functions)                │
│  Postgres  —  Supabase in production, embedded Postgres for zero-config demo │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Run it

```bash
npm install
npm run dev          # API (:8787) + Vite dev server (:5173) together
```

Open the dev server and you are on the **Commuter Dashboard**. No database
credentials are required: the API creates an embedded PostgreSQL database in
`.data/transitpulse`, applies the same migrations used by Supabase, and seeds a
deterministic 14-day demo dataset (~9.5k telemetry rows, 6 lines, 16 stops, 24
vehicles, 8 alerts, ~1k journey searches).

| Script | What it does |
| --- | --- |
| `npm run dev` | API + web dev servers (`concurrently`) |
| `npm run dev:api` / `npm run dev:web` | Run either half on its own |
| `npm run build` | Production frontend build |
| `npm run typecheck` | `tsc --noEmit` across app, shared and server |
| `npm run smoke` | Renders every route in jsdom against a running API and asserts real data |
| `npm run db:status` | Row counts + current schema version |
| `npm run db:reset` | Re-apply the demo seed (stop the API first — see note) |
| `npm run db:sql -- "select * from v_network_summary"` | Ad-hoc SQL |

> **Embedded database note:** the zero-config database is a single-process
> engine. Stop the API before running `db:*` scripts, or point `DATABASE_URL`
> at a real Postgres/Supabase instance (multi-connection safe).

### Use Supabase Postgres instead

```bash
cp .env.example .env
# Supabase dashboard → Project Settings → Database → Connection string (session pooler)
echo 'DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' >> .env
npm run dev:api      # migrations + seed are applied automatically on first boot
```

Nothing else changes: the schema, views, functions, RLS policies and seed data in
`supabase/` are engine-agnostic, and the API reports which driver it is using at
`GET /api/health`.

---

## 2. The six screens

| Area | Route | What it answers |
| --- | --- | --- |
| **1. Commuter dashboard** | `/` | What should I do right now? Next-journey recommendation, live network pressure, departure boards with predicted load per service, saved journeys with live crowd snapshots, active alerts. |
| **2. Route results** | `/routes` | Which option should I take? Crowd-aware itineraries ranked by a tunable objective, with the busiest option called out so you can see what you avoid. |
| **3. Route details** | `/routes/details` | Is this really the best choice? Leg-by-leg boarding plan, per-leg load, live forecast chart (measured history + prediction interval), model factor breakdown, line & stop context, trade-off scores. |
| **4. Operator dashboard** | `/operator` | How is the network performing? Fleet state, 24-hour load profiles per line, crowding hotspots, demand signals from real searches, service KPIs, live system health. |
| **5. Alerts** | `/alerts` | What has gone wrong and who knows? Filterable notices, severity mix, and a composer that publishes straight into the `alerts` table. |
| **6. Settings** | `/settings` | How should TransitPulse plan for me? Crowd tolerance, walking, transfers, preferred modes, notification thresholds, saved journeys. |

Every screen is responsive: a three-column data layout on desktop, compact stacked
cards on tablet, and a bottom-tab navigation shell on mobile.

---

## 3. Where the data comes from

No component contains a hardcoded trip, crowding figure or KPI. The UI only ever
renders API responses, and the API only ever reads Postgres.

```
src/pages/**            screens (no data fetching logic, no SQL)
src/components/**       reusable UI + visualisation primitives
src/hooks/**            React Query hooks — the only place screens fetch data
src/lib/api.ts          typed API client (single fetch surface)
        │
server/routes/**        HTTP surface, validation (zod), status codes
server/services/**      planner · crowd model · operator analytics · dashboard
server/repositories/**  all SQL — one module per domain aggregate
server/db/**            driver abstraction (Supabase Postgres ⇄ embedded) + migrations
supabase/migrations/**  schema, derived views, SQL functions, RLS policies
supabase/seed/**        deterministic demo dataset
shared/**               types + crowd thresholds shared by client and server
```

### Database schema (highlights)

| Table | Purpose |
| --- | --- |
| `agencies`, `stops`, `lines`, `line_stops` | Network topology (GTFS-shaped) |
| `service_patterns` | Frequency-based timetable (headway + first/last departure) |
| `vehicles` | Fleet state, next stop, schedule adherence |
| `crowd_observations` | Raw occupancy telemetry with a trigger that normalises day/hour buckets |
| `crowd_forecasts` | Model output persisted per line/stop/target time |
| `alerts` | Rider-facing service notices |
| `rider_profiles`, `watchlist` | Rider preferences and saved journeys |
| `route_searches`, `route_search_options` | Every planner run, so operator demand data is real |
| `model_config` | Model metadata, planner weights and service targets (tunable without a deploy) |

Analytical work lives in SQL so both the API and any future BI tool see the same
numbers:

* `v_line_stop_offsets` — running travel time from each line's origin (powers ETA maths)
* `v_line_hourly_profile`, `v_line_hourly_profile_all_stops` — 14-day learned baselines
* `v_latest_crowd_reading`, `v_line_crowding_now` — live occupancy per line/stop
* `v_operator_line_load`, `v_network_summary` — operator rollups
* `fn_next_departures(stop, from, horizon)` — expands the timetable into real departures, direction-aware
* `fn_line_segments(line, from_seq, to_seq)` — ordered stops with running ETA
* `fn_crowd_level(ratio)` — the green/yellow/orange/red bucket used everywhere

**Row Level Security** is enabled on every table: network, timetable, crowd data
and alerts are public read-only; rider profile, watchlist and search history are
scoped to `auth.uid()`. Server-side writes use the owner/service role, and a
compatibility shim in `0000_supabase_compat.sql` creates the Supabase `auth`
schema and roles only when they are missing — so the same migrations run on
Supabase and on the embedded demo database.

---

## 4. How the prediction works

`server/services/crowd-model.ts` blends four signals and returns both the number
and the reason for it:

1. **Learned baseline** — the 14-day hourly mean *and* 90th percentile of
   `crowd_observations` for that exact line/stop/day-type/hour cell, interpolated
   smoothly across the hour boundary.
2. **Service pressure** — short headways bunch passengers onto fewer vehicles.
3. **Live context** — active crowding alerts and upstream load carried down the line.
4. **Confidence** — degrades with horizon and with thin history.

Every prediction reports its per-factor contribution in occupancy points, which is
what the **Model breakdown** tab renders. Forecasts are written back into
`crowd_forecasts`, so riders, operators and API consumers share one picture.

### The recommendation engine

`server/services/planner.ts`:

1. **Enumerate** feasible ride sequences through the network graph (respecting the
   rider's transfer budget, including walking transfers between nearby stops).
2. **Schedule** each sequence against the real timetable by asking the database for
   the next departures at every boarding stop — direction-aware, so inbound and
   outbound services do not collapse into the same timestamp.
3. **Predict** occupancy for every leg at the exact minute the rider would be on
   board, including peak load along the leg.
4. **Score** with weights from `model_config.planner_weights`:

   ```
   score = time·1.0 + crowdPenalty(load)·crowd·toleranceScale + transfers·4.5 + walk·1.6
   ```

   `crowdPenalty` grows super-linearly past 80 % occupancy, so "busy but fine" stays
   cheap while crush loads are punished.
5. **Label and explain**: the winner becomes `Recommended`, and the remaining slots
   go to the itineraries that win on time, crowding and changes. Insights are
   generated from the data — including the *Optimize* nudge ("leaving 3 minutes
   later is ~11 points quieter on M1").

Each run is persisted to `route_searches` / `route_search_options`, which is why
the operator dashboard's demand panel and "crowding avoided by routing" KPI are
real aggregates rather than illustrative numbers.

---

## 5. Design direction

* **Dark transportation-tech shell** — layered radial gradients, subtle grid, glass
  panels (`glass`, `glass-strong`) used only where depth communicates hierarchy.
* **One colour language** — green → yellow → orange → red crowd scale defined once
  in `shared/crowd.ts` and mirrored in `src/index.css` theme tokens, so a colour
  always means the same occupancy band across charts, meters and badges.
* **Data visualisation without a chart library** — the forecast chart, sparklines
  and hourly load profiles are hand-built SVG/CSS, keeping the bundle small and the
  styling consistent.
* **Motion with restraint** — one-shot rise-in on cards, a pulsing "live" dot, and
  hover/active feedback. `prefers-reduced-motion` is respected globally.
* **Typography** — Space Grotesk for display numerals and headings, Inter for body,
  JetBrains Mono for times, ratios and IDs.

---

## 6. API reference

| Method | Endpoint | Returns |
| --- | --- | --- |
| `GET` | `/api/health` | Driver, schema version, latency, row counts, model version |
| `GET` | `/api/network` | Agency, stops, lines, model metadata |
| `GET` | `/api/stops`, `/api/stops/:id` | Stop search and live departure board with predictions |
| `GET` | `/api/lines`, `/api/lines/:id` | Line metadata / stop sequence + active alerts |
| `GET\|POST` | `/api/plan` | Ranked crowd-aware itineraries, insights, recommended option |
| `GET` | `/api/journey-context` | Line + stop + forecast + alerts for one leg |
| `GET` | `/api/crowd/live`, `/api/crowd/forecast`, `/api/crowd/history` | Live readings, forecast series, trailing observations |
| `GET\|POST\|PATCH\|DELETE` | `/api/alerts` (`/:id`) | List, publish, resolve/reopen, retract |
| `GET` | `/api/operator/overview\|fleet\|line-load\|demand\|config` | Control-room analytics |
| `GET\|PATCH` | `/api/profile` | Rider preferences |
| `GET\|POST` | `/api/watchlist` (`/:id`, `/:id/toggle`) | Saved journeys |
| `GET` | `/api/dashboard` | The commuter dashboard payload |
| `GET` | `/api/settings/options` | Stops, modes and languages for Settings |

Errors always come back as `{ "error": { "message", "code", "details?" } }`.

---

## 7. Demo script (3 minutes)

1. **Dashboard** — point out the recommended departure, "crowding avoided", the live
   network pressure list and the departure boards showing a *predicted* load per
   service (`crowd_forecasts` written by the model).
2. **Plan a journey** — set `Greenfield → Tech Park North`, leave the routing option
   "Minimise crowding" on, and search.
3. **Route results** — the recommended option is compared with the busiest itinerary
   on the corridor; the insight rail explains how much crowding was avoided and
   suggests a better departure time. Tap **Leave in 15 minutes** to re-plan and watch
   the numbers change.
4. **Route details** — walk through the boarding plan, the forecast chart (measured
   history → predicted band), and the model breakdown that shows *why*.
5. **Operator** — fleet state, the 24-hour load profile showing both peaks, hotspots,
   and the demand panel proving riders are choosing quieter trips.
6. **Alerts** — publish a crowding notice; it appears instantly for riders.
7. **Settings** — drag crowd tolerance down and re-plan: the planner penalises busy
   carriages harder.

---

## 8. Deliberate scope

This is an architecture-first prototype. The foundation (routing, database
integration, reusable components, real backend, explainable model) is complete;
these are intentionally left for the next iteration:

* **Authentication** — rider identity is a demo profile; Supabase Auth + the
  existing `auth_user_id` column and RLS policies are the intended path.
* **Live vehicle positions** — `vehicles.last_ping`/`next_stop_id` are seeded; a
  GTFS-Realtime feed would replace the seeded fleet state.
* **Model training** — the crowd model is a transparent statistical blend rather
  than a trained network, which keeps the demo explainable and dependency-free.
* **Push delivery** — notification preferences are stored and rendered; an actual
  push/email provider is out of scope.
* **Offline caching / PWA** — data is refetched on an interval instead.
