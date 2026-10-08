// Precompute the dot map: one dot per nomination, filling each country's outline.
//
// Each country's outline (its largest landmass, from Natural Earth via
// world-atlas) is scaled so that its area matches the number of nominations
// sent from it, then countries are nudged apart until none overlap. The page
// only reads the resulting dot positions, so it needs no mapping library.
//
//   node scripts/build_map.mjs physics   ->  site/data/physics-map.json
import fs from "node:fs";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoArea } from "d3-geo";

const prize = process.argv[2] || "physics";
const data = JSON.parse(fs.readFileSync(`site/data/${prize}.json`, "utf8"));
const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/countries-50m.json", "utf8"));
const world = feature(topo, topo.objects.countries);

const ALIAS = { "United States": "United States of America", "Czech Republic": "Czechia" };
// Where a country's dots are anchored when its outline's centre would mislead.
const ANCHOR = {
  Russia: [37.6, 55.8], Canada: [-79, 47], "United States": [-97, 39], Norway: [9.5, 61.5],
  Chile: [-71, -33], Japan: [138.5, 36.5], "New Zealand": [174, -41], Australia: [134, -26],
};
const W = 1000, H = 560, PITCH = 3.4, PAD = 9;

const projection = geoNaturalEarth1().fitExtent([[10, 10], [W - 10, H - 10]], {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[-128, -50], [178, -50], [178, 72], [-128, 72], [-128, -50]]] },
});

const counts = new Map();
data.noms.c.forEach((c) => { if (c >= 0) counts.set(c, (counts.get(c) || 0) + 1); });

function largestPolygon(geom) {
  if (geom.type === "Polygon") return geom.coordinates;
  let best = null, bestArea = -1;
  for (const poly of geom.coordinates) {
    const a = geoArea({ type: "Polygon", coordinates: poly });
    if (a > bestArea) { bestArea = a; best = poly; }
  }
  return best;
}
function shoelace(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  a /= 2;
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}
function inside(x, y, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const items = [];
for (const [ci, n] of counts) {
  const name = data.countries[ci];
  const feat = world.features.find((f) => f.properties.name === (ALIAS[name] || name));
  if (!feat) { console.error("no outline for", name); continue; }
  const poly = largestPolygon(feat.geometry);
  // a ring that crosses the 180th meridian (Russia) is folded back onto it
  const lons = poly[0].map((pt) => pt[0]);
  const wraps = Math.max(...lons) - Math.min(...lons) > 180;
  const ring = poly[0].map(([lon, lat]) => projection([wraps && lon < 0 ? 180 : lon, lat]));
  const { area, cx, cy } = shoelace(ring);
  let [ax, ay] = ANCHOR[name] ? projection(ANCHOR[name]) : [cx, cy];
  // Europe sent most of the letters: spread anchors around it (a fisheye) so
  // its countries have room while keeping their directions from one another.
  const [ex, ey] = projection([11, 50]);
  const d = Math.hypot(ax - ex, ay - ey);
  const g = 1 + 2.3 * Math.exp(-d / 130);
  ax = ex + (ax - ex) * g; ay = ey + (ay - ey) * g;
  const target = n * PITCH * PITCH * 0.95;
  const r = Math.sqrt(target / Math.PI);
  items.push({ ci, name, n, ring: ring.map(([x, y]) => [x - cx, y - cy]), area, ax, ay, x: ax, y: ay, r });
}

// Fill each scaled outline with a hexagonal grid of dots (centred on 0,0).
function fill(it, f) {
  const ring = it.ring.map(([x, y]) => [x * f, y * f]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const pts = [];
  const dy = PITCH * 0.866;
  for (let y = Math.floor(minY / dy) * dy; y <= maxY; y += dy) {
    const off = (Math.round(y / dy) & 1) ? PITCH / 2 : 0;
    for (let x = Math.floor(minX / PITCH) * PITCH + off; x <= maxX; x += PITCH) {
      if (inside(x, y, ring)) pts.push([x, y]);
    }
  }
  return pts;
}
for (const it of items) {
  const t0 = Date.now();
  let pts;
  if (it.n <= 3) {
    pts = [[0, 0], [PITCH, 0], [PITCH / 2, -PITCH * 0.866]].slice(0, it.n);
  } else {
    const f0 = Math.sqrt((it.n * PITCH * PITCH * 0.866) / it.area);
    let lo = f0 * 0.5, hi = f0 * 2.5;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (fill(it, mid).length >= it.n) hi = mid; else lo = mid;
    }
    pts = fill(it, hi);
    // drop surplus dots farthest from the centre so the count is exact
    pts.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    pts = pts.slice(0, it.n);
  }
  // bottom rows first, so dots can be coloured from the ground up
  pts.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  it.pts = pts;
  it.box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    it.box[0] = Math.min(it.box[0], x - PITCH / 2); it.box[1] = Math.min(it.box[1], y - PITCH / 2);
    it.box[2] = Math.max(it.box[2], x + PITCH / 2); it.box[3] = Math.max(it.box[3], y + PITCH / 2);
  }
  if (process.env.DEBUG) console.error(it.name, it.n, it.ring.length, Date.now() - t0, "ms");
}

