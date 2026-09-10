/**
 * Contrast gate: every colour pair the design spec claims is checked here with
 * the WCAG 2.1 relative-luminance formula. `npm run contrast` fails the build
 * if a token change drops a pair under its target ratio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'figma/tokens/tokens.json'), 'utf8'));

function flatten(node, prefix = [], out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const next = [...prefix, key];
    if (value && typeof value === 'object' && '$value' in value) out.set(next.join('/'), value);
    else if (value && typeof value === 'object') flatten(value, next, out);
  }
  return out;
}
const map = flatten(tokens);

const hex = (name, mode = 'dark') => {
  const token = map.get(name);
  if (!token) throw new Error(`Unknown token: ${name}`);
  const value = mode === 'light' ? (token.$extensions?.['com.mise/light'] ?? token.$value) : token.$value;
  return String(value).toUpperCase();
};

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function luminance(color) {
  const hexValue = color.replace('#', '');
  const full = hexValue.length === 3 ? hexValue.split('').map((c) => c + c).join('') : hexValue.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** [label, fg token, bg token, mode, minimum ratio] */
const PAIRS = [
  ['body text on card', 'color/text/hi', 'color/bg/raise', 'dark', 4.5],
  ['secondary text on card', 'color/text/mid', 'color/bg/raise', 'dark', 4.5],
  ['meta text on card', 'color/text/low', 'color/bg/raise', 'dark', 4.5],
  ['body text on page', 'color/text/hi', 'color/bg/base', 'dark', 4.5],
  ['link text (accent ink)', 'color/ink/accent', 'color/bg/raise', 'dark', 4.5],
  ['error text', 'color/ink/danger', 'color/bg/raise', 'dark', 4.5],
  ['success text', 'color/ink/ok', 'color/bg/raise', 'dark', 4.5],
  ['primary button label', 'color/text/on-accent', 'color/accent/saffron', 'dark', 4.5],
  ['body text on card', 'color/text/hi', 'color/bg/raise', 'light', 4.5],
  ['secondary text on card', 'color/text/mid', 'color/bg/raise', 'light', 4.5],
  ['link text (accent ink)', 'color/ink/accent', 'color/bg/raise', 'light', 4.5],
  ['primary button label', 'color/text/on-accent', 'color/accent/saffron', 'light', 4.5],
  ['focus ring on card', 'color/border/focus', 'color/bg/raise', 'dark', 3],
  ['large heading on page', 'color/text/hi', 'color/bg/sunken', 'dark', 3],
];

let failures = 0;
const rows = PAIRS.map(([label, fg, bg, mode, min]) => {
  const value = ratio(hex(fg, mode), hex(bg, mode));
  const ok = value >= min;
  if (!ok) failures += 1;
  return { label: `${label} · ${mode}`, fg: hex(fg, mode), bg: hex(bg, mode), value: Number(value.toFixed(2)), min, ok };
});

const width = Math.max(...rows.map((r) => r.label.length));
console.log('\n\x1b[1mWCAG contrast audit\x1b[0m (AA minimum per pair)\n');
for (const row of rows) {
  const mark = row.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(` ${mark} ${row.label.padEnd(width)}  ${row.fg} on ${row.bg}  ${String(row.value).padStart(5)}:1  (min ${row.min})`);
}
console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${rows.length - failures}/${rows.length} pairs pass\x1b[0m\n`);
if (failures) process.exit(1);
