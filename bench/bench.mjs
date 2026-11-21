#!/usr/bin/env node
// Wall-clock benchmark: 7 timed samples of the full 6-chain analysis plus a
// separately recorded cold start. Writes bench/result.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeScenario, buildChain, footprint, clipConvex, supportCom, pointInConvex } from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { scenarios } = JSON.parse(readFileSync(join(root, 'data', 'scenarios.json'), 'utf8'));
const N = scenarios.length;

function runAll() {
  let interfaces = 0, contained = 0, area = 0;
  for (const sc of scenarios) {
    const r = analyzeScenario(sc);
    interfaces += r.interfaces.length;
    contained += r.interfaces.filter((it) => it.contains).length;
    for (const it of r.interfaces) area += Number(it.area.n) / Number(it.area.d);
  }
  return { interfaces, contained, area };
}

const t0 = process.hrtime.bigint();
const cold = runAll();
const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;

function runTruncate() {
  let inside = 0, total = 0;
  for (const sc of scenarios) {
    const { bodies, settled } = buildChain(sc);
    for (let i = 0; i + 1 < bodies.length; i++) {
      const poly = clipConvex(footprint(settled[i + 1], i + 1), footprint(settled[i], i));
      const com = supportCom(bodies, i + 1);
      const quad = poly.slice(0, 4);
      total++;
      if (quad.length === 4 && pointInConvex(quad, com)) inside++;
    }
  }
  return { total, inside };
}
const bt = process.hrtime.bigint();
runTruncate();
const truncateColdMs = Number(process.hrtime.bigint() - bt) / 1e6;
runAll(); // warmup
const samples = [];
for (let i = 0; i < 7; i++) {
  const t = process.hrtime.bigint();
  runAll();
  samples.push(Number(process.hrtime.bigint() - t) / 1e6);
}
const baseSamples = [];
for (let i = 0; i < 7; i++) {
  const t = process.hrtime.bigint();
  runTruncate();
  baseSamples.push(Number(process.hrtime.bigint() - t) / 1e6);
}
const baseSorted = [...baseSamples].sort((a, b) => a - b);
const sorted = [...samples].sort((a, b) => a - b);
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

const result = {
  measuredAt: new Date().toISOString(),
  corpus: { scenarios: N, interfacesPerRound: cold.interfaces, manifoldsAllRounds: cold.interfaces * 6 },
  coldStartMs: +coldMs.toFixed(3),
  samples: samples.map((v) => +v.toFixed(3)),
  stats: {
    n: samples.length,
    min: +sorted[0].toFixed(3),
    median: +pct(0.5).toFixed(3),
    p95: +pct(0.95).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
    mean: +mean.toFixed(3),
    stddev: +stddev.toFixed(3),
    relStddev: +(stddev / mean).toFixed(4),
    perManifoldUs: +((pct(0.5) * 1000) / cold.interfaces).toFixed(2),
  },
  checks: {
    containment: cold.contained / cold.interfaces,
    interfaceCount: cold.interfaces,
    areaSumFloat: +cold.area.toFixed(6),
  },
  baseline: {
    method: 'truncate4 (first four clipped vertices)',
    coldStartMs: +truncateColdMs.toFixed(3),
    medianMs: +baseSorted[3].toFixed(3),
    samples: baseSamples.map((v) => +v.toFixed(3)),
    containment: runTruncate().inside / 138,
  },
  note: 'Wall clock on a shared 4-core box; coldStart is the first uncached run. Per-manifold time divides the median by the 138 interfaces of one round.',
};
writeFileSync(join(here, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
