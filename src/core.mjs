// Exact rational contact-manifold core for a settled multi-body chain.
// Pure ES module: no DOM, no rendering library, no I/O, no environment reads at
// module scope. Every coordinate is a BigInt fraction {n, d} with d > 0 and
// gcd(|n|, d) = 1, so area, centroid and containment decisions are exact.

export const ZERO = fr(0n);
export const ONE = fr(1n);

export function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

export function fr(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new RangeError('zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

export const add = (a, b) => fr(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a, b) => fr(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => fr(a.n * b.n, a.d * b.d);
export const div = (a, b) => { if (b.n === 0n) throw new RangeError('division by zero'); return fr(a.n * b.d, a.d * b.n); };
export const neg = (a) => ({ n: -a.n, d: a.d });
export const abs = (a) => (a.n < 0n ? { n: -a.n, d: a.d } : a);
export const cmp = (a, b) => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
export const eq = (a, b) => a.n === b.n && a.d === b.d;
export const isZero = (a) => a.n === 0n;
export const sgn = (a) => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
export const toNumber = (a) => Number(a.n) / Number(a.d);
export const fstr = (a) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
export const fparse = (s) => {
  if (s && typeof s === 'object' && typeof s.n === 'bigint') return fr(s.n, s.d);
  const t = String(s); const k = t.indexOf('/');
  return k < 0 ? fr(BigInt(t), 1n) : fr(BigInt(t.slice(0, k)), BigInt(t.slice(k + 1)));
};

// ---------------------------------------------------------------------------
// 2D exact geometry in the x-z plane. Polygons are CCW; the interior is on the
// left of every directed edge, i.e. cross(a, b, p) > 0.
// ---------------------------------------------------------------------------

export function crossVec(u, v) { return sub(mul(u.x, v.z), mul(u.z, v.x)); }

export function cross(a, b, p) {
  return sub(mul(sub(b.x, a.x), sub(p.z, a.z)), mul(sub(b.z, a.z), sub(p.x, a.x)));
}

export function len2(a, b) {
  const dx = sub(b.x, a.x), dz = sub(b.z, a.z);
  return add(mul(dx, dx), mul(dz, dz));
}

export function polygonArea(poly) {
  let s = ZERO;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s = add(s, sub(mul(a.x, b.z), mul(b.x, a.z)));
  }
  return div(s, fr(2n));
}

export function polygonCentroid(poly) {
  let s = ZERO, cx = ZERO, cz = ZERO;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = sub(mul(a.x, b.z), mul(b.x, a.z));
    s = add(s, c);
    cx = add(cx, mul(add(a.x, b.x), c));
    cz = add(cz, mul(add(a.z, b.z), c));
  }
  const den = mul(fr(3n), s); // 6 * area, area = s / 2
  return { x: div(cx, den), z: div(cz, den) };
}

export function pointInConvex(poly, p) {
  for (let i = 0; i < poly.length; i++) {
    if (sgn(cross(poly[i], poly[(i + 1) % poly.length], p)) <= 0) return false;
  }
  return true;
}

// Intersection of the segment p->q with the infinite line a->b (exact).
function lineHit(p, q, a, b) {
  const r = { x: sub(q.x, p.x), z: sub(q.z, p.z) };
  const s = { x: sub(b.x, a.x), z: sub(b.z, a.z) };
  const den = crossVec(r, s);
  if (isZero(den)) return null;
  const ap = { x: sub(a.x, p.x), z: sub(a.z, p.z) };
  const t = div(crossVec(ap, s), den);
  return { x: add(p.x, mul(t, r.x)), z: add(p.z, mul(t, r.z)) };
}

function dedupe(poly) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || !eq(q.x, p.x) || !eq(q.z, p.z)) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (eq(a.x, b.x) && eq(a.z, b.z)) out.pop(); else break;
  }
  return out;
}

// Sutherland-Hodgman clipping with provenance. Each output vertex keeps the
// feature key of the generator that produced it: an input corner or the
// ordered pair (subject edge, clipper edge) for an intersection.
export function clipConvex(subject, clipper) {
  let out = subject.map((p) => ({ x: p.x, z: p.z, key: p.key }));
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length];
    const edgeKey = `E(${[a.key, b.key].sort().join('|')})`;
    const input = out;
    out = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = sgn(cross(a, b, p)) >= 0;
      const qin = sgn(cross(a, b, q)) >= 0;
      if (pin) out.push(p);
      if (pin !== qin) {
        const hit = lineHit(p, q, a, b);
        if (hit) out.push({ x: hit.x, z: hit.z, key: `X(${[p.key, q.key].sort().join('|')};${edgeKey})` });
      }
    }
    out = dedupe(out);
  }
  return out;
}

