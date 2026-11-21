#!/usr/bin/env node
// Deterministic sample generator: 6 multi-body chains, 24 bodies each.
// All lengths are exact rationals with denominator 1000; yaw pairs are
// Pythagorean (c^2 + s^2 = 1) so footprints stay rational after rotation.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fr, fstr, add, analyzeScenario, perturbScenario, signatureOf, featureJaccard,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data');

let state = 0x5eed1234;
function rnd() { state = (state * 1664525 + 1013904223) >>> 0; return state; }
function pick(n) { return rnd() % n; }
function r1000(lo, hi) { return fr(BigInt(lo + pick(hi - lo + 1)), 1000n); }

const YAWS = [
  [fr(1n), fr(0n)],
  [fr(3n, 5n), fr(4n, 5n)],
  [fr(5n, 13n), fr(12n, 13n)],
];

function makeScenario(id, rotated, seedShift) {
  state = (0x5eed1234 + seedShift) >>> 0;
  const bodies = [];
  let cx = fr(0n), cz = fr(0n);
  for (let i = 0; i < 24; i++) {
    const dx = i === 0 ? fr(0n) : fr(BigInt((i % 2 ? 1 : -1) * (20 + pick(41))), 1000n);
    const dz = i === 0 ? fr(0n) : fr(BigInt((i % 2 ? -1 : 1) * (15 + pick(36))), 1000n);
    cx = add(cx, dx); cz = add(cz, dz);
    const yaw = rotated ? YAWS[1 + pick(2)] : YAWS[0];
    bodies.push({
      cx: fstr(cx), cz: fstr(cz),
      hx: fstr(r1000(900, 1400)), hz: fstr(r1000(800, 1200)),
      h: fstr(r1000(400, 900)),
      c: fstr(yaw[0]), s: fstr(yaw[1]),
      seat: fstr(r1000(2, 8)),
    });
  }
  return { id, baseY: '0', bodies };
}

const scenarios = [];
for (let k = 0; k < 6; k++) scenarios.push(makeScenario(`chain-${k}`, k >= 2, k * 7919));

const ROUNDS = 6;
const reference = { rounds: ROUNDS, scenarios: [], totals: {} };
let totalInterfaces = 0, contained = 0, jaccardSum = 0, jaccardN = 0, jaccardMin = 1;
let areaSum = fr(0n);
for (const sc of scenarios) {
  const base = analyzeScenario(sc);
  totalInterfaces += base.interfaces.length;
  contained += base.interfaces.filter((it) => it.contains).length;
  for (const it of base.interfaces) areaSum = add(areaSum, it.area);
  let prev = base.interfaces.map((it) => it.featureIds.join(','));
  let scMin = 1, scSum = 0;
  for (let r = 1; r < ROUNDS; r++) {
    const res = analyzeScenario(perturbScenario(sc, r));
    const cur = res.interfaces.map((it) => it.featureIds.join(','));
    const j = cur.map((v, i) => featureJaccard(prev[i].split(',').filter(Boolean), v.split(',').filter(Boolean)));
    const mean = j.reduce((a, b) => a + b, 0) / j.length;
    scMin = Math.min(scMin, ...j); scSum += mean;
    prev = cur;
  }
  const meanJ = scSum / (ROUNDS - 1);
  jaccardSum += meanJ; jaccardN++; jaccardMin = Math.min(jaccardMin, scMin);
  reference.scenarios.push({
    id: sc.id,
    bodies: sc.bodies.length,
    interfaces: base.interfaces.length,
    containment: base.interfaces.filter((it) => it.contains).length / base.interfaces.length,
    areaSum: fstr(base.interfaces.reduce((a, it) => add(a, it.area), fr(0n))),
    signature: signatureOf(base),
    featureJaccardMean: meanJ,
    featureJaccardMin: scMin,
  });
}
reference.totals = {
  scenarios: scenarios.length,
  bodies: scenarios.reduce((a, s) => a + s.bodies.length, 0),
  interfacesPerRound: totalInterfaces,
  manifolds: totalInterfaces * ROUNDS,
  containment: contained / totalInterfaces,
  featureJaccardMean: jaccardSum / jaccardN,
  featureJaccardMin: jaccardMin,
  areaSum: fstr(areaSum),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'scenarios.json'), JSON.stringify({ scenarios }, null, 1) + '\n');
writeFileSync(join(outDir, 'reference.json'), JSON.stringify(reference, null, 1) + '\n');

console.log(`scenarios=${scenarios.length} bodies=${reference.totals.bodies} interfaces/round=${totalInterfaces} manifolds=${reference.totals.manifolds}`);
console.log(`containment=${reference.totals.containment.toFixed(6)} featureJaccard mean=${reference.totals.featureJaccardMean.toFixed(6)} min=${reference.totals.featureJaccardMin.toFixed(6)}`);
console.log(`areaSum=${reference.totals.areaSum}`);
