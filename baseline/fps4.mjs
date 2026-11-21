#!/usr/bin/env node
// Baseline manifold reduction: farthest-point sampling (FPS-4).
// Start from the polygon vertex farthest from the support centre of mass, then
// repeatedly add the vertex farthest from the already selected set. This is the
// common "spread the points out" heuristic; it has no containment guarantee.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  pointInConvex, analyzeScenario, supportCom, buildChain, footprint,
  clipConvex, toNumber, sub,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '..', 'data', 'scenarios.json'), 'utf8'));

function d2(a, b) {
  const dx = toNumber(sub(a.x, b.x)), dz = toNumber(sub(a.z, b.z));
  return dx * dx + dz * dz;
}

export function fps4(poly, com) {
  if (poly.length <= 4) return poly.map((p, i) => i);
  const idx = [];
  let first = 0, best = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = d2(poly[i], com);
    if (d > best) { best = d; first = i; }
  }
  idx.push(first);
  while (idx.length < 4) {
    let pick = -1, far = -1;
    for (let i = 0; i < poly.length; i++) {
      if (idx.includes(i)) continue;
      let near = Infinity;
      for (const j of idx) near = Math.min(near, d2(poly[i], poly[j]));
      if (near > far) { far = near; pick = i; }
    }
    idx.push(pick);
  }
  return idx.sort((a, b) => a - b);
}

let total = 0, inside = 0;
for (const sc of data.scenarios) {
  const res = analyzeScenario(sc);
  const { bodies, settled } = buildChain(sc);
  for (let i = 0; i + 1 < bodies.length; i++) {
    const poly = clipConvex(footprint(settled[i + 1], i + 1), footprint(settled[i], i));
    const com = supportCom(bodies, i + 1);
    const sel = fps4(poly, com);
    const quad = sel.map((k) => poly[k]);
    total++;
    if (pointInConvex(quad, com)) inside++;
  }
}
const rate = inside / total;
console.log(`fps4 containment ${inside}/${total} = ${(rate * 100).toFixed(2)}%`);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ method: 'fps4', total, inside, rate }));
}
