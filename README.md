# TransitPulse AI — Crowd-Aware Transit Intelligence

> **Predict → Avoid → Optimize.**
> Passengers usually pick a route without knowing how crowded it will be.
> TransitPulse forecasts occupancy *before* boarding and recommends the itinerary
> that gets you there comfortably — explaining every trade-off it made.

A full-stack hackathon prototype: **React + TypeScript + Tailwind CSS** on the front,
**Express + Supabase/Postgres** on the back, with a transparent, explainable crowd
model in between.

> **DEMO / SIMULATED DATA.** The dataset describes a fictional Indian city network
> (`Chennai City Transit (DEMO)`): Indian-style route numbers (`M1`, `21G`, `BR1`),
> locality stops and a simulated fleet. Nothing in this repository is real transit
> data, and the app labels it as simulated wherever data is shown.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Commuter   Route results   Route details   Operator   Alerts   Settings    │
│  Data explorer (live records straight out of Postgres)                     │
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
deterministic 14-day demo dataset.

| Script | What it does |
| --- | --- |
| `npm run dev` | API + web dev servers (`concurrently`) |
| `npm run dev:api` / `npm run dev:web` | Run either half on its own |
| `npm run build` | Production frontend build |
| `npm run typecheck` | `tsc --noEmit` across app, shared and server |
| `npm run smoke` | Renders all seven routes in jsdom against a running API and asserts database-backed content |
| `npm run db:status` | Row counts for every table + current schema version |
| **`npm run db:verify`** | **Executable checklist: columns, keys, indexes, constraints, seed minimums and cross-table joins** |
| `npm run db:refresh` | Rebuild the canonical dataset from the live network model |
| `npm run db:reset` | Re-apply the demo seed (stop the API first — see note) |
| `npm run db:sql -- "select * from v_network_summary"` | Ad-hoc SQL |

> **Embedded database note:** the zero-config database is a single-process
> engine. Stop the API before running `db:*` scripts, or point `DATABASE_URL`
> at a real Postgres/Supabase instance (multi-connection safe).

### Use Supabase Postgres instead

```bash
cp .env.example .env
# Supabase dashboard → Project Settings → Database → Connection string (session pooler)
# DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
npm run dev:api      # migrations + seed are applied automatically on first boot
```

Nothing else changes: schema, views, functions, RLS policies and seed data are
engine-agnostic, and the API reports which driver it is using at `GET /api/health`
(`supabase-postgres` when `DATABASE_URL` is set, `embedded-postgres` otherwise).

### Credentials never reach the browser

* The database connection string lives in the server-side environment only
  (`.env`, git-ignored). Only `DATABASE_URL`, `DB_SSL`, `PGLITE_DIR`,
  `DB_AUTO_MIGRATE`, `DB_RESET`, `PORT` and `DEFAULT_PROFILE_ID` are read.
* The frontend calls relative `/api/...` URLs; there is no `VITE_*` database
  variable, no Supabase key and no connection string in the bundle.
* Row Level Security is enabled on every table: network/timetable/crowd data and
  the published demo dataset are public read-only, rider-owned rows are private,
  and writes go through the Express API using the service role.

---

## 2. The database

### 2.1 Canonical dataset (the published route-level schema)

`supabase/migrations/0004_canonical_dataset.sql` + `0005_dataset_projection.sql`
define the dataset a client, analyst or BI tool reads directly:

| Requested table | Implemented as | Seed rows | Notes |
| --- | --- | ---: | --- |
| `routes` | **`routes`** | 6 | `id`, `route_number`, `route_name`, `origin`, `destination`, `estimated_duration_minutes`, `active`, `created_at` |
| `stops` | **`route_stops`** (readable as `v_stops`) | 32 | The network model shares stops between routes, so the per-route ordered stop list is its own table: `id`, `route_id`, `stop_name`, `latitude`, `longitude`, `stop_order`, `created_at` |
| `vehicles` | **`vehicle_snapshots`** (readable as `v_vehicles`) | 24 | Live snapshot per vehicle: `vehicle_number`, `route_id`, `capacity`, `current_occupancy`, `status`, `latitude`, `longitude`, `updated_at` |
| `occupancy_predictions` | **`occupancy_predictions`** | 72 | `route_id`, `vehicle_id`, `prediction_time`, `predicted_occupancy_percentage`, `crowd_level`, `confidence_percentage` |
| `route_options` | **`route_options`** | 24 | `travel_time_minutes`, `waiting_time_minutes`, `crowd_penalty`, `total_score` |
| `alerts` | **`service_alerts`** (readable as `v_alerts`) | 10 | `alert_type`, `message`, `severity`, `predicted_occupancy`, `estimated_time_to_event`, `active` |
| `users` | **`app_users`** (readable as `v_users`) | 3 | `name`, `email`, `role` ∈ `commuter · operator · admin` |

