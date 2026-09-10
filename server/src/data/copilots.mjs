/**
 * The 3D "kitchen crew" — AI copilot cards. Each `mesh` maps to a geometry in
 * client/src/three/copilotMeshes.jsx (Sigma = faceted blade, Manus = kneading
 * torus-knot, Nova = flame/plasma, Atlas = spice-orbit globe, Miso = ferment
 * bubbles). Content lives on the server so the UI has one source of truth.
 */
export const copilots = [
  {
    id: 'sigma',
    name: 'Sigma',
    role: 'Prep & knife skills',
    blurb:
      'Breaks any recipe into a mise-en-place checklist, sizes your cuts, and keeps the board sequenced so nothing overcooks while you chop.',
    mesh: 'sigma',
    accent: '#FF8A3D',
    strengths: ['Cut sizing', 'Batch order', 'Yield maths', 'Board timing'],
    signatureMove: 'Reads your ingredient list and outputs a chopping order that saves ~9 minutes.',
    stat: '9 min saved / cook',
  },
  {
    id: 'manus',
    name: 'Manus',
    role: 'Hands-on technique',
    blurb:
      'Kneading, folding, tempering, emulsions — Manus runs the tactile steps and tells you exactly what the dough or sauce should feel like.',
    mesh: 'manus',
    accent: '#7ED9A6',
    strengths: ['Dough hydration', 'Tempering', 'Emulsions', 'Rest times'],
    signatureMove: 'Window-pane test countdown for bread, with a hydration calculator.',
    stat: '3 techniques / day',
  },
  {
    id: 'nova',
    name: 'Nova',
    role: 'Heat & timing',
    blurb:
      'Pan temperature, sear windows, oil smoke points, carryover cooking. Nova calls the flame so your protein lands medium-rare on the first try.',
    mesh: 'nova',
    accent: '#FF4D5E',
    strengths: ['Sear windows', 'Smoke points', 'Carryover', 'Oven conversions'],
    signatureMove: 'Live sear timer with a flip cue and resting countdown.',
    stat: '±2°C target accuracy',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    role: 'Flavour & substitutions',
    blurb:
      'Traces spice routes across cuisines, swaps what you are missing, and warns when a substitution will change the dish rather than save it.',
    mesh: 'atlas',
    accent: '#7CC5F7',
    strengths: ['Substitutions', 'Spice balance', 'Regional variants', 'Pairings'],
    signatureMove: 'One-missing-ingredient rescue with a taste-impact score.',
    stat: '1.4k pairings mapped',
  },
  {
    id: 'miso',
    name: 'Miso',
    role: 'Ferments & make-ahead',
    blurb:
      'Slow-food supervisor: pastes, brines, yoghurt, stocks. Miso schedules the day-ahead work so dinner is assembly, not a race.',
    mesh: 'miso',
    accent: '#C9A2FF',
    strengths: ['Brine %', 'Paste shelf life', 'Stock yield', 'Batch scaling'],
    signatureMove: 'Builds a two-day plan for a weeknight dal with zero waiting.',
    stat: '7 ferments tracked',
  },
];

export const copilotById = new Map(copilots.map((c) => [c.id, c]));
