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
| `npm run smoke` | Renders all eight routes in jsdom against a running API and asserts database-backed content |
| **`npm run smoke:maps`** | **Same run with a recording mock of the Google Maps SDK + a build-time key: asserts the map really draws corridors, crowd tints, stops, vehicles and popups** |
| **`npm run check:api`** | **Every endpoint answers, and the dashboard figures are compared against a direct read of the same tables (add `CHECK_API_WRITE=1` to also exercise the write path)** |
| **`npm run check:recovery`** | **Pulls the API out from under both dashboards: asserts they explain the failure, never crash and recover on their own when it returns** |
| `npm run db:status` | Row counts for every table + current schema version |
| **`npm run db:verify`** | **Executable checklist: columns, keys, indexes, constraints, seed minimums and cross-table joins** |
| `npm run db:refresh` | Rebuild the canonical dataset from the live network model |
| `npm run db:reset` | Re-apply the demo seed (stop the API first — see note) |
| `npm run db:sql -- "select * from v_network_summary"` | Ad-hoc SQL |

> **Embedded database note:** the zero-config database is a single-process
> engine. Stop the API before running `db:*` scripts, or point `DATABASE_URL`
> at a real Postgres/Supabase instance (multi-connection safe). The `db:*`
> scripts now detect the running API and stop with an explanation instead of
> aborting mid-WASM or silently discarding the write (`DB_ALLOW_CONCURRENT=1`
> overrides the check).

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

### Turn on real Google Maps

Google Maps Platform is the basemap and the geography; TransitPulse is the
intelligence layer drawn on top of it. Add keys to `.env` (git-ignored):

```bash
# Browser key — Maps JavaScript API, restricted to the HTTP referrers the demo
# runs on (http://localhost:5173/*, your preview host). Served to the page by
# GET /api/maps/config, or baked in at build time as VITE_GOOGLE_MAPS_API_KEY.
GOOGLE_MAPS_BROWSER_KEY=AIza...

# Server key — Directions API, restricted by IP. Used only by the API process,
# never sent to the browser (GET /api/maps/directions proxies it).
GOOGLE_MAPS_API_KEY=AIza...
```

* Every map surface loads the SDK from `maps.googleapis.com` with the
  referrer-restricted key, fits the bounds of the network or the selected
  itinerary, and draws the crowd layer with `google.maps.Polyline` / `Marker` /
  `InfoWindow`.
* **No key configured?** The panel says so on screen and falls back to a labelled
  SVG schematic of the same Postgres geometry — never a Google look-alike, never
  an empty box. Crowd bands, stops, fleet markers and popups behave identically.
* A rejected key (`gm_authFailure`) or a failed script load lands in an explicit
  error state with a **Retry** button instead of a blank panel.

### When the API restarts: loading, error and empty states

Every screen reads from Postgres through the API, so the UI has to be honest about
the three states where there is no data to show:

| State | What the screen does |
| --- | --- |
| **Loading** | A named status — *“Loading dashboard data…”* with what is being read — above the layout-matched skeletons. |
| **Unavailable** | After ~12 s without data, a panel that names the cause: *“Unable to load transportation data. Please check the database connection.”*, plus what to check, the API code (`NETWORK_ERROR · HTTP 0`, `BAD_GATEWAY · HTTP 502`, …) and a **Retry** that re-runs *every* failing query. |
| **Connected but empty** | *“No transportation data available yet”* with the command that reseeds the demo dataset, instead of rendering empty cards. |

A short outage is designed to be invisible: requests are retried four times with
backoff (~6 s), the query client refetches on window focus and on reconnect, and a
background recovery loop re-runs failing queries every 3–30 s — so a `tsx watch`
restart no longer strands a page on an error until someone reloads.
`npm run check:recovery` asserts exactly this behaviour.

### Credentials never reach the browser