Every table has a primary key, foreign keys to `routes` (and, where relevant, to
the network model), `CHECK` constraints on ranges and enumerations, `created_at`
/ `updated_at` timestamps, and indexes on the columns the API and explorer sort
and filter by. All seven are marked `DEMO DATA` in the database's own comments —
`npm run db:verify` asserts that too.

**The dataset is projected, never hand-typed.** `fn_refresh_demo_dataset()`
rebuilds it from the live network model, telemetry and model output:

```
routes               ← lines                    + stop sequences
route_stops          ← line_stops + stops
vehicle_snapshots    ← vehicles + live crowd readings
occupancy_predictions← crowd_forecasts          (worst-case load per route/time slot)
route_options        ← routes + planner weights + live crowding
service_alerts       ← alerts
app_users            ← rider_profiles
```

That means the published tables can never drift away from what the rest of the
application is doing. Rebuild any time with `npm run db:refresh`, or from the
Data Explorer's **Rebuild dataset** button (`POST /api/dataset/refresh`).

### 2.2 Network model (what powers prediction)

| Table | Purpose |
| --- | --- |
| `agencies`, `stops`, `lines`, `line_stops` | Network topology (GTFS-shaped) |
| `service_patterns` | Frequency-based timetable (headway + first/last departure) |
| `vehicles` | Fleet roster, next stop, schedule adherence |
| `crowd_observations` | Raw occupancy telemetry (~9.7k rows, 14 days) |
| `crowd_forecasts` | Model output persisted per line/stop/target time |
| `alerts` | Operational notice board (10 notices) |
| `rider_profiles`, `watchlist` | Rider preferences, role and saved journeys |
| `route_searches`, `route_search_options` | Every planner run — operator demand data is real |
| `model_config` | Model metadata, planner weights and service targets (tunable without a deploy) |

Analytical work lives in SQL so the API and any BI tool see identical numbers:

* `v_line_stop_offsets` — running travel time from each line's origin
* `v_line_hourly_profile`, `v_line_hourly_profile_all_stops` — learned 14-day baselines
* `v_latest_crowd_reading`, `v_line_crowding_now` — live occupancy per line/stop
* `v_operator_line_load`, `v_network_summary` — operator rollups
* `fn_next_departures(stop, from, horizon)` — expands the timetable, direction-aware
* `fn_line_segments(line, from_seq, to_seq)` — ordered stops with running ETA
* `fn_crowd_level(ratio)` — the green/yellow/orange/red bucket used everywhere
* `fn_refresh_demo_dataset()` — rebuilds the canonical dataset (above)

Timetable, telemetry and saved journeys are all evaluated in the **agency
timezone** (`Asia/Kolkata` for the demo), so a saved 08:15 departure means 08:15
where the rider is, and the learned demand curve lines up with the local clock.

### 2.3 Verify it yourself

```bash
npm run db:verify
```

```
[db] verification — 48/48 checks passed
  ✓ columns routes — 8 columns            ✓ foreign keys vehicle_snapshots — 2 fk
  ✓ primary key routes                    ✓ indexes occupancy_predictions — 6 index(es)
  ✓ routes ≥ 6 rows — 6 rows              ✓ all three roles present — admin, commuter, operator
  ✓ occupancy_predictions ≥ 30 rows …     ✓ joined route/stop/vehicle/prediction query — 5 rows
  ✓ route score is travel + waiting + crowd penalty — 0 drift (max 0)
  ✓ shared bands: <60 low · 60-85 moderate · >85 high — 0.10=low 0.60=low 0.61=moderate …
  ✓ crowd penalty rises with occupancy — 30%→2.400 · 70%→8.800 · 100%→24.066 min
  ✓ view v_stops — 32 rows …              ✓ tables marked as DEMO DATA — 7/7
```

---

## 3. The screens