// Box footprint in world x-z. Local corners are CCW, yaw is a rational
// Pythagorean pair (c, s) with c^2 + s^2 = 1, so all coordinates stay rational.
export function footprint(body, bodyIndex) {
  const cs = [[-1n, -1n], [1n, -1n], [1n, 1n], [-1n, 1n]];
  return cs.map(([sx, sz], k) => {
    const lx = mul(body.hx, fr(sx)), lz = mul(body.hz, fr(sz));
    return {
      x: add(body.cx, sub(mul(body.c, lx), mul(body.s, lz))),
      z: add(body.cz, add(mul(body.s, lx), mul(body.c, lz))),
      key: `B${bodyIndex}:C${k}`,
    };
  });
}

// Signed min margin of point p over the quad edges, in length units:
// min over edges of cross(a,b,p) / |b-a|. Returns null unless p is strictly
// inside every edge. The cross products are exact; the division by the edge
// length uses Math.sqrt of an exact squared length (selection only).
export function quadMargin(quad, p) {
  let best = null;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    const cr = cross(a, b, p);
    if (sgn(cr) <= 0) return null;
    const m = toNumber(cr) / Math.sqrt(toNumber(len2(a, b)));
    if (best === null || m < best) best = m;
  }
  return best;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
}

// Reduce a contact polygon to at most 4 support points. Among all 4-subsets
// whose convex quad strictly contains the support centre of mass, take the one
// with the largest minimum edge margin (tie: larger exact area, then lower
// index tuple). If no subset contains it, return the best-margin 4 points and
// report contains=false so the caller can count the failure.
export function reduceManifold(poly, com) {
  const n = poly.length;
  if (n < 3) return { points: [], subset: [], contains: false, margin: null, area: ZERO };
  if (n === 3) {
    const m = quadMargin(poly, com);
    return { points: poly.slice(), subset: [0, 1, 2], contains: m !== null, margin: m, area: polygonArea(poly) };
  }
  let best = null, fallback = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          const idx = [i, j, k, l];
          const quad = idx.map((t) => poly[t]);
          const m = quadMargin(quad, com);
          const area = polygonArea(quad);
          if (m === null) {
            // Track a signed fallback margin only when nothing contains the CoM.
            let signedMin = Infinity;
            for (let e = 0; e < 4; e++) {
              const a = quad[e], b = quad[(e + 1) % 4];
              const v = toNumber(cross(a, b, com)) / Math.sqrt(toNumber(len2(a, b)));
              if (v < signedMin) signedMin = v;
            }
            if (!fallback || signedMin > fallback.margin) fallback = { idx, quad, margin: signedMin };
            continue;
          }
          const cand = { idx, quad, margin: m, area };
          if (!best) { best = cand; continue; }
          if (m > best.margin + 1e-12) best = cand;
          else if (Math.abs(m - best.margin) <= 1e-12) {
            if (cmp(area, best.area) > 0) best = cand;
            else if (cmp(area, best.area) === 0 && lexLess(idx, best.idx)) best = cand;
          }
        }
      }
    }
  }
  if (best) {
    return { points: best.quad, subset: best.idx, contains: true, margin: best.margin, area: best.area };
  }
  const f = fallback || { idx: [0, 1, 2, 3], quad: poly.slice(0, 4), margin: null };
  return { points: f.quad, subset: f.idx, contains: false, margin: f.margin, area: polygonArea(f.quad) };
}

// ---------------------------------------------------------------------------
// Multi-body chain
// ---------------------------------------------------------------------------

function parseBody(b) {
  return {
    cx: fparse(b.cx), cz: fparse(b.cz), hx: fparse(b.hx), hz: fparse(b.hz),
    h: fparse(b.h), c: fparse(b.c), s: fparse(b.s), seat: fparse(b.seat || '0'),
  };
}

