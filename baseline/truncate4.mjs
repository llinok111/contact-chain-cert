#!/usr/bin/env node
// Baseline reduction: keep the first four clipped vertices (declaration order).
// This is the cheap truncation a cache would do without a stability test; it has
// no containment guarantee on octagonal contacts. Run: node baseline/truncate4.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildChain, footprint, clipConvex, supportCom, pointInConvex } from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '..', 'data', 'scenarios.json'), 'utf8'));

let total = 0, inside = 0, octagons = 0, over = 0;
for (const sc of data.scenarios) {
  const { bodies, settled } = buildChain(sc);
  for (let i = 0; i + 1 < bodies.length; i++) {
    const poly = clipConvex(footprint(settled[i + 1], i + 1), footprint(settled[i], i));
    const com = supportCom(bodies, i + 1);
    const quad = poly.slice(0, 4);
    total++;
    if (poly.length > 4) octagons++;
    if (quad.length === 4 && pointInConvex(quad, com)) inside++; else over++;
  }
}
const rate = inside / total;
console.log(`truncate4 containment ${inside}/${total} = ${(rate * 100).toFixed(2)}% (octagons ${octagons}, outside ${over})`);
console.log(JSON.stringify({ method: 'truncate4', total, inside, octagons, outside: over, rate }));
