# Mise — Design & UX spec (v1)

 companion to [`README.md`](README.md) (Figma import instructions). This file is the *why*; the
 tokens file is the *what*; `client/src/` is the *how*.

---

## 0. Product in one line

**Mise is a cooking co-pilot:** it takes a recipe apart into steps you can actually follow, assigns
each step to a specialist, and tells you how to know when it is done — with a login-first,
zero-noise entry screen.

Target user: someone who cooks 3-5 dinners a week, knows the basics, and loses confidence at
*"fry until golden"* because nothing says when to stop.

## 1. Entry model — why login comes first

The brief is explicit: the log-in page is the first page and must not sit under a pile of marketing
headings. We implement that structurally so it cannot regress:

| Layer | Enforcement |
| --- | --- |
| Router (`client/src/App.jsx`) | While `status !== 'authed'` only `/login`, `/create-account` and `/logout` are mounted. Protected pages are **not rendered at all**, so nothing can leak a heading or a card. |
| API (`server/src/app.mjs`) | `app.use('/api', requireAuth, kitchenRouter)` — recipes, copilots, stats return `401 {code:'AUTH_REQUIRED'}` without a session. Gating is not cosmetic. |
| Entry title | `<title>Mise · Log in</title>` until the session resolves. |
| Test | `client/src/test/auth-first.test.jsx` asserts exactly one heading on the entry screen, no banner/nav, no card text, and that "sign up" never appears. |

What is deliberately *on* the login screen (and only these):
brand mark → `Log in` → Google button → email + password → `Log in` → `Create new account` link →
collapsible demo-credential panel. The left half is 3D art with one sentence, no headings.

## 2. Flows

### 2.1 Log in (Google demo)
```
tap "Continue with Google"
  → sheet (Google chrome, 3 seeded accounts)
  → pick account (passcode prefilled in demo mode)
  → POST /api/auth/google/demo { email, passcode }
     ├─ 200 → session cookie (httpOnly) + csrfToken → router swaps to /  → cards
     ├─ 401 passcode → inline red text *inside the sheet* (keeps context)
     └─ 429 → "too many attempts" (per-account lockout)
```
Live mode replaces the middle of this flow with `google.accounts.id` and
`POST /api/auth/google/credential`; the UI on both sides (sheet → session → cards) is identical,
because the same `startSession()` runs in the server either way.

### 2.2 Create new account
```
name / email / password / re-enter
  → live client policy (mirror of the server's, for feel only)
  → POST /api/auth/register
     ├─ 201 → session established immediately (no "check your email" dead end in a demo)
     ├─ 400 → field errors mapped back onto inputs (res.fields.email → Email field)
     └─ 409 → "already exists. Try logging in instead."
```
Password never round-trips back to the client in any response (asserted by
`server/test/auth-api.test.mjs › never returns hashes, tokens or internals`).

### 2.3 Log out
`/logout` is a **page**, not a one-line action: it calls `POST /api/auth/logout`, revokes the DB row
(a stolen/copy-pasted cookie therefore dies immediately), clears both cookies, lists what happened,
and offers `Log in again`. Visiting `/logout` while signed out shows the same confirmation rather
than an error.

### 2.4 After login — the cards
```
/  hero (WebGL pot + steam, pointer parallax)
   ├─ stats strip: recipes / favourites / cooks logged / copilots
   ├─ #copilots  → 5 cards, each its own WebGL scene
   ├─ #recipes   → filter chips + search + card grid (CSS 3D tilt)
   │     ├─ click card → /recipes/:id
   │     └─ ♥ → POST /api/recipes/:id/favorite → persists per user
   └─ #pantry    → "What can I cook?" matcher + recent cooks
/recipes/:id → cook mode: checklist, step cues, timer, ½×–3× scaling, "Finish & log"
/account      → profile, active sessions, revoke-others, security explainer
```

## 3. Screen specs

### 3.1 Log in — `LoginPage.jsx`
* Split at ≥1080 px: 3D panel (min 100 % height, `bg/sunken`) | 430 px form card.
* Card: `bg/raise` at 92 % opacity + `blur/glass`, radius 22, `shadow/card`.
* Order of attention: `Log in` (h1) → Google (white, the only high-contrast foreign brand on the
  page) → divider → email → password → primary CTA → `Create new account`.
* Demo credential panel: dashed 1 px `border/strong`, `bg/steam` at 8 %, click-to-fill, only
  rendered when the server says `demoAccounts` is non-empty (i.e. never in production).
* Errors: `role="alert"` notice above the fields **plus** per-field copy; typing clears both.
* Focus management: no autofocus on the first field (so the demo panel is readable first), `Tab`
  order is document order, `Escape` closes the Google sheet.

### 3.2 Create new account — `CreateAccountPage.jsx`
* Same shell, form gets a 5th field (re-enter password) and a 4-bar strength meter
  (`score 0-4`; red ≤2, herb ≥3) with the server's own rule list restated live.
* Submit stays disabled while `problems.length > 0` or the two fields disagree — the mismatch
  message appears *while typing*, not after a submit.
* Left panel is the only place with value copy (three bullets) — the form side stays clean.