| Area | Route | What it answers |
| --- | --- | --- |
| **1. Commuter dashboard** | `/` | *Know the crowd before you board.* — From / To / Departure time and one **Find Best Route** button, above the next-journey recommendation, live network pressure, departure boards with predicted load per service, saved journeys and active alerts. |
| **2. Route results** | `/routes` | Which option should I take? *AI analyzing routes…* while the planner runs, then one card per option: route number and name, travel time, waiting time, predicted occupancy, crowd level, AI confidence and a comfort indicator — clearly badged **AI Recommended**, **Fastest Route** and **Least Crowded Route**, with **Why this route?** expanding to `travel + waiting + crowd penalty = route score`. |
| **3. Route details** | `/routes/details` | Is this really the best choice? Occupancy prediction with AI confidence and crowd trend, leg-by-leg boarding plan, estimated arrival per leg, forecast chart, model factor breakdown, score arithmetic (`/routes/details` keeps the trade-off tab) and alternative routes with what each one avoids. |
| **4. Operator dashboard** | `/operator` | How is the network performing? Fleet state, 24-hour load profiles, crowding hotspots, demand signals from real searches, service KPIs, system health. |
| **5. Alerts** | `/alerts` | What has gone wrong and who knows? Filterable notices, severity mix, and a composer that publishes straight into the `alerts` table. |
| **6. Settings** | `/settings` | How should TransitPulse plan for me? Crowd tolerance, walking, transfers, preferred modes, notification thresholds, saved journeys. |
| **7. Data explorer** | `/database` | What does the database actually contain? Live row counts, columns, primary/foreign keys and paginated records for every canonical table, straight from Postgres. |

Every screen is responsive: three-column data layouts on desktop, stacked cards on
tablet, and a bottom-tab navigation shell on mobile.

---

## 4. How the prediction works

`server/services/crowd-model.ts` blends four signals and returns both the number
and the reason for it:

1. **Learned baseline** — the 14-day hourly mean *and* 90th percentile for that
   line/stop/day-type/hour cell, interpolated across the hour boundary.
2. **Service pressure** — short headways bunch passengers onto fewer vehicles.
3. **Live context** — active crowding alerts and upstream load carried down the line.
4. **Confidence** — degrades with horizon and with thin history.

Every prediction reports its per-factor contribution in occupancy points, which is
what the **Model breakdown** tab renders. Forecasts are written back into
`crowd_forecasts`, so riders, operators and API consumers share one picture.

### The three crowd bands

`shared/crowd.ts` is the single source of truth, mirrored by
`fn_crowd_level()` in Postgres so the API, the UI and a raw SQL query can never
disagree:

| Occupancy | Band | Colour | What it means for a rider |
| --- | --- | --- | --- |
| below 60% | **Low** | green | seats available, plenty of space |
| 60% – 85% | **Moderate** | amber | most seats taken, standing room left |
| above 85% | **High** | red | packed — standing only, consider another option |

The same ratio also drives the **comfort indicator** on every route card
(*Comfortable · Standing room · Packed*), so the card, the badge and the bar all
tell one story.

### The recommendation engine

`server/services/planner.ts`:

1. **Enumerate** feasible ride sequences through the network graph (respecting the
   rider's transfer budget, including walking transfers between nearby stops).
2. **Schedule** each sequence against the real timetable — direction-aware.
3. **Predict** occupancy for every leg at the exact minute the rider is on board.
4. **Score** each itinerary with one transparent, additive rule — the same one
   the route cards show:

   ```
   route score = travel time + waiting time + crowd penalty
   ```

   The crowd term is the occupancy curve expressed in **minute-equivalents**
   (`shared/crowd.ts` ↔ `fn_crowd_penalty_minutes`), scaled by the rider's crowd
   sensitivity, so a comfortable ride can out-score a faster packed one:

   | Predicted occupancy | Band | Penalty |
   | --- | --- | --- |
   | below 60% | Low | nearly free (≈ 0.6 × ratio) |
   | 60% – 85% | Moderate | climbs steadily (≈ 6–14 min) |
   | above 85% | High | steep — a crush load costs more than a detour (14.8 min +) |

5. **Label and explain**: the winner becomes **AI Recommended**, the remaining
   slots go to the itineraries that win on time or crowding (**Fastest Route**,
   **Least Crowded Route**), and `scoreExplanation` is generated from the stored
   numbers — e.g. *"Score 48.7 min = 31 min travel + 12 min waiting + 5.7 min
   crowd penalty (from 61% peak occupancy)"*.

Each run is persisted to `route_searches` / `route_search_options`, which is why
the operator dashboard's demand panel and "crowding avoided by routing" KPI are
real aggregates rather than illustrative numbers.

---

## 5. API reference

| Method | Endpoint | Returns |
| --- | --- | --- |
| `GET` | `/api/health` | Driver, schema version, latency, row counts (network + canonical dataset), model version |
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
| `GET` | `/api/dataset/tables` | Every canonical table with live row counts and the requested-name mapping |
| `GET` | `/api/dataset/tables/:table` | Paginated records (`limit`, `offset`, `orderBy`, `direction`) |
| `GET` | `/api/dataset/schema/:table` | Column definitions, types, keys and foreign-key targets |
| `POST` | `/api/dataset/refresh` | Rebuild the canonical dataset from the network model |

Table and column names are validated against a server-side whitelist plus
`information_schema`, so nothing user-supplied is ever interpolated into SQL:

```
$ curl "localhost:8787/api/dataset/tables/routes?orderBy=id;drop%20table%20routes"
400 {"error":{"message":"Unknown or unsortable column: id;drop","code":"DATASET_BAD_COLUMN"}}
```

Errors always come back as `{ "error": { "message", "code", "details?" } }`.

---

## 6. Design direction

* **Dark transportation-tech shell** — layered radial gradients, subtle grid, glass
  panels used only where depth communicates hierarchy.
* **One colour language** — green → yellow → orange → red crowd scale defined once
  in `shared/crowd.ts` and mirrored in `src/index.css` theme tokens.
* **Data visualisation without a chart library** — forecast chart, sparklines and
  hourly load profiles are hand-built SVG/CSS.
* **Motion with restraint** — one-shot rise-in on cards, a pulsing "live" dot,
  hover/active feedback; `prefers-reduced-motion` is respected globally.
* **Typography** — Space Grotesk for display numerals, Inter for body, JetBrains
  Mono for times, ratios, IDs and table cells.

---

## 7. Demo script (3 minutes)

1. **Home** — read the headline *"Know the crowd before you board."*, then pick a
   saved journey chip (or `Tambaram` → `Tidel Park`) and press **Find Best Route**.
2. **AI analyzing routes…** — the pipeline animates while the planner reads the
   timetable, predicts a load for every leg and scores the options. For the
   clearest demo, flip **Departure time** to *Leave at* `18:20` — the evening
   peak, where the busiest services tip into the red **High** band.
3. **Route results** — the **AI Recommended** card is emphasised and expanded. Point
   at the four numbers (travel, waiting, predicted occupancy, AI confidence), the
   comfort indicator, then open **Why this route?**: `travel + waiting + crowd
   penalty = route score`, with the crowd penalty explaining *why* the
   recommendation is not simply the fastest train. Compare with the **Fastest
   Route** and **Least Crowded Route** cards — each shows its own arithmetic.
4. **Route details** — the occupancy prediction card (peak %, AI confidence, crowd
   trend up / down the line, score), then the leg-by-leg boarding plan with
   estimated arrivals, the forecast chart (measured history → predicted band), the
   model breakdown that shows *why*, and the alternative routes below.
5. **Operator** — fleet state, the 24-hour load profile with both peaks, hotspots,
   and the demand panel proving riders are choosing quieter trips.
6. **Alerts** — publish a crowding notice; it appears instantly for riders, and it
   lands in the `alerts` table (and in `service_alerts` after a dataset refresh).
7. **Database** — open the Data Explorer: real row counts, primary/foreign keys and
   records for `routes`, `route_stops`, `vehicle_snapshots`,
   `occupancy_predictions`, `route_options`, `service_alerts` and `app_users` — then
   press **Rebuild dataset** and show the counts recomputed from the model.
8. **Settings** — drag crowd tolerance down and re-plan: the planner penalises busy
   carriages harder.

---

## 8. Deliberate scope

This is an architecture-first prototype. The foundation (routing, database
integration, reusable components, real backend, explainable model) is complete;
these are intentionally left for the next iteration:

* **Authentication** — rider identity is a demo profile; Supabase Auth + the
  existing `auth_user_id` column and RLS policies are the intended path.
* **Live vehicle positions** — `vehicles.next_stop_id` and `vehicle_snapshots` are
  seeded; a GTFS-Realtime feed would replace the simulated fleet state.
* **Model training** — the crowd model is a transparent statistical blend rather
  than a trained network, which keeps the demo explainable and dependency-free.
* **Push delivery** — notification preferences are stored and rendered; an actual
  push/email provider is out of scope.
* **Offline caching / PWA** — data is refetched on an interval instead.
