# Mise — kitchen co-pilot

A cooking web app: log in first, then a board of recipe cards and five **3D** AI copilots
(Sigma · Manus · Nova · Atlas · Miso) that each own one part of the cook. Every step carries a
*"how do I know it's ready"* cue, a timer, and a pantry matcher that decides dinner from what you
have.

```
React 19 · Vite 7 · Three.js via @react-three/fiber + drei · framer-motion
Express 4 · node:sqlite (zero native deps) · scrypt · httpOnly session cookies · CSRF
Figma handoff kit in figma/ (design tokens → variables import)
```

---

## Quick start

```bash
npm install
npm run dev          # web http://localhost:5173  ·  api http://localhost:8787 (proxied at /api)
```

Open the URL: you land on the **log-in page** and nothing else. Sign in with any demo account below.

```bash
npm test             # 55 server tests (auth, sessions, CSRF, gating, content)
npm run test:client  # 20 DOM tests (login-first, Google sheet, cards, cook mode)
npm run smoke        # end-to-end journey against a running server
npm run contrast     # WCAG audit of every colour pair
npm run tokens       # regenerate tokens.css + figma/tokens/figma-variables.json
npm run build && npm start   # single-process production build
```

## Demo accounts (sandbox only)

| How you log in | Account | Secret |
| --- | --- | --- |
| **Continue with Google** → pick an account | `priya.nair@gmail.com` — Priya Nair | passcode `MiseDemo#2026` |
| | `arjun.mehta@gmail.com` — Arjun Mehta | passcode `MiseDemo#2026` |
| | `sana.cooks@gmail.com` — Sana Qureshi | passcode `MiseDemo#2026` |
| **Email + password** | `chef@mise.dev` | password `MiseDemo#2026` |

`Create new account` works too — it creates a real row and signs you straight in.

These are seeded fixtures, not real Google accounts, and they only exist when
`SHOW_DEMO_CREDENTIALS` is on (default: development/test). In production `/api/auth/config` returns
`demoAccounts: []` and the demo provider refuses to start once a real client id is configured.

### Turning Google demo into real Google

```bash
# .env
GOOGLE_MODE=live
GOOGLE_OAUTH_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com   # Web client, origin in "Authorized JavaScript origins"
```

Live mode renders Google's own `accounts.id` button and verifies the returned ID token on the
server: RS256 against Google's JWKS, then `iss`, `aud`, `exp`, `nbf`, one-time `nonce`, and
`email_verified`. Demo and live share the same session code path, so nothing else changes.

---

## The authentication, specifically

**Passwords** — `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random salt), stored as
`scrypt$v1$N$r$p$salt$hash` so cost parameters can be raised without invalidating old hashes.
Comparisons are constant-time. Policy: ≥10 chars, two character classes, no email/name reuse, no
common-password list, no repeat-only or DOB patterns.

**Sessions** — 32 random bytes token + separate session id, cookie value `token.sessionId`.
The DB stores **only** `sha256(token)`, so a database leak yields no usable cookie. `HttpOnly`,
`SameSite=Lax`, `Secure` whenever the request isn't plain-HTTP localhost, 14-day sliding expiry,
rotation on every login, max 5 live sessions per user, instant revocation on logout
(`sessions`, `auth_events` tables).

**CSRF** — double-submit: a readable `mise_csrf` token *derived from the session id by HMAC* and
required as `X-CSRF-Token` on every mutating request. A leaked token for session A can't be used as
session B's.

**Brute force** — per-IP sliding window (12/min on auth routes) *plus* per-email lockout
(5 failures → 15 min pause, enforced across IPs). Failed logins never say whether the email exists;
`auth_events` keeps an audit trail.

**Client-side storage** — nothing sensitive. `localStorage` holds only UI prefs
(`mise:3d`, `mise:theme`) and the remembered email for convenience. No tokens, no user objects.

**No secrets in the repo** — `SESSION_SECRET` comes from the environment; production refuses to boot
without one ≥32 chars. In dev a secret is generated into gitignored `server/.dev/` so restarts don't
log you out. `.env` is ignored; `.env.example` documents every knob.

Server-enforced gating: `app.use('/api', requireAuth, kitchenRouter)` — the cards, copilots and
stats do not exist for an anonymous visitor, so "login first" is not a CSS trick.

---

## 3D and animation

* **Hero** (`client/src/three/KitchenHeroScene.jsx`) — procedural pot with a glowing saffron rim,
  simmering `MeshDistortMaterial` surface, 7 flickering burner flames, 26 instanced steam puffs,
  five orbiting ingredients, a floating knife on a rounded board, contact shadow, and a
  procedurally-built environment (drei `Lightformer`s) for the metal reflections. No GLTF/HDRI
  downloads → it loads instantly and works offline.
* **Copilot cards** — one WebGL scene per character (`three/copilotMeshes.jsx`), each with its own
  motion signature: Sigma faceted blade + gyro rings, Manus kneading torus-knot, Nova plasma with
  flame licks and a flickering light, Atlas wireframe globe with orbital moons, Miso jar with rising
  fermentation bubbles. Every rig leans toward the pointer.
* **Recipe cards** — real CSS 3D (perspective 900, ±9° tilt, layered `translateZ` depths,
  pointer-tracked sheen). Twelve WebGL canvases would torch the GPU; layered parallax per card is
  the better trade.
* **Guarantees** — a `3D: auto/on/off` switch in the top bar (persisted), `prefers-reduced-motion`
  honoured, WebGL probed before mounting, an error boundary around every canvas, off-screen canvases
  unmounted, and three.js split into a lazy chunk so the login page never waits for it
  (entry ≈ 60 kB app code; the ~900 kB WebGL chunk is async-only).

---

## Figma (UI/UX)

`figma/` is the handoff kit — see [`figma/README.md`](figma/README.md) for import steps and
[`figma/DESIGN_SPEC.md`](figma/DESIGN_SPEC.md) for flows, screens, states, copy and motion rules.

* `figma/tokens/tokens.json` — DTCG source of truth (82 tokens, dark + light).
* `figma/tokens/figma-variables.json` — **import this in Figma** (Variables → Import from JSON): one
  `Mise` collection, two modes, all variables.
* `client/src/styles/tokens.css` — generated from the same file, so design and code can't drift.
* `figma/mockups/concept-*.jpg` — AI concept frames used to settle composition.

> Honest limitation: Figma is a hosted GUI tool, so nothing here clicks inside your Figma file. What
> ships is the artefact Figma consumes (variables JSON + spec + frames), generated from the code.

---

## Layout

```
server/src/
  config.mjs       env, secret policy, demo/live Google mode        crypto.mjs    scrypt, CSRF, password policy
  db.mjs           node:sqlite schema + transactions                sessions.mjs  create/read/revoke, rotation
  http.mjs         cookies, security headers, rate limit, lockout    google.mjs    JWKS verify + demo provider
  seed.mjs         demo accounts (idempotent)
  routes/auth.mjs  register/login/logout/me/nonce/google/sessions    routes/kitchen.mjs  recipes, copilots, stats, favourites
  data/            recipes.mjs (12), copilots.mjs (5)
