/**
 * Token compiler: figma/tokens/tokens.json (DTCG) becomes
 *   1. client/src/styles/tokens.css   → CSS custom properties (+ light mode block)
 *   2. figma/tokens/figma-variables.json → the exact JSON shape Figma's
 *      "Import from JSON" expects, with Dark + Light modes in one collection.
 *
 *   npm run tokens
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'figma', 'tokens', 'tokens.json');
const OUT_CSS = path.join(ROOT, 'client', 'src', 'styles', 'tokens.css');
const OUT_FIGMA = path.join(ROOT, 'figma', 'tokens', 'figma-variables.json');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/** Walk the DTCG tree into a flat { 'color/bg/base': token } map. */
function flatten(node, prefix = [], out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$') || key.startsWith('//')) continue;
    const nextPath = [...prefix, key];
    if (value && typeof value === 'object' && '$value' in value) out.set(nextPath.join('/'), value);
    else if (value && typeof value === 'object') flatten(value, nextPath, out);
  }
  return out;
}

const tokens = flatten(raw);
const lightExt = 'com.mise/light';

const cssValue = (token) => {
  const value = token.$value;
  switch (token.$type) {
    case 'color':
      return value.toUpperCase();
    case 'shadow':
      return `${value.offsetX} ${value.offsetY} ${value.blur} ${value.spread ?? '0px'} ${value.color}`;
    case 'cubicBezier':
      return `cubic-bezier(${value.join(', ')})`;
    case 'duration':
    case 'dimension':
      return String(value);
    case 'number':
    case 'fontFamily':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
};

const figmaValue = (token, variant) => {
  const value = variant === 'light' ? (token.$extensions?.[lightExt] ?? token.$value) : token.$value;
  switch (token.$type) {
    case 'color':
      return value;
    case 'dimension':
      return parseFloat(value);
    case 'duration':
      return parseFloat(value);
    case 'number':
      return value;
    case 'fontFamily':
      return String(value).split(',')[0].replace(/["']/g, '').trim();
    case 'cubicBezier':
      return JSON.stringify(value);
    case 'shadow':
      return JSON.stringify(value);
    default:
      return String(value);
  }
};

const FIGMA_TYPE = {
  color: 'COLOR',
  dimension: 'FLOAT',
  duration: 'FLOAT',
  number: 'FLOAT',
  fontFamily: 'STRING',
  cubicBezier: 'STRING',
  shadow: 'STRING',
};

const cssLines = [
  '/* GENERATED FILE — do not edit by hand.',
  ' * Source: figma/tokens/tokens.json  →  npm run tokens',
  ' */',
  ':root {',
];
const lightLines = ['[data-theme=' + "'light'" + '] {'];

for (const [name, token] of tokens) {
  const cssName = `--${name.replace(/\//g, '-')}`;
  const comment = token.$description ? ` /* ${token.$description} */` : '';
  cssLines.push(`  ${cssName}: ${cssValue(token)};${comment}`);
  if (token.$extensions?.[lightExt] && token.$type === 'color') {
    lightLines.push(`  ${cssName}: ${token.$extensions[lightExt].toUpperCase()};`);
  }
}
cssLines.push('}', '');
if (lightLines.length > 1) {
  lightLines.push('}', '');
}
cssLines.push(
  '/* Paired hex pairs used by recipe card gradients (kept in sync with the recipe data). */',
  ':root {',
  '  --card-gradient-angle: 145deg;',
  '  --hero-depth: 900px;',
  '}',
  ''
);

fs.mkdirSync(path.dirname(OUT_CSS), { recursive: true });
fs.writeFileSync(OUT_CSS, `${cssLines.join('\n')}\n${lightLines.join('\n')}`);

/* --------------------------- Figma variables file --------------------------- */
const variables = {};
const modes = { Dark: {}, Light: {} };
for (const [name, token] of tokens) {
  const figmaName = name.replace(/\//g, '/');
  variables[figmaName] = { type: FIGMA_TYPE[token.$type] ?? 'STRING', value: figmaValue(token, 'dark') };
  modes.Dark[figmaName] = figmaValue(token, 'dark');
  modes.Light[figmaName] = figmaValue(token, 'light');
  if (token.$description) variables[figmaName].description = token.$description;
}

const figmaDoc = {
  $comment:
    'Import into Figma: select the canvas → right-click → Variables → the "..." menu → Import from JSON. Two modes (Dark, Light) are created for colour tokens.',
  Mise: {
    modes,
    variables,
  },
};

fs.writeFileSync(OUT_FIGMA, `${JSON.stringify(figmaDoc, null, 2)}\n`);
console.log(`[tokens] ${tokens.size} tokens → ${path.relative(ROOT, OUT_CSS)} + ${path.relative(ROOT, OUT_FIGMA)}`);