// Separate overlapping countries by their dot boxes: every country starts at
// its (spread) home position and is pushed apart from neighbours along the
// shallower overlap, with a weak pull home, until nothing overlaps.
for (const it of items) { it.x = it.ax; it.y = it.ay; }
for (let iter = 0; iter < 2000; iter++) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const ox = Math.min(a.x + a.box[2], b.x + b.box[2]) - Math.max(a.x + a.box[0], b.x + b.box[0]) + PAD;
      const oy = Math.min(a.y + a.box[3], b.y + b.box[3]) - Math.max(a.y + a.box[1], b.y + b.box[1]) + PAD;
      if (ox <= 0 || oy <= 0) continue;
      const wa = b.n / (a.n + b.n), wb = 1 - wa;
      const acx = a.x + (a.box[0] + a.box[2]) / 2, bcx = b.x + (b.box[0] + b.box[2]) / 2;
      const acy = a.y + (a.box[1] + a.box[3]) / 2, bcy = b.y + (b.box[1] + b.box[3]) / 2;
      if (ox < oy) {
        const dir = acx < bcx ? -1 : 1;
        a.x += dir * ox * wa * 0.5; b.x -= dir * ox * wb * 0.5;
      } else {
        const dir = acy < bcy ? -1 : 1;
        a.y += dir * oy * wa * 0.5; b.y -= dir * oy * wb * 0.5;
      }
    }
  }
  const pull = iter < 1500 ? 0.006 : 0;
  for (const it of items) {
    it.x += (it.ax - it.x) * pull; it.y += (it.ay - it.y) * pull;
    it.x = Math.max(4 - it.box[0], Math.min(W - 4 - it.box[2], it.x));
    it.y = Math.max(22 - it.box[1], Math.min(H - 4 - it.box[3], it.y));
  }
}
let overlaps = 0;
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  const a = items[i], b = items[j];
  if (Math.min(a.x + a.box[2], b.x + b.box[2]) > Math.max(a.x + a.box[0], b.x + b.box[0]) &&
      Math.min(a.y + a.box[3], b.y + b.box[3]) > Math.max(a.y + a.box[1], b.y + b.box[1])) overlaps++;
}
if (overlaps) console.error(`warning: ${overlaps} overlapping countries remain`);

const out = { W, H, pitch: PITCH, countries: {} };
for (const it of items) {
  out.countries[it.ci] = {
    name: it.name, n: it.n,
    x: +it.x.toFixed(2), y: +it.y.toFixed(2),
    box: it.box.map((v) => +v.toFixed(2)),
    dots: it.pts.map(([x, y]) => [+(x).toFixed(2), +(y).toFixed(2)]),
  };
}
fs.writeFileSync(`site/data/${prize}-map.json`, JSON.stringify(out));
console.log(`map: ${items.length} countries, ${[...counts.values()].reduce((a, b) => a + b, 0)} dots`);
