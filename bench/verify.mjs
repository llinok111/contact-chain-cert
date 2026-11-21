#!/usr/bin/env node
// Assertions for the exact multi-body contact-manifold certificate.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fr, fstr, add, sub, mul, div, cmp, eq, sgn, gcd, toNumber, fparse, buildChain,
  footprint, clipConvex, supportCom, analyzeScenario, perturbScenario, scaleScenario,
  signatureOf, polygonArea, polygonCentroid, pointInConvex, cross, len2, featureJaccard,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const data = JSON.parse(readFileSync(join(root, 'data', 'scenarios.json'), 'utf8'));
const ref = JSON.parse(readFileSync(join(root, 'data', 'reference.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name}: ${detail}`); }
  else { fail++; console.log(`FAIL ${name}: ${detail}`); }
}

// ---- 1. corpus shape -------------------------------------------------------
const scenarios = data.scenarios;
const totalBodies = scenarios.reduce((a, s) => a + s.bodies.length, 0);
check('A1 corpus', scenarios.length === 6 && totalBodies === 144, `scenarios=${scenarios.length} bodies=${totalBodies}`);

const results = scenarios.map((s) => analyzeScenario(s));
const ifaces = results.flatMap((r) => r.interfaces);
check('A2 interfaces', ifaces.length === 138 && results.every((r) => r.interfaces.length === 23),
  `interfaces=${ifaces.length} perScenario=${results.map((r) => r.interfaces.length).join(',')}`);

// ---- 2. seating correction ------------------------------------------------
const { bodies, raw, settled } = buildChain(scenarios[0]);
const rawOverlaps = [];
for (let i = 0; i + 1 < raw.length; i++) rawOverlaps.push(sub(raw[i + 1].y0, raw[i].y1));
const rawAll = rawOverlaps.every((v) => sgn(v) < 0);
check('A3 raw interference', rawAll, `all ${rawOverlaps.length} interfaces overlap before correction; first=${fstr(rawOverlaps[0])}`);
const gaps = ifaces.map((it) => it.gap);
check('A4 settled gap exactly 0', gaps.every((g) => eq(g, fr(0n))),
  `${gaps.filter((g) => eq(g, fr(0n))).length}/${gaps.length} exactly zero`);

// ---- 3. contact polygons --------------------------------------------------
const vcounts = ifaces.map((it) => it.vertexCount);
check('A5 polygon vertices', ifaces.every((it) => it.vertexCount >= 3 && it.vertexCount <= 8),
  `min=${Math.min(...vcounts)} max=${Math.max(...vcounts)} octagons=${vcounts.filter((v) => v === 8).length}`);
check('A6 positive area', ifaces.every((it) => sgn(it.area) > 0),
  `minArea=${fstr(ifaces.reduce((a, it) => (cmp(it.area, a) < 0 ? it.area : a), ifaces[0].area))}`);

// ---- 4. containment certificate ------------------------------------------
const insideCount = ifaces.filter((it) => it.contains).length;
check('A7 CoM containment', insideCount === ifaces.length, `${insideCount}/${ifaces.length} exact (strict edge margin)`);
const margins = ifaces.map((it) => it.margin);
check('A8 positive margin', margins.every((m) => Number.isFinite(m) && m > 0),
  `min=${Math.min(...margins).toFixed(6)} median=${[...margins].sort((a, b) => a - b)[69].toFixed(6)}`);

// ---- 5. baseline ----------------------------------------------------------
const baseOut = execFileSync(process.execPath, [join(root, 'baseline', 'truncate4.mjs')], { encoding: 'utf8' });
const base = JSON.parse(baseOut.trim().split('\n').pop());
check('A9 truncate baseline', base.total === 138 && base.inside === 66 && base.rate < 0.5,
  `truncate4 ${base.inside}/${base.total} = ${(base.rate * 100).toFixed(2)}% vs certificate 100%`);

// ---- 6. axis-aligned closed form -----------------------------------------
function rectBounds(poly) {
  let xmin = poly[0].x, xmax = poly[0].x, zmin = poly[0].z, zmax = poly[0].z;
  for (const p of poly) {
    if (cmp(p.x, xmin) < 0) xmin = p.x; if (cmp(p.x, xmax) > 0) xmax = p.x;
    if (cmp(p.z, zmin) < 0) zmin = p.z; if (cmp(p.z, zmax) > 0) zmax = p.z;
  }
  return { xmin, xmax, zmin, zmax };
}
let aaChecked = 0, aaOk = 0;
for (let s = 0; s < 2; s++) {
  const { bodies: bs, settled: st } = buildChain(scenarios[s]);
  for (let i = 0; i + 1 < bs.length; i++) {
    const poly = clipConvex(footprint(st[i + 1], i + 1), footprint(st[i], i));
    const a = rectBounds(footprint(st[i], i)), b = rectBounds(footprint(st[i + 1], i + 1));
    const w = sub((cmp(a.xmax, b.xmax) < 0 ? a.xmax : b.xmax), (cmp(a.xmin, b.xmin) > 0 ? a.xmin : b.xmin));
    const h = sub((cmp(a.zmax, b.zmax) < 0 ? a.zmax : b.zmax), (cmp(a.zmin, b.zmin) > 0 ? a.zmin : b.zmin));
    const expected = mul(w, h);
    aaChecked++;
    if (eq(expected, polygonArea(poly))) aaOk++;
  }
}
check('A10 axis-aligned closed form', aaChecked === 46 && aaOk === 46, `${aaOk}/${aaChecked} exact rectangle-intersection areas`);

// ---- 7. manifold sanity ---------------------------------------------------
const mm = ifaces.flatMap((it) => it.manifoldPoints);
check('A11 manifold size', ifaces.every((it) => it.manifoldPoints.length <= 4 && it.manifoldPoints.length >= 3),
  `min=${Math.min(...ifaces.map((it) => it.manifoldPoints.length))} max=${Math.max(...ifaces.map((it) => it.manifoldPoints.length))}`);
const subsetOk = ifaces.every((it) => it.subset.every((k) => k < it.polygonFeatures.length));
check('A12 manifold subset', subsetOk, `all ${ifaces.length} manifolds selected from polygon vertices`);
let keyUnique = 0;
for (const it of ifaces) {
  const keys = it.featureIds;
  if (new Set(keys).size === keys.length && keys.every((k) => k.length > 3)) keyUnique++;
}
check('A13 feature ids', keyUnique === ifaces.length, `${keyUnique}/${ifaces.length} manifolds have unique non-empty ids`);

// every manifold point lies inside both original footprints (independent test)
let inBoth = 0, ptTotal = 0;
for (let s = 0; s < scenarios.length; s++) {
  const { bodies: bs, settled: st } = buildChain(scenarios[s]);
  const r = results[s];
  for (let i = 0; i + 1 < bs.length; i++) {
    const lo = footprint(st[i], i), up = footprint(st[i + 1], i + 1);
    for (const p of r.interfaces[i].manifoldPoints) {
      ptTotal++;
      const closed = (poly, q) => poly.every((a, i) => sgn(cross(a, poly[(i + 1) % poly.length], q)) >= 0);
      if (closed(lo, p) && closed(up, p)) inBoth++;
    }
  }
}
check('A14 points inside both bodies', inBoth === ptTotal, `${inBoth}/${ptTotal} manifold points inside or on the boundary of both footprints`);

// ---- 8. independent centroid oracle (fan triangulation) -------------------
function fanCentroid(poly) {
  let area = fr(0n), cx = fr(0n), cz = fr(0n);
  const p0 = poly[0];
  for (let i = 1; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const tri = div(sub(mul(sub(a.x, p0.x), sub(b.z, p0.z)), mul(sub(b.x, p0.x), sub(a.z, p0.z))), fr(2n));
    area = add(area, tri);
    const tx = div(add(add(p0.x, a.x), b.x), fr(3n));
    const tz = div(add(add(p0.z, a.z), b.z), fr(3n));
    cx = add(cx, mul(tri, tx)); cz = add(cz, mul(tri, tz));
  }
  return { x: div(cx, area), z: div(cz, area) };
}
let cenOk = 0;
for (let s = 0; s < scenarios.length; s++) {
  const { settled: st } = buildChain(scenarios[s]);
  for (let i = 0; i + 1 < st.length; i++) {
    const poly = clipConvex(footprint(st[i + 1], i + 1), footprint(st[i], i));
    const a = polygonCentroid(poly), b = fanCentroid(poly);
    if (eq(a.x, b.x) && eq(a.z, b.z)) cenOk++;
  }
}
check('A15 centroid oracle', cenOk === 138, `${cenOk}/138 centroids equal to independent fan-triangulation oracle`);

// ---- 9. independent area oracle: Pick's theorem on a small-denominator fixture
function pickArea(poly) {
  let D = 1n;
  for (const p of poly) for (const v of [p.x, p.z]) {
    const d = v.d; const g = gcd(D, d); D = (D / g) * d;
  }
  if (D > 5000n) return { ok: false, D };
  const pts = poly.map((p) => ({ X: p.x.n * (D / p.x.d), Z: p.z.n * (D / p.z.d) }));
  let B = 0n;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = a.X - b.X, dz = a.Z - b.Z;
    B += gcd(dx < 0n ? -dx : dx, dz < 0n ? -dz : dz);
  }
  let I = 0n;
  let xmin = pts[0].X, xmax = pts[0].X, zmin = pts[0].Z, zmax = pts[0].Z;
  for (const q of pts) {
    if (q.X < xmin) xmin = q.X; if (q.X > xmax) xmax = q.X;
    if (q.Z < zmin) zmin = q.Z; if (q.Z > zmax) zmax = q.Z;
  }
  for (let z = zmin + 1n; z < zmax; z++) {
    for (let x = xmin + 1n; x < xmax; x++) {
      let ok = true;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const cr = (b.X - a.X) * (z - a.Z) - (b.Z - a.Z) * (x - a.X);
        if (cr <= 0n) { ok = false; break; }
      }
      if (ok) I++;
    }
  }
  return { ok: true, D, area: fr(2n * I + B - 2n, 2n * D * D) };
}
const latticePairs = [
  [
    { cx: '0', cz: '0', hx: '1', hz: '1', h: '1', c: '1', s: '0', seat: '0' },
    { cx: '1/10', cz: '1/20', hx: '1', hz: '1', h: '1', c: '3/5', s: '4/5', seat: '0' },
  ],
  [
    { cx: '0', cz: '0', hx: '1', hz: '1', h: '1', c: '3/5', s: '4/5', seat: '0' },
    { cx: '1/20', cz: '1/10', hx: '1', hz: '1', h: '1', c: '1', s: '0', seat: '0' },
  ],
];
const pickChecks = [];
for (let k = 0; k < latticePairs.length; k++) {
  const [lo, up] = buildChain({ id: `lat-${k}`, baseY: '0', bodies: latticePairs[k] }).settled;
  const poly = clipConvex(footprint(up, 1), footprint(lo, 0));
  const pa = polygonArea(poly), pk = pickArea(poly);
  pickChecks.push({ k, verts: poly.length, D: pk.ok ? String(pk.D) : '>5000', exact: pk.ok && eq(pa, pk.area), area: fstr(pa) });
}
check('A16 Pick area oracle', pickChecks.every((c) => c.exact),
  pickChecks.map((c) => `pair${c.k}:v${c.verts}:D${c.D}:${c.exact ? 'exact' : 'MISMATCH'}`).join(' '));

