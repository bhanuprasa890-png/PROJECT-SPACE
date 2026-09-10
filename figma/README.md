# Mise — Figma UI/UX handoff kit

> **Read this first:** Figma is a design tool that runs in a browser with its own account, so the
> agent building this repo cannot click inside your Figma file. What it *can* do — and what is in
> this folder — is ship the exact artefacts you paste/import into Figma so the file and the code
> cannot drift: variables, a component inventory, screen specs, flow maps and pixel-true frames to
> trace over.

## 1. Import the design system in 40 seconds

1. Open (or create) your Figma file.
2. Select the page → **right-click → Variables** (the Local variables panel) → **`⋯` → Import from JSON**.
3. Choose [`tokens/figma-variables.json`](tokens/figma-variables.json).

You get one collection, **Mise**, with **78 variables** and **two modes: `Dark` and `Light`**.
Flip the mode switch in the variables panel to preview the light theme — the app does the same
thing with `data-theme="light"` on `<html>`.

| File | What it is |
| --- | --- |
| `tokens/tokens.json` | **Source of truth** (W3C Design Tokens / DTCG format). Edit here. |
| `tokens/figma-variables.json` | Generated — Figma Variables import (Dark + Light modes). |
| `../client/src/styles/tokens.css` | Generated — the same values as CSS custom properties. |
| `../scripts/gen-tokens.mjs` | The compiler that keeps both in sync. |

Change a colour? Edit `tokens/tokens.json`, run `npm run tokens`, import the JSON again in Figma.
Design and code stay identical by construction, which is the point of the exercise.

Naming convention (used everywhere: Figma variables, CSS, code):

```
color/<group>/<role>      size/space/<step>   size/radius/<name>
font/size/<name>          motion/duration/<name>   effect/shadow/<name>
```

## 2. Frames in `mockups/` — and how to get the real ones

The three JPGs here are **AI concept frames** used to agree on composition before code — they match
the shipped layout (split login with the 3D pot, five copilot cards = blade / torus-knot / flame /
globe / jar, recipe card grid). Their body text is AI gibberish, so treat them as mood and
composition only; the tokens and the running app are the truth.

| Concept frame | Screen it explores |
| --- | --- |
| `concept-login.jpg` | Log in — first screen, nothing else on it |
| `concept-home-cards.jpg` | Post-login: 3D hero, copilot cards, recipe cards |
| `concept-cook-mode.jpg` | Recipe steps, cue lines, timer, scaling |

For pixel-true frames to trace over, capture the running app (this sandbox has no browser, so the
repo intentionally ships no screenshot task):

```bash
npm run dev                      # http://localhost:5173
# then either use the browser (DevTools → capture), or:
npx --yes playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 \
    http://localhost:5173 figma/mockups/01-login.png
```

Behaviour is pinned by tests instead of pictures: `npm run test:client` asserts the login screen has
exactly one heading, that no card renders before a session, that the Google demo chooser lists the
three accounts, and that logout returns you to a logged-out app.

## 3. Screen map (information architecture)

The brief's hard rule — *login is the first page, not mixed in with the marketing headings* — is
implemented structurally, not visually: **while there is no session the router does not mount the
app at all**, and the API answers 401 for the cards. The login screen is therefore literally the
only thing that can render.

```
UNAUTHENTICATED                        AUTHENTICATED
┌──────────────────────┐               ┌────────────────────────────────────┐
│ /login               │               │ /  (kitchen)                       │
│  • brand mark         │   success →   │  • top bar (nav, 3D switch, user)  │
│  • "Log in" heading   │               │  • hero (WebGL pot + steam)        │
│  • Continue w/ Google │               │  • stats strip                     │
│  • email + password   │               │  • #copilots  → 5 × 3D cards       │
│  • "Create new        │               │  • #recipes   → recipe card grid   │
│    account" link      │   ← logout ←  │  • #pantry    → matcher + history  │
│  • demo credentials   │               │ /recipes/:id  → cook mode          │
│ No nav. No hero copy. │               │ /account      → sessions & security│
└──────────────────────┘               │ /logout       → explicit farewell   │
┌──────────────────────┐               └────────────────────────────────────┘
│ /create-account      │
│  • name/email/pw     │   every other path while signed out → /login
│  • live strength     │
│  • "Log in" link     │
└──────────────────────┘
```