client/src/
  App.jsx          login-first router            auth/AuthProvider.jsx   session state machine
  lib/api.js       CSRF-aware fetch wrapper       lib/useAsync.js
  pages/           LoginPage · CreateAccountPage · HomePage · RecipePage · AccountPage · LogoutPage
  components/      TopBar · GoogleSheet · Field · RecipeCard · CopilotCard · Timer · PantryMatcher · BrandMark
  three/           Stage.jsx (lazy gate) · CanvasGate · KitchenHeroScene · copilotMeshes · sceneUtils
figma/             README · DESIGN_SPEC · tokens/ · mockups/
scripts/           dev.mjs (runs both) · gen-tokens.mjs · contrast.mjs · smoke.mjs
```

## Data model

```
users(id, email UNIQUE, name, avatar_url, provider['google'|'password'], google_sub UNIQUE,
      password_hash, demo_code_hash, created_at, last_login_at)
sessions(id PK, user_id FK, token_hash UNIQUE, created_at, last_seen_at, expires_at, user_agent, ip)
auth_events(id, kind, email, ok, reason, ip, created_at)
recipe_state(user_id, recipe_id, favorite, cooked_at, updated_at)   -- per-user favourites + history
pantry(user_id, ingredient, added_at)
```

SQLite lives in `server/.dev/mise.db` (gitignored). Delete that folder for a clean slate;
`npm run seed` re-arms the demo passcodes (`DEMO_PASSCODE` env).

## Deploy checklist

1. `NODE_ENV=production`, `SESSION_SECRET` (32+ chars), `COOKIE_SECURE` stays on automatically behind HTTPS.
2. `GOOGLE_MODE=live` + `GOOGLE_OAUTH_CLIENT_ID`, and add the origin in Google Cloud Console.
3. `SHOW_DEMO_CREDENTIALS=false` and drop the demo accounts from the DB.
4. Narrow CSP: kill `'unsafe-inline'` (script-src) and set `frame-ancestors 'self'` unless you need framing.
5. Put rate limiting + lockout in Redis if you run more than one process.
6. `npm run build && npm start` (Express serves `client/dist` and the SPA fallback), or serve `dist/`
   from a CDN and keep the API on its own origin with `PUBLIC_ORIGIN`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `SESSION_SECRET is missing…` | Production boot guard. Set it, or use `npm run dev`. |
| `Demo Google sign-in is disabled` | `GOOGLE_MODE=live` is set — use the real button, or unset it. |
| 403 "CSRF check failed" | Cookies were cleared mid-session; reload the page. |
| 429 "Too many requests" | Sliding-window limiter; wait a minute (or raise `RATE_LIMIT_MAX`). |
| No 3D, just posters | WebGL blocked or `prefers-reduced-motion`. Flip `3D` in the top bar to `on`. |
| Vite refuses the preview host | `client/vite.config.js › server.allowedHosts` must include it (`true` here). |