// ---- 10. warm-start feature stability across 6 rounds --------------------
const ROUNDS = 6;
let jSum = 0, jN = 0, jMin = 1, roundManifolds = 0, roundInside = 0;
for (const sc of scenarios) {
  let prev = analyzeScenario(sc).interfaces.map((it) => it.featureIds);
  for (let r = 1; r < ROUNDS; r++) {
    const res = analyzeScenario(perturbScenario(sc, r));
    roundManifolds += res.interfaces.length;
    roundInside += res.interfaces.filter((it) => it.contains).length;
    const cur = res.interfaces.map((it) => it.featureIds);
    const js = cur.map((v, i) => featureJaccard(prev[i], v));
    jSum += js.reduce((a, b) => a + b, 0); jN += js.length; jMin = Math.min(jMin, ...js);
    prev = cur;
  }
}
check('A17 feature stability', jSum / jN >= 0.97, `mean Jaccard=${(jSum / jN).toFixed(6)} over ${jN} interface pairs, min=${jMin.toFixed(6)}`);
check('A18 containment in all rounds', roundInside === roundManifolds,
  `${roundInside}/${roundManifolds} perturbed manifolds still strictly contain the support CoM`);

// ---- 11. scale invariance ------------------------------------------------
const scales = ['1/1000000', '1/1000', '1', '1000', '1000000'];
const topo = [];
const areaAt1 = results[0].interfaces[0].area;
let scaleOk = 0, scaleTotal = 0;
for (const k of scales) {
  const res = analyzeScenario(scaleScenario(scenarios[0], k));
  topo.push(res.interfaces.map((it) => `${it.featureIds.join(',')}#${it.subset.join(',')}`).join(';'));
  scaleTotal++;
  const expect = mul(areaAt1, mul(fparse(k), fparse(k)));
  if (eq(res.interfaces[0].area, expect)) scaleOk++;
}
check('A19 scale topology', new Set(topo).size === 1, `${scales.length} scales share one feature+subset signature`);
check('A20 scale area', scaleOk === scaleTotal, `${scaleOk}/${scaleTotal} areas scale exactly by k^2`);