* The database connection string lives in the server-side environment only
  (`.env`, git-ignored). Only `DATABASE_URL`, `DB_SSL`, `PGLITE_DIR`,
  `DB_AUTO_MIGRATE`, `DB_RESET`, `PORT`, `DEFAULT_PROFILE_ID` and the
  prediction-model settings (`PREDICTION_MODEL_URL`, `PREDICTION_MODEL_API_KEY`,
  `PREDICTION_MODEL_TIMEOUT_MS`, `PREDICTION_WEATHER`) are read.
* The frontend calls relative `/api/...` URLs; there is no `VITE_*` database
  variable, no Supabase key and no connection string in the bundle.
* The Google **browser** key is referrer-restricted and public by design; the
  **server** key is IP-restricted and only ever used inside the API. The one
  Maps variable the frontend reads is `VITE_GOOGLE_MAPS_API_KEY`.
* The Google browser key is referrer-restricted and public by design; the
  Directions key is IP-restricted and proxied. `VITE_GOOGLE_MAPS_API_KEY` is the
  only `VITE_*` variable the frontend reads.
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
| `weather_conditions` | Simulated hourly weather slots (72) — the **optional** weather input of the prediction engine |
| `rider_profiles`, `watchlist` | Rider preferences, role and saved journeys |
| `route_searches`, `route_search_options` | Every planner run — operator demand data is real |
| `model_config` | Model metadata, planner weights and service targets (tunable without a deploy) |
| `ai_decisions`, `ai_decision_actions` | The AI decision ledger — every intervention an operator applied, its numbered actions and the relief each one was projected to produce |

Analytical work lives in SQL so the API and any BI tool see identical numbers:

* `v_line_stop_offsets` — running travel time from each line's origin
* `v_line_hourly_profile`, `v_line_hourly_profile_all_stops` — learned 14-day baselines
* `v_latest_crowd_reading`, `v_line_crowding_now` — live occupancy per line/stop
* `v_operator_line_load`, `v_network_summary` — operator rollups
* `v_ai_interventions` — each decision joined to the vehicle it released and the alert it raised
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
[db] verification — 59/59 checks passed
  ✓ columns routes — 8 columns            ✓ foreign keys vehicle_snapshots — 2 fk
  ✓ primary key routes                    ✓ indexes occupancy_predictions — 6 index(es)
  ✓ routes ≥ 6 rows — 6 rows              ✓ all three roles present — admin, commuter, operator
  ✓ occupancy_predictions ≥ 30 rows …     ✓ joined route/stop/vehicle/prediction query — 5 rows
  ✓ route score is travel + waiting + crowd penalty — 0 drift (max 0)
  ✓ shared bands: <60 low · 60-85 moderate · >85 high — 0.10=low 0.60=low 0.61=moderate …
  ✓ crowd penalty rises with occupancy — 30%→2.400 · 70%→8.800 · 100%→24.066 min
  ✓ weather_conditions seeded (prediction input) — 72 slots, current clear
  ✓ weather has a forecast window ahead — 65 future slots
  ✓ AI decisions seeded (intervention ledger) — 2 rows, 2 applied
  ✓ applied decisions reference an alert and a vehicle — 2 alert(s), 2 vehicle(s)
  ✓ AI decision actions recorded — 5 actions across 3 kinds
  ✓ intervention never projected worse than the forecast
  ✓ view v_ai_interventions — 2 rows    ✓ tables marked as DEMO DATA — 7/7