### 3.3 Kitchen — `HomePage.jsx`
* Greeting is time-of-day + first name, no "Welcome to our platform!" boilerplate.
* Section rhythm: hero (72/48) → copilots → cards → pantry. One h1, one h2 per section.
* Filter chips are single-select for tags; the ≤20 min chip is a toggle, mirrored into the API
  query so filtering is server-side and shareable in the URL-shaped query string.
* The grid shows the first 8 matches and says how many more exist (a wall of 12 identical cards is
  a scrolling problem, not a discovery feature).

### 3.4 Recipe cards — `RecipeCard.jsx`
* Structure: 118 px gradient media (emoji + steam wash) → title → tagline → meta line (cuisine ·
  time · difficulty dots · kcal) → steps/servings + "Cook it →".
* 3D: `perspective(900px)`, ±9°/11° rotation, `translateZ(18px)` lift; children sit at
  `translateZ(10/16/24/28px)` so the card has real depth layers; a pointer-tracked radial sheen
  (`--mx/--my`) follows the cursor.
* Favourite is a 36 px button at the media's bottom-right with `aria-pressed`; the whole card is
  `role="link"`, `tabIndex=0`, activated by Enter/Space.
* Cooked state: pill badge over the media (herb `ink/ok`), never colour-only (it says "Cooked 12 Sep").

### 3.5 Copilot cards — `CopilotCard.jsx`
* 132 px WebGL stage over accent-tinted gradient, then name/role/blurb/strength chips/signature move.
* Mesh per character (see `three/copilotMeshes.jsx`): Sigma faceted blade + gyro rings, Manus
  kneading torus-knot with palms, Nova distort-plasma + flame licks + flickering point light,
  Atlas wireframe globe with orbital moons, Miso glass jar with rising bubbles.
* Each rig leans toward the pointer (`useFrame`, damped), so hovering feels like eye contact.
* Fallback poster = the emoji, so "3D off" costs nothing but motion.

### 3.6 Cook mode — `RecipePage.jsx`
* Two columns: steps (left, scrollable) | ingredients + timer + notes + lead copilot (right).
* Every step row: numeral or ✓, the instruction, copilot chip, minutes, and the **cue** line
  (`→ No shine on the surface`). The cue is the product's core promise: never guess.
* Active step is tinted + nudged 4 px; done steps fade to 0.6.
* Scaling rewrites the leading quantity of each ingredient (handles `1/2`, `0.25`) and the servings
  label; timers derive from the active step and tick against a timestamp (no drift).
* "Finish & log this cook" → `POST /api/recipes/:id/cooked` → back to the board with the badge.

### 3.7 Account & logout
* `/account` is also the security explainer: hash parameters, cookie attributes, rate limits, what
  is never stored client-side, plus the session table with "Revoke others".
* `/logout` confirms and returns. No destructive language, no "are you sure?" — logging out is
  reversible, so it should not read like a warning.

## 4. States every surface handles

| State | Treatment |
| --- | --- |
| checking session | `BootScreen` spinner; never a flash of protected UI |
| empty (filters) | dashed panel + the exact reason + how to fix it |
| error (API) | inline notice; card grid keeps its last good data |
| loading (list) | skeleton-free: counts update, no layout shift |
| success | button label swaps to a verb-confirmed state ("Copied ✓") then back |
| reduced motion | canvases never mount; transitions 0.001 ms |
| no WebGL | static poster via `Stage.jsx` probe |
| canvas crash | `CanvasBoundary` catches and shows the poster (never a white screen) |

## 5. Copy rules

* Buttons are verbs the user would say out loud: **Log in**, **Log out**, **Create new account**,
  **Finish & log this cook**. Never "Sign in", "Submit", "Continue" (Google's own rendered button is
  the sole exception — that is their UI in live mode).
* Voice: second person, concrete, no exclamation marks, measurements over adjectives
  ("until the garlic is straw-yellow", not "until fragrant").
* Errors state the fix, not the failure: "Too many failed attempts. Try again in 4 min." /
  "Demo passcode is not correct."

## 6. Non-goals (v1)

Shopping lists, social sharing, camera-based ingredient detection, password reset e-mail, and a
persisted per-user recipe editor. The DB schema already reserves `pantry` and `recipe_state`, so
those slots exist when they are wanted.

## 7. Known trade-offs (deliberate, not bugs)

1. **Login invalid-credentials message is generic** — no "this account uses Google" hint, to avoid
   account enumeration. Cost: Google-only users get "Email or password is not correct."
2. **Rate limiting + lockout are in-process** — one Map per Node process. Fine for a demo or a
   single container; move to Redis before scaling out.
3. **CSP allows `unsafe-inline` for scripts in dev** (Vite HMR needs it) and
   `frame-ancestors *` (the sandbox previews the app in an iframe). Tighten both to your origin in
   production; the header is assembled in one place, `server/src/http.mjs › securityHeaders`.
4. **Sessions are DB rows, not JWTs** — revocation is instant and a DB leak yields only hashes; the
   cost is one indexed lookup per request.
5. **Demo Google provider is password-gated but fake** — it exists so the flow can be demoed with no
   OAuth app; it is refused outright when `GOOGLE_MODE=live`, and vice versa.