// ---- 12. determinism / fraction hygiene ----------------------------------
const sigA = signatureOf(analyzeScenario(scenarios[2]));
const sigB = signatureOf(analyzeScenario(scenarios[2]));
check('A21 determinism', sigA === sigB, `two runs of chain-2 share signature (${sigA.length} chars)`);
const allFracs = ifaces.flatMap((it) => [it.area, it.com.x, it.com.z, it.gap, ...(it.centroid ? [it.centroid.x, it.centroid.z] : [])]);
const normalized = allFracs.every((f) => f.d > 0n && gcd(f.n, f.d) === 1n);
check('A22 fraction hygiene', normalized, `${allFracs.length} fractions reduced with positive denominator`);

// ---- 13. machine reference ----------------------------------------------
let areaSum = fr(0n);
for (const it of ifaces) areaSum = add(areaSum, it.area);
check('A23 reference totals', ref.totals.manifolds === 828 && ref.totals.containment === 1 &&
  ref.totals.areaSum === fstr(areaSum) && ref.scenarios[0].signature === signatureOf(results[0]),
  `manifolds=${ref.totals.manifolds} containment=${ref.totals.containment} areaSum=${fstr(areaSum)}`);

// ---- 14. independent optimality of the chosen 4-subset -------------------
// Re-enumerate every 4-subset here without calling reduceManifold: the chosen
// margin must equal the maximal containing-subset margin on 36 sampled contacts.
function localMargin(q, p) {
  let best = null;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const cr = cross(a, b, p);
    if (sgn(cr) <= 0) return null;
    const m = toNumber(cr) / Math.sqrt(toNumber(len2(a, b)));
    if (best === null || m < best) best = m;
  }
  return best;
}
let optChecked = 0, optEqual = 0, optGap = 0;
for (let s = 0; s < scenarios.length; s++) {
  const { bodies: bs, settled: st } = buildChain(scenarios[s]);
  for (let i = 0; i < 6; i++) {
    const poly = clipConvex(footprint(st[i + 1], i + 1), footprint(st[i], i));
    const com = supportCom(bs, i + 1);
    let best = null;
    for (let a = 0; a < poly.length; a++) for (let b = a + 1; b < poly.length; b++)
      for (let c = b + 1; c < poly.length; c++) for (let d = c + 1; d < poly.length; d++) {
        const m = localMargin([poly[a], poly[b], poly[c], poly[d]], com);
        if (m !== null && (best === null || m > best)) best = m;
      }
    const chosen = results[s].interfaces[i].margin;
    optChecked++; optGap = Math.max(optGap, Math.abs(best - chosen));
    if (Math.abs(best - chosen) < 1e-12) optEqual++;
  }
}
check('A24 subset optimality', optEqual === optChecked, `${optEqual}/${optChecked} sampled contacts reach the independently enumerated max margin (gap=${optGap.toExponential(2)})`);

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