```

---

## 3. The screens

| Area | Route | What it answers |
| --- | --- | --- |
| **1. Commuter dashboard** | `/` | *Know the crowd before you board.* — From / To / Departure time and one **Find Best Route** button, above the next-journey recommendation, the **live network map** (Google Maps with the crowd layer: corridor tint = predicted band, markers = the simulated fleet), live network pressure, departure boards with predicted load per service, saved journeys and active alerts. |
| **2. Route results** | `/routes` | Which option should I take? *AI analyzing routes…* while the planner runs, then one card per option: route number and name, travel time, waiting time, predicted occupancy, crowd level, AI confidence and a comfort indicator — clearly badged **AI Recommended**, **Fastest Route** and **Least Crowded Route**, with **Why this route?** expanding to `travel + waiting + crowd penalty = route score`. Above the cards, the **journey map** draws the selected itinerary on Google Maps: highlighted corridor, faint alternatives, every stop and each boarding window's predicted crowd band — press **Show on map** on any card to switch the highlight. |
| **3. Route details** | `/routes/details` | Is this really the best choice? Occupancy prediction with AI confidence and crowd trend, leg-by-leg boarding plan, estimated arrival per leg, forecast chart, model factor breakdown, score arithmetic (`/routes/details` keeps the trade-off tab) alternatives with what each one avoids, and the itinerary drawn on Google Maps above the tabs — click any leg or stop for measured occupancy, forecast, AI confidence and expected trend. |
| **4. Operator Command Center** | `/operator` | What needs attention in the next hour? A live status bar (clock, network state, model), the **control-room map** — every corridor on Google Maps tinted by predicted crowding, with stops, the simulated fleet, service notices, and a rail beside it carrying **Network status** (active routes, active vehicles, average occupancy, high-crowd routes), the **AI alert** (route, current → predicted occupancy, minutes to the threshold, engine scan curve) and the **AI action** (numbered interventions, the projected-impact bars and the apply button), **live route status** for every route (occupancy, crowd band, forecast, vehicles, operating status), a schematic **crowd heatmap** with live / +30 min / 24 h-peak views, the **AI alert feed** (route, predicted occupancy, ETA, severity, recommended action), **AI recommendations** (deploy a vehicle, redirect passengers, tighten headway, fleet readiness — each with evidence, expected impact and a one-click *Dispatch* that publishes the advisory into `alerts`), and **route analytics** (measured → predicted trend per route, current vs forecast). Select any route to open the **AI Decision console**: *AI Detected Congestion* (current vs predicted occupancy, time to congestion, engine scan curve), *AI Recommended Action* (numbered plays with evidence), the **expected impact** bars (without intervention → with intervention, labelled as a simulated projection) and the **Apply AI Recommendation** button that writes the ledger, releases a vehicle and raises the alert. |
| **5. Alerts** | `/alerts` | What has gone wrong and who knows? Filterable notices, severity mix, and a composer that publishes straight into the `alerts` table. |
| **6. Settings** | `/settings` | How should TransitPulse plan for me? Crowd tolerance, walking, transfers, preferred modes, notification thresholds, saved journeys. |
| **7. Prediction engine** | `/engine` | How does the AI actually decide? The five-stage pipeline, the input catalogue, the crowd-classification table (48% → Low, 72% → Moderate, 91% → High) and a live simulator: pick a route, horizon and weather scenario and watch the predicted occupancy, crowd level, confidence and per-factor contribution recompute from the API. |
| **8. Data explorer** | `/database` | What does the database actually contain? Live row counts, columns, primary/foreign keys and paginated records for every canonical table, straight from Postgres. |

Every screen is responsive: multi-column data layouts on desktop, two-column
grids on tablet, and a four-tab bottom bar on mobile (**Home · Plan · Alerts ·
Control**, with **More** opening the full drawer) so nothing is cramped at 360 px.

---

## 4. How the prediction works

The model is a **modular prediction layer** under `server/services/prediction/`.
It runs the same five stages for every answer, in the order they are drawn on
the `/engine` screen:

```
Input Data → Prediction Engine → Occupancy Prediction → Crowd Classification → Route Optimization
```

| Stage | Module | What it does |
| --- | --- | --- |
| 1 · **Input Data** | `signals.ts` · `weather.ts` | Loads **historical occupancy** (14-day mean + p90 per line/stop/day-type/hour), **time of day**, **route** (mode, capacity, headway), **current occupancy** (latest live reading, recency-weighted), **day type** (weekday/Saturday/Sunday in the agency timezone) and the **optional weather factor** from the simulated `weather_conditions` table. |
| 2 · **Prediction Engine** | `engine.ts` · `predictors/` | Any object implementing the `OccupancyPredictor` interface turns a `PredictionInput` into a `PredictionCore`. The shipped **heuristic ensemble** blends the signals; an **external model** can take over instead. |
| 3 · **Occupancy Prediction** | `predict()` | Emits the predicted occupancy **percentage**, headcount vs capacity, an 80% interval, the baseline it started from, a **confidence percentage** and a per-factor contribution in percentage points. |
| 4 · **Crowd Classification** | `classification.ts` | Turns the percentage into the rider-facing band (<60% **Low**, 60–85% **Moderate**, >85% **High**) — the same table `shared/crowd.ts` and `fn_crowd_level()` use. |
| 5 · **Route Optimization** | `planner.ts` | Scores every itinerary as `travel time + waiting time + crowd penalty`, so the recommendation changes when the forecast does. |

**Swapping in a real model.** Set `PREDICTION_MODEL_URL` (plus
`PREDICTION_MODEL_API_KEY` / `PREDICTION_MODEL_TIMEOUT_MS` if needed) and stage 2
posts the assembled `PredictionInput` to that endpoint, expecting the same
`PredictionCore` shape. If the service is unreachable or slow, the engine falls
back to the built-in ensemble and reports `fallbackNote` — nothing else in the
pipeline, the API or the UI changes. `npm run db:verify` asserts the classifier
matches Postgres, and `GET /api/prediction/engine` returns the whole contract.

**Everything the engine consumes is simulated.** Occupancy telemetry, weather
slots and the fleet snapshot are synthetic demo data generated by the seed
scripts — never measurements of a real network — and every prediction response
carries `simulated: true` plus a written disclaimer. The UI shows a
**Simulation Mode** badge in the shell and on the `/engine` and `/routes/details`
screens, so no judge has to guess. No production accuracy is claimed: `accuracy` in
`model_config` is a calibration read on the demo history, not an SLA.

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
the operator command centre's demand panel and "crowding avoided by routing" KPI
are real aggregates rather than illustrative numbers.

### The AI decision loop (detect → recommend → apply)

`server/services/ai-decision.ts` is the operator's version of the same question —
*a route is about to crowd; what do we do about it, and what happens if we do?*

1. **Detect.** The engine scans the route's busiest monitored stop forward in
   15-minute steps to **+180 min** at `GET /api/operator/ai-decision?line=…` and
   reports the first crossing of the crowding threshold. When nothing crosses, it
   reads the route's recurring peak window from the 14-day profile
   (`v_line_hourly_profile`) and evaluates the engine *at that future instant* —
   so late at night the console still shows tomorrow's crush-load risk instead of
   an empty panel.
2. **Recommend.** The numbered actions are composed from real rows: a reserve unit
   from `vehicles` (idle first, then maintenance, else a depot spare), the quietest
   corridor that shares a stop with this route, and a rider advisory whose reach
   comes from `stops.daily_boardings`. Each action carries its own evidence chips.
3. **Project.** Relief compounds — every action removes a share of the *remaining*
   peak load, so the table adds up:
   `with = without × (1 − deploy) × (1 − redirect) × (1 − notify)`.
4. **Apply.** *Apply AI Recommendation* makes a single `POST` that, inside one
   transaction, writes `ai_decisions` + `ai_decision_actions`, releases the
   **vehicle** onto the route (`status='in_service'`, new `line_id`), raises a
   rider-facing row in **`alerts`**, then the console refetches the command centre
   so the KPI tiles, route table and alert feed all move together. A 10-minute
   cooldown stops a double press; *Re-assess* recomputes the route with the extra
   vehicle already in service.

Every figure is a **simulated projection** over the synthetic demo dataset — the
console labels it as such, the ledger stores the method string, and no production
accuracy is claimed.

If a rider plans a journey after the last departure of the day, the planner rolls
the search forward to the **next service window** (read from `service_patterns`
in the agency timezone) and returns those itineraries with a `serviceNote`,
instead of dead-ending on an empty screen.

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
| `GET` | `/api/prediction` | One occupancy prediction (`lineId`, `stopId`, `at`, `weather`) with crowd level, confidence, interval and factor contributions |
| `GET` | `/api/prediction/series` | The same prediction stepped across a horizon (engine-driven curve) |
| `GET` | `/api/prediction/engine` | Pipeline stages, input catalogue, crowd classes, engine descriptor, simulated weather |
| `GET` | `/api/prediction/weather` | Simulated weather slots and the demand multiplier behind each condition |
| `GET\|POST\|PATCH\|DELETE` | `/api/alerts` (`/:id`) | List, publish, resolve/reopen, retract |
| `GET` | `/api/operator/command-center` | The whole command centre: network KPIs, live route status, heatmap geometry + load, AI alerts, AI recommendations, route analytics and the intervention ledger |
| `GET` | `/api/operator/ai-decision` | The AI decision for one route: detected congestion, numbered actions, expected impact, engine scan curve |
| `POST` | `/api/operator/ai-decision/apply` | Applies a recommendation — decision ledger + vehicle release + rider alert in one transaction |
| `GET` | `/api/operator/overview\|fleet\|line-load\|demand\|config` | Supporting control-room analytics |
| `GET\|PATCH` | `/api/profile` | Rider preferences |
| `GET\|POST` | `/api/watchlist` (`/:id`, `/:id/toggle`) | Saved journeys |
| `GET` | `/api/dashboard` | The commuter dashboard payload |
| `GET` | `/api/settings/options` | Stops, modes and languages for Settings |
| `GET` | `/api/maps/config` | What the browser may know about the Maps setup (referrer-restricted browser key, Directions availability) |
| `GET` | `/api/maps/network` | Routes, ordered stops, polyline geometry, measured load per stop, fleet positions and notices — one payload for the map layer |
| `GET` | `/api/maps/journey` | Geometry + crowd state for the corridors a planned journey can use (`origin`, `destination`, `departAfter`, `avoidCrowding`, `maxTransfers`) |
| `GET` | `/api/maps/directions` | Server-side Directions proxy (`origin=lat,lng`, `destination=lat,lng`, `mode`), road-snapped path; the Google key never leaves the API |
| `GET` | `/api/dataset/tables` | Every canonical table with live row counts and the requested-name mapping. Canonical names resolve through aliases — `stops` → `route_stops`, `vehicles` → `vehicle_snapshots`, `alerts` → `service_alerts`, `users` → `app_users` |
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

### 6.1 The system

* **Dark transportation-tech shell** — layered radial gradients, subtle grid, glass
  panels used only where depth communicates hierarchy.
* **One colour language** — green → yellow → orange → red crowd scale defined once
  in `shared/crowd.ts` and mirrored in `src/index.css` theme tokens.
* **Data visualisation without a chart library** — forecast chart, heatmap,
  scan curve, sparklines and hourly load profiles are hand-built SVG/CSS.
* **Motion with restraint** — one-shot rise-in on cards, a pulsing "live" dot,
  sweep on the analysing/apply states, hover/active feedback; the global
  `prefers-reduced-motion` block turns all of it off.
* **Typography** — Space Grotesk for display numerals, Inter for body, JetBrains
  Mono for times, ratios, IDs and table cells.

### 6.2 The refinement pass (round 7)

The whole interface was re-cut without touching behaviour, data flow or schema:

| Layer | What changed |
| --- | --- |
| **Tokens** (`src/index.css`) | The type ramp is explicit — `text-3xs` → `text-2xs` → `text-sm`/`text-md` → `text-display-sm/md/lg/xl` — together with `--shadow-panel`/`--shadow-lift` and the utilities used across the app: `eyebrow` (micro uppercase label), `figure` (monospace + tabular numerals, so every number in a column lines up), `hairline`, `inset-highlight`, `safe-bottom` and the glow helpers `glow-low/moderate/high`, `glow-pulse` and `text-glow`. Every colour in every component comes from a theme token — there is not one raw Tailwind palette class (`sky-400`, `violet-300`, …) left in `src/`, and no hard-coded `font-size` in `rem`; crowd indicators carry a restrained halo instead of a second colour. |
| **Primitives** (`src/components/ui/`) | Button (6 variants, 4 sizes, loading + `block` CTA, focus ring, active press), Card (+ `CardSection`/`CardFooter`, three surface weights), Badge (+ `StatusDot` with optional live ping), StatTile (count-up, delta chip, sparkline), new `Section.tsx` (`SectionHeading`, `Metric`, `InfoRow`), Controls (shared `Textarea`, keyboard-safe `Select`). |
| **States** | Skeletons now mirror the layout they replace — `StatGridSkeleton`, `TableSkeleton`, `ChartSkeleton`, `RouteCardSkeleton` — and empty/error states are one component: they say what happened and what to do next, always with a retry where a retry exists. |
| **Charts** | Forecast chart gained a legend, threshold band labels, vertical ticks, touch scrubbing, a halo cursor and a screen-reader summary; the heatmap gained `<title>` tooltips per corridor, hover read-out, unique gradient ids and an SR list of the busiest corridors. |
| **Navigation** | Sidebar regrouped into **Rider** / **Operations** with active rails; sticky header carries page context; mobile drawer traps focus by Escape and the tab bar is now four tabs + **More**. |
| **Accessibility** | Skip link, `:focus-visible` rings on every interactive element, real `<form>` submits (Enter works), `aria-pressed`/`aria-expanded`/`aria-selected` on toggles and pickers, `role="status"`/`role="alert"` on async feedback, labels on every icon-only control, `prefers-reduced-motion` respected. |

### 6.3 The maps layer (round 8)

| Piece | Where | What it does |
| --- | --- | --- |
| **SDK loader** | `src/lib/maps.ts` | Loads the real Maps JavaScript API once per page (build-time key, else the API's published browser key), handles `gm_authFailure`, a 12 s timeout and retry, and exposes the crowd palette, marker symbols and path styles the layer draws with. |
| **Canvas + layers** | `src/components/map/GoogleMapCanvas.tsx`, `layers.tsx` | A thin `google.maps.Map` wrapper (dark base style, bounds fitting, resize handling) plus declarative layers: corridors, stops, fleet markers, notices, journey legs. Popups are DOM-built — no injected HTML. |
| **Route/journey surfaces** | `JourneyMap.tsx`, `OperatorNetworkMap.tsx` | Rider: the selected itinerary emphasised over faint alternatives, with an opt-in *my location* marker. Operator: the whole network, click a corridor to focus the AI console on it. |
| **Honest fallback** | `MapFallback.tsx`, `SchematicNetworkMap.tsx` | Without a key (or after a failed load) the same geometry renders as a labelled schematic with the exact reason and the environment variable to set. |
| **Server side** | `server/{routes,services,repositories}/map*` | `/api/maps/*` assembles geometry from `route_stops`, load from `v_line_crowding_now`, forecasts from `occupancy_predictions` and positions from `vehicle_snapshots`; `fetchDirections` proxies Google with the server key (6 s timeout, 10 min cache). |

Crowd colour is always the three shared bands — `< 60 %` green, `60–85 %`
yellow, `> 85 %` red — and every map payload carries `simulated: true` plus a
disclaimer, so no screen can present the demo fleet as real tracking.

### 6.4 Checks

```bash
npx tsc --noEmit     # types
npm run build        # production bundle
npm run smoke        # renders all 8 routes headlessly and fails on console errors
npm run smoke:maps   # mocked Maps SDK: asserts the map + crowd layer really draw
npm run check:api    # endpoint sweep + dashboard figures traced back to the tables
npm run check:recovery   # both dashboards survive and recover from an API outage
npm run db:verify    # database checks (stop the API first — see the note in §1)
```

---

## 7. Demo script (3 minutes)

1. **Home** — read the headline *"Know the crowd before you board."*, then scroll to
   the **live network map**: real Google Maps with TransitPulse's crowd colours on
   the corridors and the simulated fleet on it (the panels say **SIMULATED DATA**
   and *Demo network — no live fleet feed*). Pick a saved journey chip (or
   `Tambaram` → `Tidel Park`) and press **Find Best Route**.
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
4. **Route details** — the itinerary on the map (click a leg for measured vs
   predicted occupancy, confidence and trend), then the occupancy prediction card (peak %, AI confidence, crowd
   trend up / down the line, score), then the leg-by-leg boarding plan with
   estimated arrivals, the forecast chart (measured history → predicted band), the
   model breakdown that shows *why*, and the alternative routes below.
5. **Prediction engine** — click the **Simulation Mode** badge: the five-stage
   pipeline, the crowd-classification table and the live simulator. Change the
   horizon to *+1 hour* or set the weather to *heavy rain* and watch the
   predicted occupancy, confidence and factor bars recompute — this is the screen
   that answers *"is the AI real?"*.
6. **Operator Command Center** — the control-room screen. Read the status bar
   (network state, clock, model version), then the four overview tiles. Point at
   the **crowd heatmap** and flip it from *Live load* to *+30 min* and *24 h peak*
   — the corridors recolour because the engine is predicting, not just reporting.
   Beside the map the rail carries **Network status**, the **AI alert** and the
   **AI action** for the focused corridor; below it the **AI alerts** list the
   routes the model expects to crowd (affected route, predicted occupancy, ETA,
   severity, recommended action), and **AI recommendations** propose the
   interventions with the numbers behind them —
   press **Dispatch** and the advisory is written into the `alerts` table.
   **Route analytics** closes the loop with measured → predicted trends.
   Now click a corridor on the map (or a row in the live table) — the map focuses
   that route and the **AI Decision console** opens with
   *AI Detected Congestion*: current occupancy, predicted occupancy, time to
   congestion and the engine's scan curve against the threshold. Read the three
   numbered actions (deploy a vehicle, redirect passengers, notify riders), then
   the **expected impact** bars: *without intervention* vs *with recommended
   intervention*, explicitly labelled a simulated projection. Press **Apply AI
   Recommendation** — the check animates, the console lists what changed (unit
   released, alert raised, ledger rows written) and the KPI tiles above move:
   active vehicles, idle units and open notices all shift because the database
   really changed.
7. **Alerts** — publish a crowding notice; it appears instantly for riders, and it
   lands in the `alerts` table (and in `service_alerts` after a dataset refresh).
8. **Database** — open the Data Explorer: real row counts, primary/foreign keys and
   records for `routes`, `route_stops`, `vehicle_snapshots`,
   `occupancy_predictions`, `route_options`, `service_alerts` and `app_users` —
   plus the AI intervention ledger (`ai_decisions`, `ai_decision_actions`) that
   grew when you pressed Apply — then press **Rebuild dataset** and show the
   counts recomputed from the model.
9. **Settings** — drag crowd tolerance down and re-plan: the planner penalises busy
   carriages harder.

---

## 8. Deliberate scope

This is an architecture-first prototype. The foundation (routing, database
integration, reusable components, real backend, explainable model) is complete;
these are intentionally left for the next iteration:

* **Authentication** — rider identity is a demo profile; Supabase Auth + the
  existing `auth_user_id` column and RLS policies are the intended path.
* **Live vehicle positions** — `vehicles.next_stop_id` and `vehicle_snapshots` are
  seeded; a GTFS-Realtime feed would replace the simulated fleet state. The map
  draws those rows and labels them as simulated — it never claims live tracking.
* **Google Maps keys** — the Maps JavaScript API needs a referrer-restricted
  browser key, which cannot live in the repository. Until one is supplied the map
  panel shows the labelled schematic; with a key, the same components draw on the
  real basemap with no code change.
* **Model training** — the shipped predictor is a transparent statistical
  ensemble rather than a trained network, which keeps the demo explainable and
  dependency-free. The `OccupancyPredictor` seam and `PREDICTION_MODEL_URL`
  adapter exist precisely so a trained model can replace it without touching the
  API, the database or the UI.
* **Dispatch automation** — *Dispatch* on the command centre publishes a real
  advisory into `alerts` (visible to riders immediately); actually assigning a
  spare vehicle is an operational system integration, not modelled here.
* **Push delivery** — notification preferences are stored and rendered; an actual
  push/email provider is out of scope.
* **Offline caching / PWA** — data is refetched on an interval instead.