// Build the chain twice: raw (with the declared seating interference, so every
// interface overlaps by `seat`) and settled (interference resolved exactly).
export function buildChain(scenario) {
  const bodies = scenario.bodies.map(parseBody);
  const base = fparse(scenario.baseY || '0');
  const raw = [], settled = [];
  let yRaw = base, ySet = base, cum = ZERO;
  for (let i = 0; i < bodies.length; i++) {
    raw.push({ ...bodies[i], y0: yRaw, y1: add(yRaw, bodies[i].h) });
    settled.push({ ...bodies[i], y0: ySet, y1: add(ySet, bodies[i].h) });
    const seat = bodies[i].seat;
    cum = add(cum, seat);
    yRaw = sub(add(yRaw, bodies[i].h), i + 1 < bodies.length ? bodies[i + 1].seat : ZERO);
    ySet = add(ySet, bodies[i].h);
  }
  return { bodies, raw, settled };
}

// Volume-weighted centre of mass of bodies from index `from` upward.
export function supportCom(bodies, from) {
  let wsum = ZERO, cx = ZERO, cz = ZERO;
  for (let i = from; i < bodies.length; i++) {
    const b = bodies[i];
    const w = mul(mul(b.hx, b.hz), b.h); // factor 4 cancels
    wsum = add(wsum, w); cx = add(cx, mul(w, b.cx)); cz = add(cz, mul(w, b.cz));
  }
  return { x: div(cx, wsum), z: div(cz, wsum) };
}

export function analyzeScenario(scenario) {
  const { bodies, raw, settled } = buildChain(scenario);
  const interfaces = [];
  for (let i = 0; i + 1 < bodies.length; i++) {
    const lower = settled[i], upper = settled[i + 1];
    const poly = clipConvex(footprint(upper, i + 1), footprint(lower, i));
    const com = supportCom(bodies, i + 1);
    const manifold = reduceManifold(poly, com);
    const gapExact = sub(sub(upper.y0, lower.y1), ZERO);
    const rawGap = sub(upper.y0, lower.y1);
    const rawOverlap = sub(raw[i + 1].y0, raw[i].y1);
    interfaces.push({
      index: i,
      vertexCount: poly.length,
      area: poly.length >= 3 ? polygonArea(poly) : ZERO,
      centroid: poly.length >= 3 ? polygonCentroid(poly) : null,
      com,
      contains: manifold.contains,
      margin: manifold.margin,
      manifoldPoints: manifold.points.map((p) => ({ x: p.x, z: p.z, key: p.key })),
      featureIds: manifold.points.map((p) => p.key),
      polygonFeatures: poly.map((p) => p.key),
      subset: manifold.subset,
      gap: gapExact,
      rawGap,
      rawOverlap,
    });
  }
  return { scenario: scenario.id, bodies: settled.length, interfaces };
}

// Deterministic perturbation: shift every centre by a small rational amount that
// depends only on (round, body index). Round 0 is the unperturbed chain.
export function perturbScenario(scenario, round) {
  if (!round) return scenario;
  const bodies = scenario.bodies.map((b, i) => {
    const dx = fr(BigInt(((round * 37 + i * 11) % 7) - 3), 3000n);
    const dz = fr(BigInt(((round * 53 + i * 7) % 5) - 2), 2500n);
    return {
      ...b,
      cx: fstr(add(fparse(b.cx), dx)),
      cz: fstr(add(fparse(b.cz), dz)),
    };
  });
  return { ...scenario, bodies };
}

export function scaleScenario(scenario, k) {
  const s = fparse(k);
  const sc = (v) => fstr(mul(fparse(v), s));
  return {
    ...scenario,
    baseY: sc(scenario.baseY || '0'),
    bodies: scenario.bodies.map((b) => ({
      ...b,
      cx: sc(b.cx), cz: sc(b.cz), hx: sc(b.hx), hz: sc(b.hz), h: sc(b.h), seat: sc(b.seat || '0'),
    })),
  };
}

export function signatureOf(result) {
  return result.interfaces.map((it) => [
    it.featureIds.join(','), it.subset.join(','), fstr(it.area),
    it.centroid ? `${fstr(it.centroid.x)}/${fstr(it.centroid.z)}` : '-',
    it.contains ? '1' : '0',
  ].join('|')).join(';');
}

export function containmentRate(result) {
  if (!result.interfaces.length) return 0;
  return result.interfaces.filter((it) => it.contains).length / result.interfaces.length;
}

export function featureJaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const k of A) if (B.has(k)) inter++;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 1 : inter / uni;
}

// Affine support function: how far the polygon extends along direction d.
export function supportExtent(poly, d) {
  let best = null;
  for (const p of poly) {
    const v = add(mul(p.x, d.x), mul(p.z, d.z));
    if (best === null || cmp(v, best) > 0) best = v;
  }
  return best;
}