Wording, per the brief: **Log in**, **Log out**, **Create new account** — the word "Sign" never
appears on a button (Google's own rendered button in live mode is the only exception, and it is
Google's UI, not ours).

## 4. Component inventory to build in Figma

| Component | Variants | Notes |
| --- | --- | --- |
| `Brand / Mark` | with-word, icon-only | 30/34/40 px, pot + lid glyph |
| `Field / Text` | default, error, filled, focus | 48 h, radius 14, label above, error below |
| `Field / Password` | hidden, revealed | eye toggle inside the field, right inset 6 |
| `Button / Primary` | default, hover, pressed, loading, disabled | saffron fill, text `color/text/inverted` |
| `Button / Ghost` | default, hover | 1 px `border/strong` |
| `Button / Danger` | default, hover | used only on logout paths |
| `Button / Google` | demo, live (GIS) | white #FFF, 1 px #DADCE0, 4-colour G, 48 h |
| `Google Sheet / Chooser` | list, passcode, error | Google chrome: white, 8 radius, Roboto-ish metrics |
| `Strength Meter` | score 0-4 | 4 bars, red ≤2, herb ≥3 |
| `Chip / Filter` | off, on | pill, 12 px text |
| `Top bar / Nav` | active, idle | 62 h, blurred background |
| `User chip + menu` | closed, open | avatar initials, "Log out" as last row |
| `Card / Copilot (3D)` | 5 characters | 132 px canvas stage, accent variable-driven |
| `Card / Recipe` | default, favourited, cooked | CSS 3D tilt 9°, lift 18 px |
| `Step row / Cook mode` | idle, active, done | 46 px numeral, cue line |
| `Timer` | idle, running, done | 168 ring, dash-offset progress |
| `Pantry matcher` | empty, results | 6 px match bar, "still need" line |
| `Notice` | error, ok, info | 14 radius, tinted background |
| `Empty / Boot` | — | dashed 22 radius, spinner ring |

Every colour on every component is a **variable**, never a literal, so the Dark/Light modes work.

## 5. Layout + spacing rules

* 12-col grid, 1240 max width, 24 px gutters (`size/space/5`); section rhythm `size/space/7` (48) / `size/space/8` (72).
* Login is a 2-column split ≥1080 px: 3D panel | 430 px form. Below that it stacks and the 3D panel becomes a 300 px band.
* Card grid: `auto-fill, minmax(300px, 1fr)`; copilot grid: `auto-fit, minmax(272px, 1fr)`.
* Type: `font/family/display` (Sora) for headings ≤ `-1.2px` tracking, Inter for text at 15/1.55.
* Radii: 8 / 14 / 22 / pill. Nothing else.

## 6. Motion spec (3D + micro-interactions)

| Moment | Spec | Token |
| --- | --- | --- |
| Card entry | y 30 → 0, rotateX -10 → 0, 500 ms, stagger 45 ms | `motion/easing/out` |
| Recipe hover | perspective 900, rotateX/Y ±9°, translateZ 18 px | `motion/parallax/card-tilt` |
| Copilot hover | rotateY ±10°, canvas rig leans to the pointer | `motion/duration/base` |
| Hero | flame flicker 6 Hz, steam instanced rise, orbiting ingredients | continuous, 30-60 fps |
| Google sheet | 380 ms y 14 → 0 + scale .985 → 1 | `motion/easing/out` |
| Timer done | pop 0.86 → 1.06 → 1, springy | `motion/easing/springy` |

Rules that the implementation actually enforces:

1. `prefers-reduced-motion: reduce` ⇒ **every canvas renders a static poster instead** and all
   transitions collapse to 0.001 ms.
2. A user-facing **3D on/off/auto** switch (top bar) persists to `localStorage`
   (`mise:3d`) so people on weak GPUs can turn WebGL off without touching OS settings.
3. Off-screen canvases are unmounted (IntersectionObserver) — five WebGL contexts is the ceiling.
4. Three.js is code-split (`three/lazy.jsx`); the login page never waits for it.

## 7. Accessibility gates (measured, not aspirational)

Measured with `npm run contrast` (it fails the build if a token change breaks one):

| Pair | Dark | Light |
| --- | --- | --- |
| `color/text/hi` on `color/bg/raise` | **17.54:1** | 18.49:1 |
| `color/text/mid` on `color/bg/raise` | **9.62:1** | 8.40:1 |
| `color/text/low` on `color/bg/raise` | **4.62:1** | — |
| link text `color/ink/accent` on `color/bg/raise` | **7.88:1** | 6.80:1 |
| primary button label `color/text/on-accent` on `color/accent/saffron` | **7.88:1** | 5.21:1 |

Note the last two rows: accent-as-**fill** and accent-as-**text** are different tokens
(`color/accent/saffron` vs `color/ink/accent`), because #E2600F on white is only 3.55:1 — the
first thing `npm run contrast` caught.
* Focus: 2 px `color/border/focus` ring with 3 px offset on every interactive element
  (`:focus-visible`), never removed.
* Targets ≥ 44 px (`size/control/tap-target`), password reveal is 36 + padding inside a 48 field.
* Form fields: real `<label for>`, `aria-invalid`, `aria-describedby` wiring for hint/error text,
  errors announced with `role="alert"`.
* Route change sets `document.title`; the Google sheet traps `Escape` and autofocuses the first row;
  a "Skip to content" link is the first tab stop.
* Colour is never the only signal — difficulty shows dots **and** a word, doneness shows a cue line.

## 8. What to change in Figma, in what order

1. Import `tokens/figma-variables.json`; create `Dark` / `Light` modes if they did not arrive.
2. Open the running app, capture the three screens, and trace the component set at those sizes.
3. Publish the component library; keep names 1:1 with the CSS classes (`.rcard`, `.copilot`,
   `.notice--error`) so engineers can grep them.
4. Any new token → add to `tokens/tokens.json`, run `npm run tokens`, re-import. Do not hand-edit
   `tokens.css` or `figma-variables.json` (both are generated).
