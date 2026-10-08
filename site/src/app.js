(() => {
  "use strict";

  // ------------------------------------------------------------------ data
  const D = JSON.parse(document.getElementById("data").textContent);
  const MAP = JSON.parse(document.getElementById("map-data").textContent);
  const PRIZE = D.prize;
  const TAU = Math.PI * 2;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) => n.toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CAT = { physics: "Physics", chemistry: "Chemistry", medicine: "Physiology or Medicine", literature: "Literature", peace: "Peace", economics: "Economic Sciences" };

  const people = D.people.map(([name, gender, birth, death, awards, anon, aid, short], i) => {
    const own = awards.filter((a) => a[0] === PRIZE);
    return { i, name, short: short || name, gender, birth, death, awards, anon: !!anon, aid,
      won: own.length ? own[0][1] : 0, other: awards.filter((a) => a[0] !== PRIZE) };
  });
  const N = D.noms.y.length;
  const Y = D.noms.y, E = D.noms.e, R = D.noms.r, L = D.noms.l, F = D.noms.f, C = D.noms.c, TH = D.noms.t, G = D.noms.g;
  const counted = (i) => (F[i] & 1) === 1;
  const byLaureate = (i) => (F[i] & 2) === 2;
  const bySwede = (i) => (F[i] & 4) === 4;
  const goldDot = (i) => people[E[i]].won > 0;

  const NE = new Map();
  for (const r of D.nominees) {
    NE.set(r[0], { i: r[0], noms: r[1], nomsAll: r[2], backers: r[3], countries: r[4], swedes: r[5], laureates: r[6],
      top: r[7], first: r[8], last: r[9], years: r[10], won: r[11], homes: r[12] });
  }
  const NR = new Map();
  for (const r of D.nominators) NR.set(r[0], { i: r[0], noms: r[1], candidates: r[2], winners: r[3], first: r[4], last: r[5], top: r[6] });

  const byNominee = new Map(), byNominator = new Map();
  for (let i = 0; i < N; i++) {
    if (!byNominee.has(E[i])) byNominee.set(E[i], []);
    byNominee.get(E[i]).push(i);
    if (!byNominator.has(R[i])) byNominator.set(R[i], []);
    byNominator.get(R[i]).push(i);
  }
  const FOCUS = D.focus;
  const ST = D.stats;
  const FIRST = ST.first_year, LAST = ST.last_year;

  // ------------------------------------------------------------------ palette
  let pal = {};
  function parseColor(s) {
    s = (s || "").trim();
    if (s[0] === "#") {
      let h = s.slice(1);
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const m = s.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => parseColor(cs.getPropertyValue(n));
    pal = { gold: g("--gold"), goldHi: g("--gold-hi"), goldLo: g("--gold-lo"), slate: g("--slate"), accent: g("--accent"),
      men: g("--men"), ink: g("--ink"), ink3: g("--ink-3"), bg: g("--bg"), flagBlue: g("--flag-blue"), flagGold: g("--flag-gold"), rule: g("--rule") };
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ------------------------------------------------------------------ stage
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("dots");
  const g2 = canvas.getContext("2d");
  const svg = document.getElementById("lines");
  const annot = document.getElementById("annot");
  const legendEl = document.getElementById("legend");
  const tipEl = document.getElementById("tip");
  const desc = document.getElementById("chart-desc");
  let W = 0, H = 0, DPR = 1;

  function frame(reserve) {
    const mobile = W < 700;
    let x0 = mobile ? 14 : 36, x1 = W - (mobile ? 14 : 36);
    const y0 = mobile ? 58 : 74, y1 = H - (mobile ? 34 : 46);
    if (reserve === "right" && W >= 1000) x1 = W - Math.min(480, W * 0.37);
    if (reserve === "left" && W >= 1000) x0 = Math.min(480, W * 0.37);
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, mobile };
  }

  // ------------------------------------------------------------------ dots
  const x = new Float32Array(N), y = new Float32Array(N), r = new Float32Array(N), a = new Float32Array(N);
  const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
  const tx = new Float32Array(N), ty = new Float32Array(N), tr = new Float32Array(N), ta = new Float32Array(N);
  const tcr = new Float32Array(N), tcg = new Float32Array(N), tcb = new Float32Array(N);
  const sx = new Float32Array(N), sy = new Float32Array(N), sr = new Float32Array(N), sa = new Float32Array(N);
  const scr = new Float32Array(N), scg = new Float32Array(N), scb = new Float32Array(N);
  const delay = new Float32Array(N);
  const mark = new Uint8Array(N); // 1 = laureate ring, 2 = Swedish flag
  const tmark = new Uint8Array(N);
  let animStart = 0, animDur = 950, maxDelay = 0, animating = false, onFrame = null;

  function setDot(i, px, py, pr, col, alpha = 1, mk = 0) {
    tx[i] = px; ty[i] = py; tr[i] = pr; ta[i] = alpha;
    tcr[i] = col[0]; tcg[i] = col[1]; tcb[i] = col[2]; tmark[i] = mk;
  }
  function hideDot(i) { tx[i] = x[i]; ty[i] = y[i]; tr[i] = 0; ta[i] = 0; tmark[i] = 0; tcr[i] = cr[i]; tcg[i] = cg[i]; tcb[i] = cb[i]; }
  function hideAll() { for (let i = 0; i < N; i++) hideDot(i); }
  const dotColor = (i) => (goldDot(i) ? pal.gold : pal.slate);

  function commit(instant) {
    if (instant || reduceMotion) {
      x.set(tx); y.set(ty); r.set(tr); a.set(ta); cr.set(tcr); cg.set(tcg); cb.set(tcb); mark.set(tmark);
      animating = false;
      if (onFrame) onFrame(1);
      draw();
      return;
    }
    sx.set(x); sy.set(y); sr.set(r); sa.set(a); scr.set(cr); scg.set(cg); scb.set(cb);
    mark.set(tmark);
    maxDelay = 0;
    for (let i = 0; i < N; i++) if (delay[i] > maxDelay) maxDelay = delay[i];
    animStart = performance.now();
    if (!animating) { animating = true; requestAnimationFrame(tick); }
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function tick(now) {
    const el = now - animStart;
    for (let i = 0; i < N; i++) {
      let t = (el - delay[i]) / animDur;
      t = t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
      x[i] = sx[i] + (tx[i] - sx[i]) * t; y[i] = sy[i] + (ty[i] - sy[i]) * t;
      r[i] = sr[i] + (tr[i] - sr[i]) * t; a[i] = sa[i] + (ta[i] - sa[i]) * t;
      cr[i] = scr[i] + (tcr[i] - scr[i]) * t; cg[i] = scg[i] + (tcg[i] - scg[i]) * t; cb[i] = scb[i] + (tcb[i] - scb[i]) * t;
    }
    const p = Math.min(1, el / (animDur + maxDelay));
    if (onFrame) onFrame(p);
    draw();
    if (p < 1) requestAnimationFrame(tick); else animating = false;
  }

  let hoverSet = null;
  function draw() {
    g2.setTransform(DPR, 0, 0, DPR, 0, 0);
    g2.clearRect(0, 0, W, H);
    for (let i = 0; i < N; i++) {
      const ai = a[i], ri = r[i];
      if (ai < 0.02 || ri < 0.15) continue;
      g2.globalAlpha = ai;
      const col = `rgb(${cr[i] | 0},${cg[i] | 0},${cb[i] | 0})`;
      if (mark[i] & 2) {
        const w = Math.max(ri * 2.6, 5), h = w * 0.64;
        g2.fillStyle = `rgb(${pal.flagBlue})`;
        g2.fillRect(x[i] - w / 2, y[i] - h / 2, w, h);
        g2.fillStyle = `rgb(${pal.flagGold})`;
        g2.fillRect(x[i] - w / 2 + w * 0.3, y[i] - h / 2, w * 0.16, h);
        g2.fillRect(x[i] - w / 2, y[i] - h * 0.1, w, h * 0.2);
      } else {
        g2.fillStyle = col;
        g2.beginPath();
        g2.arc(x[i], y[i], ri, 0, TAU);
        g2.fill();
      }
      if (mark[i] & 1) {
        g2.strokeStyle = `rgb(${pal.gold})`;
        g2.lineWidth = Math.max(1, ri * 0.45);
        g2.beginPath();
        g2.arc(x[i], y[i], ri + Math.max(1.4, ri * 0.55), 0, TAU);
        g2.stroke();
      }
    }
    if (hoverSet) {
      g2.globalAlpha = 1;
      g2.strokeStyle = `rgb(${pal.ink})`;
      g2.lineWidth = 1.3;
      for (const i of hoverSet) {
        if (a[i] < 0.05) continue;
        g2.beginPath();
        g2.arc(x[i], y[i], r[i] + 1.3, 0, TAU);
        g2.stroke();
      }
    }
    g2.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ text measurement
  const measureCtx = document.createElement("canvas").getContext("2d");
  function textW(html, px = 12, weight = 600) {
    measureCtx.font = `${weight} ${px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
    const plain = String(html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    return measureCtx.measureText(plain).width;
  }
  // width of a label column: the longest label, within limits
  const labelCol = (f, labels, min = 60) => Math.min(f.w * (f.mobile ? 0.46 : 0.36), Math.max(min, ...labels.map((t) => textW(t) + 18)));

  // ------------------------------------------------------------------ layout helpers
  // offsets of a sunflower (Vogel) cluster with nearest neighbours ~pitch apart
  function sunflower(n, pitch) {
    const c = pitch * 0.53, out = new Array(n);
    for (let j = 0; j < n; j++) {
      const rr = c * Math.sqrt(j + (j ? 0.3 : 0)), th = j * GOLDEN;
      out[j] = [rr * Math.cos(th), rr * Math.sin(th)];
    }
    return out;
  }
  const clusterR = (n, pitch) => (n <= 1 ? pitch * 0.5 : pitch * 0.53 * Math.sqrt(n) + pitch * 0.42);
  const dotR = (pitch) => Math.max(0.6, pitch * (pitch < 3 ? 0.42 : 0.37));

  // place clusters in rows from a baseline upward; returns the height used
  function packRows(cl, x0, w, base, gap, dry) {
    let rowY = base, i = 0;
    while (i < cl.length) {
      const row = [];
      let used = 0, rowR = 0;
      while (i < cl.length && (row.length === 0 || used + 2 * cl[i].R <= w)) {
        row.push(cl[i]); used += 2 * cl[i].R + gap; rowR = Math.max(rowR, cl[i].R); i++;
      }
      used -= gap;
      if (!dry) {
        let cx = x0 + Math.max(0, (w - used) / 2);
        for (const c of row) { c.cx = cx + c.R; c.cy = rowY - rowR; cx += 2 * c.R + gap; }
      }
      rowY -= 2 * rowR + gap;
    }
    return base - rowY;
  }

  // beeswarm: items {x, R}; sets item.y as offset from the row's centre line
  function dodge(items, pad) {
    const placed = [];
    items.sort((p, q) => q.R - p.R || p.x - q.x);
    for (const it of items) {
      const cands = [0];
      for (const p of placed) {
        const dx = it.x - p.x, rr = it.R + p.R + pad;
        if (Math.abs(dx) < rr) {
          const dy = Math.sqrt(rr * rr - dx * dx);
          cands.push(p.y + dy, p.y - dy);
        }
      }
      cands.sort((u, v) => Math.abs(u) - Math.abs(v));
      for (const cy of cands) {
        let ok = true;
        for (const p of placed) {
          const dx = it.x - p.x, dy = cy - p.y, rr = it.R + p.R + pad - 0.01;
          if (dx * dx + dy * dy < rr * rr) { ok = false; break; }
        }
        if (ok) { it.y = cy; break; }
      }
      placed.push(it);
    }
    let ext = 0;
    for (const it of items) ext = Math.max(ext, Math.abs(it.y) + it.R);
    return ext;
  }

  // largest pitch (<= max) for which fn(pitch) reports a fit
  function fitPitch(fn, max, min = 0.8) {
    if (fn(max)) return max;
    let lo = min, hi = max;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (fn(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  // ------------------------------------------------------------------ annotations
  let annotTimer = 0;
  function setAnnot(html, linesHtml) {
    clearTimeout(annotTimer);
    annot.classList.add("is-hidden");
    svg.style.opacity = "0";
    annotTimer = setTimeout(() => {
      annot.innerHTML = html || "";
      svg.innerHTML = linesHtml || "";
      requestAnimationFrame(() => { annot.classList.remove("is-hidden"); svg.style.opacity = "1"; });
    }, reduceMotion ? 0 : 200);
  }
  function setAnnotNow(html, linesHtml) {
    clearTimeout(annotTimer);
    annot.innerHTML = html || "";
    svg.innerHTML = linesHtml || "";
    annot.classList.remove("is-hidden");
    svg.style.opacity = "1";
  }
  const lab = (px, py, cls, html, anchor = "") => {
    // anchor: "" left, "r" right edge at px, "c" centred at px; "m" vertical middle, "b" bottom at py
    const tr = [];
    if (anchor.includes("r")) tr.push("translateX(-100%)");
    if (anchor.includes("c")) tr.push("translateX(-50%)");
    if (anchor.includes("m")) tr.push("translateY(-50%)");
    if (anchor.includes("b")) tr.push("translateY(-100%)");
    return `<div class="lab ${cls}" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;${tr.length ? `transform:${tr.join(" ")}` : ""}">${html}</div>`;
  };
  const line = (x1, y1, x2, y2, color, w = 1, dash = "") =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  const css = (rgb) => `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
  function setLegend(items) {
    const key = {
      gold: '<i class="k k-gold"></i>', slate: '<i class="k k-slate"></i>', star: '<i class="k k-star"></i>', ring: '<i class="k k-ring"></i>',
      flag: '<i class="k k-flag"></i>', cluster: '<i class="k k-cluster"></i>', accent: '<i class="k k-accent"></i>', men: '<i class="k k-men"></i>',
      medal: '<i class="k k-medal"></i>', line: '<i class="k k-line"></i>',
    };
    legendEl.innerHTML = (items || []).map(([k, t]) => `<span>${key[k] || ""}${esc(t)}</span>`).join("");
  }
  const LEG = {
    won: ["gold", `Won the ${D.label.toLowerCase()} prize`],
    never: ["slate", `Never won the ${D.label.toLowerCase()} prize`],
    cluster: ["cluster", "One cluster per nominee"],
  };

  // ------------------------------------------------------------------ scene helpers
  const years = [];
  for (let yr = FIRST; yr <= LAST; yr++) years.push(yr);
  const yearIdx = new Map();
  for (let i = 0; i < N; i++) {
    if (!yearIdx.has(Y[i])) yearIdx.set(Y[i], []);
    yearIdx.get(Y[i]).push(i);
  }
  const nomineeCount = (p) => (NE.get(p) ? NE.get(p).nomsAll : 0);
  // order within a year's column: winners first, then by nominee, biggest first
  for (const list of yearIdx.values()) {
    list.sort((p, q) => (goldDot(q) - goldDot(p)) || (nomineeCount(E[q]) - nomineeCount(E[p])) || (E[p] - E[q]) || (p - q));
  }

  function yearAxis(f, xOf, opts = {}) {
    let html = "", lines = "";
    const step = f.w < 520 ? 20 : 10;
    for (let yr = Math.ceil(FIRST / step) * step; yr <= LAST; yr += step) {
      html += lab(xOf(yr), f.y1 + 8, "lab--axis", yr, "c");
    }
    if (!opts.noBase) lines += line(f.x0, f.y1 + 0.5, f.x1, f.y1 + 0.5, css(pal.rule));
    return { html, lines };
  }

  // narrow bins at the ends of the row keep their labels inside the frame
  function edgeAnchor(g, groups) {
    const k = groups.indexOf(g), narrow = g.w < 110;
    if (narrow && k === 0) return [g.x0, "", "lab--left"];
    if (narrow && k === groups.length - 1) return [g.x0 + g.w, "r", "lab--right"];
    return [g.x0 + g.w / 2, "c", "lab--center"];
  }

  // nominee clusters grouped into bins (used by several scenes)
  function binScene(f, bins, opts = {}) {
    const groups = bins.map((b) => ({ ...b, cl: [] }));
    for (const ne of NE.values()) {
      if (ne.noms <= 0) continue;
      const gi = groups.findIndex((b) => b.test(ne));
      if (gi < 0) continue;
      const dots = byNominee.get(ne.i).filter(counted);
      groups[gi].cl.push({ p: ne.i, dots, won: people[ne.i].won > 0, n: dots.length });
    }
    for (const gr of groups) gr.cl.sort((p, q) => (q.won - p.won) || (q.n - p.n) || (p.p - q.p));
    const gap = f.mobile ? 10 : 22;
    const weights = groups.map((g) => Math.sqrt(g.cl.reduce((s, c) => s + c.n, 0)) + 6);
    const wsum = weights.reduce((s, v) => s + v, 0);
    const avail = f.w - gap * (groups.length - 1);
    let cursor = f.x0;
    for (let k = 0; k < groups.length; k++) {
      groups[k].x0 = cursor;
      groups[k].w = Math.max(30, (avail * weights[k]) / wsum);
      cursor += groups[k].w + gap;
    }
    const base = f.y1;
    const top = f.y0 + (opts.headroom ?? 44);
    const maxH = base - top;
    const pitch = fitPitch((p) => groups.every((g) => {
      for (const c of g.cl) c.R = clusterR(c.n, p);
      return packRows(g.cl, g.x0, g.w, base, p * 0.5, true) <= maxH;
    }), opts.maxPitch || 7.5);
    hideAll();
    let html = "", lines = "";
    const rad = dotR(pitch);
    for (const g of groups) {
      for (const c of g.cl) c.R = clusterR(c.n, pitch);
      const h = packRows(g.cl, g.x0, g.w, base, pitch * 0.5, false);
      for (const c of g.cl) {
        const offs = sunflower(c.n, pitch);
        c.dots.forEach((i, j) => {
          setDot(i, c.cx + offs[j][0], c.cy + offs[j][1], rad, dotColor(i), 1, opts.mark ? opts.mark(i) : 0);
          delay[i] = 0;
        });
      }
      const won = g.cl.filter((c) => c.won).length;
      const pct = g.cl.length ? Math.round((100 * won) / g.cl.length) : 0;
      const [ax, an, cl2] = edgeAnchor(g, groups);
      const headTxt = g.w < 70 ? `${pct}%<small>won</small>` : `${pct}% won<small>${fmt(won)} of ${fmt(g.cl.length)}</small>`;
      html += lab(ax, base - h - 6, `lab--pct ${cl2}`, headTxt, `${an}b`);
      html += lab(ax, base + 8, `lab--axis ${cl2}`, esc(g.label), an);
    }
    if (opts.caption) html += lab((f.x0 + f.x1) / 2, base + 26, "lab--muted lab--center", esc(opts.caption), "c");
    lines += line(f.x0, base + 0.5, f.x1, base + 0.5, css(pal.rule));
    return { html, lines, groups, pitch };
  }

  // rows of people with their nominations along a year axis
  function timelineRows(f, rows, opts = {}) {
    const labelW = labelCol(f, rows.flatMap((r2) => [r2.label, r2.sub || ""]));
    const ax0 = f.x0 + labelW + 10, ax1 = f.x1 - 8;
    const xOf = (yr) => ax0 + ((yr - FIRST + 0.5) / (LAST - FIRST + 1)) * (ax1 - ax0);
    const rowH = Math.min(46, (f.h - 24) / rows.length);
    const colW = (ax1 - ax0) / (LAST - FIRST + 1);
    let maxPerYear = 1;
    for (const row of rows) {
      const cnt = new Map();
      for (const i of row.dots) cnt.set(Y[i], (cnt.get(Y[i]) || 0) + 1);
      for (const v of cnt.values()) maxPerYear = Math.max(maxPerYear, v);
    }
    const pitch = Math.max(1.6, Math.min(5.2, (rowH * 0.92) / (2 * 0.53 * Math.sqrt(maxPerYear) + 1), colW * 0.95));
    const rad = dotR(pitch);
    hideAll();
    let html = "", lines = "";
    rows.forEach((row, k) => {
      const cy = f.y0 + 16 + rowH * (k + 0.5);
      const byYear = new Map();
      for (const i of row.dots) {
        if (!byYear.has(Y[i])) byYear.set(Y[i], []);
        byYear.get(Y[i]).push(i);
      }
      for (const [yr, list] of byYear) {
        list.sort((p, q) => (goldDot(q) - goldDot(p)) || (p - q));
        const offs = sunflower(list.length, pitch);
        list.forEach((i, j) => {
          setDot(i, xOf(yr) + offs[j][0], cy + offs[j][1], rad, opts.color ? opts.color(i) : dotColor(i), 1, opts.mark ? opts.mark(i) : 0);
          delay[i] = k * 25;
        });
      }
      html += lab(ax0 - 12, cy, "lab--strong lab--right", row.label, "rm");
      if (row.sub) html += lab(ax0 - 12, cy + 13, "lab--sm lab--muted lab--right", row.sub, "rm");
      lines += line(ax0, cy, ax1, cy, css(pal.rule), 1);
      if (row.star) html += lab(xOf(row.star), cy - pitch * 2.2, "", '<i class="st"></i>', "cb");
    });
    const ax = yearAxis({ ...f, x0: ax0, x1: ax1, w: ax1 - ax0, y1: f.y0 + 16 + rowH * rows.length + 8 }, xOf, { noBase: true });
    html += ax.html;
    return { html, lines, xOf };
  }

  // horizontal dot bars, one row per item
  function barRows(f, rows, opts = {}) {
    const labelW = labelCol(f, rows.map((r2) => r2.label));
    const bx0 = f.x0 + labelW + 12;
    const rowH = Math.min(opts.rowMax || 40, (f.h - 20) / rows.length);
    const maxN = Math.max(...rows.map((rw) => rw.dots.length));
    const pitch = Math.max(1.6, Math.min(10, (f.x1 - bx0 - (opts.afterW ?? 90)) / maxN, rowH * 0.55));
    const rad = dotR(pitch);
    hideAll();
    let html = "";
    rows.forEach((row, k) => {
      const cy = f.y0 + 14 + rowH * (k + 0.5);
      row.dots.forEach((i, j) => {
        setDot(i, bx0 + j * pitch + pitch / 2, cy, rad, opts.color ? opts.color(i) : dotColor(i), 1, opts.mark ? opts.mark(i) : 0);
        delay[i] = k * 30 + j * 2;
      });
      html += lab(bx0 - 10, cy, "lab--strong lab--right", row.label, "rm");
      html += lab(bx0 + row.dots.length * pitch + 8, cy, "lab--sm lab--muted", row.after || fmt(row.dots.length), "m");
    });
    return { html };
  }

  // one physicist's nominations, stacked by year
  function profile(f, pi, opts = {}) {
    const p = people[pi], ne = NE.get(pi);
    const dots = byNominee.get(pi).slice();
    const ax0 = f.x0 + 4, ax1 = f.x1 - 4;
    // zoom to the years this person was nominated, with some room either side
    let y0 = Math.max(FIRST, ne.first - 5), y1 = Math.min(LAST, ne.last + 5);
    while (y1 - y0 < 34) { if (y0 > FIRST) y0--; if (y1 < LAST) y1++; if (y0 === FIRST && y1 === LAST) break; }
    const span = y1 - y0 + 1;
    const xOf = (yr) => ax0 + ((yr - y0 + 0.5) / span) * (ax1 - ax0);
    const base = f.y0 + f.h * (f.mobile ? 0.62 : 0.66);
    const byYear = new Map();
    for (const i of dots) {
      if (!byYear.has(Y[i])) byYear.set(Y[i], []);
      byYear.get(Y[i]).push(i);
    }
    let maxPer = 1;
    for (const v of byYear.values()) maxPer = Math.max(maxPer, v.length);
    const colW = (ax1 - ax0) / span;
    const pitch = Math.max(2, Math.min(colW * 1.25, 22, (base - f.y0 - 86) / maxPer));
    const rad = Math.min(dotR(pitch) * 1.05, colW * 0.42);
    hideAll();
    for (const [yr, list] of byYear) {
      list.sort((u, v) => (bySwede(v) - bySwede(u)) || (byLaureate(v) - byLaureate(u)) || (u - v));
      list.forEach((i, j) => {
        const mk = (byLaureate(i) ? 1 : 0) | (bySwede(i) ? 2 : 0);
        setDot(i, xOf(yr), base - pitch * (j + 0.5), rad, counted(i) ? dotColor(i) : pal.slate, counted(i) ? 1 : 0.35, mk);
        delay[i] = (yr - FIRST) * 8;
      });
    }
    let html = "", lines = "";
    for (let yr = Math.ceil(y0 / 5) * 5; yr <= y1; yr += 5) {
      html += lab(xOf(yr), base + 8, "lab--axis lab--center", yr % 10 === 0 || colW > 14 ? yr : "", "c");
      lines += line(xOf(yr), base, xOf(yr), base + 4, css(pal.rule));
    }
    lines += line(ax0, base + 0.5, ax1, base + 0.5, css(pal.rule));
    const status = p.won ? `Won the ${D.label.toLowerCase()} prize, ${p.won}` : `Never won the ${D.label.toLowerCase()} prize`;
    const life = p.birth ? ` · ${p.birth}–${p.death || ""}` : "";
    html += `<div class="profile-head" style="left:${f.x0}px;top:${f.y0 - 4}px">${esc(p.name)}<small>${status}${life}</small></div>`;
    const spanTxt = ne.first === ne.last ? `${ne.first}` : `${ne.first}–${String(ne.last).slice(2)}`;
    const stats = [
      [fmt(ne.nomsAll), "nominations"], [fmt(ne.backers), "different backers"], [fmt(ne.laureates), "of them laureates"],
      [fmt(ne.swedes), "of them in Sweden"], [fmt(ne.countries), "countries"], [spanTxt, `${ne.years} separate years`],
    ];
    html += `<div class="statrow" style="left:${f.x0}px;top:${base + 34}px;width:${f.w}px">${stats.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div>`;
    if (opts.extra) html += opts.extra(xOf, base, pitch);
    return { html, lines, xOf, base, pitch };
  }

  // ------------------------------------------------------------------ scenes
  const scenes = {};

  function medalLayout(cx, cy, R0, outro) {
    const order = [...Array(N).keys()].sort((p, q) => (Y[p] - Y[q]) || (p - q));
    const pitch = Math.sqrt((Math.PI * R0 * R0) / N) * 0.98;
    const rad = dotR(pitch) * 1.08;
    const light = [-0.55, -0.65];
    order.forEach((i, j) => {
      const t = (j + 0.5) / N;
      const rr = R0 * Math.sqrt(t), th = j * GOLDEN;
      const u = (rr * Math.cos(th)) / R0, v = (rr * Math.sin(th)) / R0;
      const rho = Math.hypot(u, v);
      let relief = 0.5 + 0.32 * (u * light[0] + v * light[1]);
      if (rho > 0.9) relief = 0.86 - (rho - 0.9) * 3;
      else if (rho > 0.84) relief = 0.22;
      else {
        let orbit = 1e9;
        for (const ang of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
          const c = Math.cos(-ang), s = Math.sin(-ang);
          const pu = u * c - v * s, pv = u * s + v * c;
          const d = Math.abs(Math.hypot(pu / 0.6, pv / 0.21) - 1) * 0.21;
          orbit = Math.min(orbit, d);
        }
        if (orbit < 0.028) relief = 0.95;
        else if (orbit < 0.05) relief = Math.min(relief, 0.3);
        if (rho < 0.085) relief = 0.98;
        else if (rho < 0.11) relief = 0.28;
      }
      relief = Math.max(0, Math.min(1, relief));
      const col = relief < 0.5 ? mix(pal.goldLo, pal.gold, relief * 2) : mix(pal.gold, pal.goldHi, (relief - 0.5) * 2);
      setDot(i, cx + u * R0, cy + v * R0, rad, col, 1, 0);
      delay[i] = outro ? (1 - rho) * 500 : 0;
    });
  }

  scenes.medal = {
    enter() {
      const f = frame();
      const R0 = Math.min(W * (f.mobile ? 0.42 : 0.3), H * 0.36);
      // sit the medal just under the masthead (it peeks up from the bottom on small screens)
      const mast = document.querySelector(".masthead");
      const mastBottom = mast ? mast.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + window.scrollY * 0 : H * 0.5;
      const cy = Math.max(H * 0.62, mastBottom + R0 + 22);
      medalLayout(W / 2, cy, R0);
      setLegend([]);
      return { html: "", lines: "" };
    },
    tip: () => null,
  };
  scenes.outro = {
    enter() {
      const R0 = Math.min(W * 0.32, H * 0.3);
      medalLayout(W / 2, H * 0.62, R0, true);
      setLegend([]);
      return { html: "", lines: "" };
    },
    tip: () => null,
  };

  function yearColumns(f, opts = {}) {
    const ax0 = f.x0 + (f.mobile ? 26 : 38), ax1 = f.x1;
    const colW = (ax1 - ax0) / years.length;
    let maxCount = 0;
    for (const yr of years) maxCount = Math.max(maxCount, (yearIdx.get(yr) || []).length);
    const plotH = f.h - 18;
    let best = { pitch: 0, k: 1 };
    for (let k = 1; k <= 4; k++) {
      const p = Math.min((colW * 0.9) / k, (plotH * k) / maxCount);
      if (p > best.pitch) best = { pitch: p, k };
    }
    const { k } = best;
    // columns may be taller than they are wide: vertical spacing can stretch to fill the height
    const px = (colW * 0.9) / k;
    const py = Math.min((plotH * k) / maxCount, px * 1.5);
    const pitch = Math.min(px, py);
    const rad = dotR(pitch);
    const xOf = (yr) => ax0 + (yr - FIRST + 0.5) * colW;
    const yOfCount = (v) => f.y1 - (v / k) * py;
    return { ax0, ax1, colW, pitch, px, py, k, rad, xOf, yOfCount, maxCount };
  }

  scenes.years = {
    enter() {
      const f = frame();
      const yc = yearColumns(f);
      for (const yr of years) {
        (yearIdx.get(yr) || []).forEach((i, j) => {
          const col = j % yc.k, row = Math.floor(j / yc.k);
          setDot(i, yc.xOf(yr) + (col - (yc.k - 1) / 2) * yc.px, f.y1 - (row + 0.5) * yc.py, yc.rad, dotColor(i), 1, 0);
          delay[i] = (yr - FIRST) * 13 + row * 1.2;
        });
      }
      let html = "", lines = "";
      for (let v = 50; v <= yc.maxCount; v += 50) {
        const yy = yc.yOfCount(v);
        lines += line(yc.ax0, yy, f.x1, yy, css(pal.rule), 1);
        html += lab(yc.ax0 - 6, yy, "lab--axis lab--right", v, "rm");
      }
      html += lab(yc.ax0, f.y0 - 2, "lab--muted", "Nominations per year ↑", "b");
      const ax = yearAxis(f, yc.xOf);
      html += ax.html; lines += ax.lines;
      html += `<div class="lab lab--big" id="yr-ticker" style="left:50%;top:${f.y0 + 4}px;transform:translateX(-50%)"></div>`;
      setLegend([LEG.won, LEG.never]);
      const tick = document.createElement("div");
      onFrame = (p) => {
        const el = document.getElementById("yr-ticker");
        if (!el) return;
        const upto = Math.min(LAST, FIRST + Math.floor(p * (LAST - FIRST + 1.2)));
        let n = 0;
        for (let yr = FIRST; yr <= upto; yr++) n += (yearIdx.get(yr) || []).length;
        el.innerHTML = `${FIRST}–${upto} <span class="lab--muted" style="font:400 14px var(--f-ui)">${fmt(n)} nominations</span>`;
      };
      void tick;
      return { html, lines };
    },
    tip: tipNomination,
  };

  scenes["year-names"] = {
    enter() {
      const f = frame("right");
      const yc = yearColumns(f);
      const focus = [ST.quietest_year, ST.busiest_year];
      let html = "", lines = "";
      for (const yr of years) {
        const list = (yearIdx.get(yr) || []).slice();
        const on = focus.includes(yr);
        if (on) {
          const groups = new Map();
          for (const i of list) { if (!groups.has(E[i])) groups.set(E[i], []); groups.get(E[i]).push(i); }
          const ordered = [...groups.entries()].sort((p, q) => q[1].length - p[1].length || (people[p[0]].name < people[q[0]].name ? -1 : 1));
          let j = 0;
          const marks = [];
          for (const [pi, idxs] of ordered) {
            const startRow = Math.floor(j / yc.k);
            for (const i of idxs) {
              const col = j % yc.k, row = Math.floor(j / yc.k);
              setDot(i, yc.xOf(yr) + (col - (yc.k - 1) / 2) * yc.px, f.y1 - (row + 0.5) * yc.py, yc.rad, dotColor(i), 1, 0);
              delay[i] = 0; j++;
            }
            const endRow = Math.floor((j - 1) / yc.k);
            marks.push({ pi, n: idxs.length, y: f.y1 - ((startRow + endRow) / 2 + 0.5) * yc.py, star: people[pi].won === yr });
          }
          // labels beside the column: everyone in a quiet year, repeat nominees in a busy one
          const left = yr > (FIRST + LAST) / 2;
          const gapY = f.mobile ? 11 : 12.5;
          const minY = f.y0 + 74;
          let minN = f.mobile ? (yr === ST.busiest_year ? 3 : 99) : 1, shown = marks.filter((m) => m.n >= minN);
          while (shown.length * gapY > f.y1 - minY - 16 && minN < 50) { minN++; shown = marks.filter((m) => m.n >= minN); }
          const rest = marks.length - shown.length;
          // spread labels so they don't collide, keeping each near its group
          shown.sort((p, q) => q.y - p.y);
          let prev = Infinity;
          for (const m of shown) { m.ly = Math.min(m.y, prev - gapY); prev = m.ly; }
          if (shown.length && shown[shown.length - 1].ly < minY) {
            let next = minY - gapY;
            for (let q = shown.length - 1; q >= 0; q--) { shown[q].ly = Math.max(shown[q].ly, next + gapY); next = shown[q].ly; }
          }
          const lx = yc.xOf(yr) + (left ? -1 : 1) * (yc.k * yc.px / 2 + 16);
          for (const m of shown) {
            const t = `${esc(people[m.pi].short)} · ${m.n}${m.star ? '<i class="st"></i>' : ""}`;
            html += lab(lx + (left ? -2 : 2), m.ly, "lab--sm" + (left ? " lab--right" : ""), t, left ? "rm" : "m");
            lines += line(yc.xOf(yr) + (left ? -1 : 1) * (yc.k * yc.px / 2 + 2), m.y, lx, m.ly, css(pal.ink3), 0.6);
          }
          const colTop = f.y1 - Math.ceil(list.length / yc.k) * yc.py;
          const topY = Math.min(colTop, shown.length ? shown[shown.length - 1].ly : f.y1) - 14;
          if (rest > 0 && shown.length) html += lab(lx + (left ? -2 : 2), topY, "lab--sm lab--muted" + (left ? " lab--right" : ""), `${rest} more with ${minN - 1 === 1 ? "one nomination" : `${minN - 1} or fewer`} each`, left ? "rm" : "m");
          const head = `${yr}<br><span class="lab--muted">${marks.length} names · ${list.length} nominations</span>`;
          if (!shown.length) {
            // a year whose names aren't listed: label it beside the column, away from the busy year's list
            html += lab(yc.xOf(yr) - yc.k * yc.px / 2 - 6, colTop - 4, "lab--strong lab--right", head, "rb");
          } else {
            const headX = left ? Math.min(yc.xOf(yr), f.x1 - 70) : yc.xOf(yr);
            html += lab(headX, Math.min(topY - (rest > 0 ? 12 : 4), colTop - 8), "lab--strong lab--center", head, "cb");
          }
        } else {
          list.forEach((i, j) => {
            const col = j % yc.k, row = Math.floor(j / yc.k);
            setDot(i, yc.xOf(yr) + (col - (yc.k - 1) / 2) * yc.px, f.y1 - (row + 0.5) * yc.py, yc.rad, dotColor(i), 0.13, 0);
            delay[i] = 0;
          });
        }
      }
      const ax = yearAxis(f, yc.xOf);
      html += ax.html; lines += ax.lines;
      setLegend([LEG.won, LEG.never, ["star", "Won the prize that year"]]);
      return { html, lines };
    },
    tip: tipNomination,
  };

  scenes["bins-noms"] = {
    enter() {
      const f = frame();
      const s = binScene(f, [
        { label: f.mobile ? "1" : "1 nomination", test: (n) => n.noms === 1 },
        { label: "2–4", test: (n) => n.noms >= 2 && n.noms <= 4 },
        { label: "5–9", test: (n) => n.noms >= 5 && n.noms <= 9 },
        { label: "10–19", test: (n) => n.noms >= 10 && n.noms <= 19 },
        { label: "20 or more", test: (n) => n.noms >= 20 },
      ], { caption: "Nominations received →" });
      setLegend([LEG.won, LEG.never, LEG.cluster]);
      return s;
    },
    tip: tipNominee,
  };

  scenes["swarm-backers"] = {
    enter() {
      const f = frame();
      const items = [];
      let maxB = 1;
      for (const ne of NE.values()) {
        if (ne.noms <= 0) continue;
        const dots = byNominee.get(ne.i).filter(counted);
        items.push({ p: ne.i, dots, n: dots.length, won: people[ne.i].won > 0, b: ne.backers });
        maxB = Math.max(maxB, ne.backers);
      }
      items.sort((p, q) => p.p - q.p);
      const ax0 = f.x0 + (f.mobile ? 56 : 110), ax1 = f.x1 - 16;
      const lo = 0.62, hi = maxB * 1.08;
      const lx = (b) => ax0 + (Math.log(b / lo) / Math.log(hi / lo)) * (ax1 - ax0);
      // each whole number of backers is spread across its band so piles don't stack in one column
      const seen = new Map();
      const spread = (it) => {
        const k = seen.get(it.b) || 0; seen.set(it.b, k + 1);
        const u = ((k * 0.618034) % 1) - 0.5;
        return lx(it.b + u * 0.76);
      };
      const rows = [
        { won: false, label: "Never won", cy: f.y0 + 40 + (f.h - 40) * 0.3, half: (f.h - 40) * 0.3 },
        { won: true, label: "Won", cy: f.y0 + 40 + (f.h - 40) * 0.8, half: (f.h - 40) * 0.2 },
      ];
      for (const it of items) it.sx = spread(it);
      const sets = rows.map((rw) => items.filter((it) => it.won === rw.won));
      const pitch = fitPitch((p) => rows.every((rw, k) => {
        const its = sets[k].map((it) => ({ x: it.sx, R: clusterR(it.n, p) }));
        return dodge(its, p * 0.25) <= rw.half;
      }), 6, 0.9);
      hideAll();
      const rad = dotR(pitch);
      rows.forEach((rw, k) => {
        const its = sets[k].map((it) => ({ ...it, x: it.sx, R: clusterR(it.n, pitch) }));
        dodge(its, pitch * 0.25);
        for (const it of its) {
          const offs = sunflower(it.n, pitch);
          it.dots.forEach((i, j) => { setDot(i, it.x + offs[j][0], rw.cy + it.y + offs[j][1], rad, dotColor(i)); delay[i] = 0; });
        }
      });
      let html = "", lines = "";
      for (const rw of rows) html += lab(f.x0, rw.cy, "lab--strong", rw.label, "m");
      for (const t of [1, 2, 5, 10, 20, 50, 100]) {
        if (t > maxB * 1.05) continue;
        html += lab(lx(t), f.y1 + 8, "lab--axis lab--center", t, "c");
      }
      html += lab((ax0 + ax1) / 2, f.y1 + 26, "lab--muted lab--center", "Different people who nominated them →", "c");
      lines += line(ax0, f.y1 + 0.5, ax1, f.y1 + 0.5, css(pal.rule));
      const tx10 = lx(10);
      lines += line(tx10, f.y0 + 26, tx10, f.y1, css(pal.accent), 1.2, "4 3");
      const b = ST.backers_10;
      html += lab(tx10 - 8, f.y0 + 28, "lab--sm lab--right", `Fewer than 10 backers: <b>${b.below.pct}% won</b>`, "r");
      html += lab(tx10 + 8, f.y0 + 28, "lab--sm", `10 or more: <b>${b.atleast.pct}% won</b>`);
      html += lab(tx10, f.y0 + 12, "lab--sm lab--accent lab--center", "Ten backers", "c");
      setLegend([LEG.won, LEG.never, LEG.cluster]);
      return { html, lines };
    },
    tip: tipNominee,
  };

  scenes["bins-countries"] = {
    enter() {
      const f = frame();
      const s = binScene(f, [
        { label: "1 country", test: (n) => n.countries <= 1 },
        { label: "2 or 3", test: (n) => n.countries >= 2 && n.countries <= 3 },
        { label: "4 or more", test: (n) => n.countries >= 4 },
      ], { caption: "Countries their nominations came from →" });
      setLegend([LEG.won, LEG.never, LEG.cluster]);
      return s;
    },
    tip: tipNominee,
  };

  scenes["bins-swedish"] = {
    enter() {
      const f = frame();
      const s = binScene(f, [
        { label: "No backer in Sweden", test: (n) => n.swedes === 0 },
        { label: "At least one backer in Sweden", test: (n) => n.swedes > 0 },
      ], { mark: (i) => (bySwede(i) ? 2 : 0) });
      setLegend([LEG.won, LEG.never, ["flag", "Nomination sent from Sweden"]]);
      return s;
    },
    tip: tipNominee,
  };

  scenes["bins-laureates"] = {
    enter() {
      const f = frame();
      const s = binScene(f, [
        { label: "No laureate backer", test: (n) => n.laureates === 0 },
        { label: "1 laureate backer", test: (n) => n.laureates === 1 },
        { label: "2 or more", test: (n) => n.laureates >= 2 },
      ], { mark: (i) => (byLaureate(i) ? 1 : 0) });
      setLegend([LEG.won, LEG.never, ["ring", "Nominated by a Nobel laureate"]]);
      return s;
    },
    tip: tipNominee,
  };

  const meets = (n) => n.noms >= 10 && n.backers >= 10 && n.laureates >= 2 && n.countries >= 4 && n.swedes >= 1;
  scenes.fit = {
    enter() {
      const f = frame();
      const s = binScene({ ...f, x0: f.x0 + f.w * (f.mobile ? 0.04 : 0.22), x1: f.x1 - f.w * (f.mobile ? 0.04 : 0.22), w: f.w * (f.mobile ? 0.92 : 0.56) }, [
        { label: "Met all five conditions", test: meets },
      ], { maxPitch: 13, headroom: 60 });
      s.html += lab((f.x0 + f.x1) / 2, f.y1 + 26, "lab--muted lab--center", "At least 10 nominations · 10 backers · 4 countries · 2 laureates · 1 in Sweden", "c");
      setLegend([LEG.won, LEG.never, LEG.cluster]);
      return s;
    },
    tip: tipNominee,
  };

  const overlookedRows = () => ST.overlooked.map((o) => {
    const p = people[o.i];
    const medal = p.other.length ? ' <i class="md"></i>' : "";
    return { p: o.i, dots: byNominee.get(o.i).filter(counted), label: `${esc(p.short)}${medal}` };
  });
  scenes.overlooked = {
    enter() {
      const f = frame("right");
      const rows = overlookedRows();
      const s = barRows(f, rows);
      s.html += lab(f.x0 + labelCol(f, rows.map((r2) => r2.label)) + 12, f.y0 - 4, "lab--muted", "Nominations received →", "b");
      setLegend([LEG.never, ["medal", "Won a Nobel Prize in another field"]]);
      return { html: s.html, lines: "" };
    },
    tip: tipNomination,
  };

  scenes.ran = {
    enter() {
      const f = frame("right");
      const rows = overlookedRows().map((rw) => {
        const ne = NE.get(rw.p);
        return { ...rw, sub: `${ne.years} years · ${ne.first}–${ne.last}` };
      });
      const s = timelineRows(f, rows);
      setLegend([LEG.never, ["slate", "Larger cluster = more nominations that year"]]);
      return s;
    },
    tip: tipNomination,
  };

  scenes.sommerfeld = {
    enter() {
      const f = frame("right");
      const s = profile(f, FOCUS["Arnold Sommerfeld"]);
      setLegend([LEG.never, ["ring", "From a Nobel laureate"], ["flag", "From Sweden"]]);
      return s;
    },
    tip: tipNomination,
  };

  scenes.einstein = {
    enter() {
      const f = frame("right");
      const pi = FOCUS["Albert Einstein"];
      const s = profile(f, pi, {
        extra: (xOf, base, pitch) => {
          let h = "";
          h += lab(xOf(1910), base - pitch * 1.6, "lab--sm lab--right", "1910: first nomination,<br>from Wilhelm Ostwald", "rb");
          const n22 = byNominee.get(pi).filter((i) => Y[i] === 1922).length;
          h += lab(xOf(1922), base - pitch * (n22 + 0.8), "lab--sm lab--center", '1922: awarded<br>the reserved 1921 prize<i class="st"></i>', "cb");
          return h;
        },
      });
      setLegend([LEG.won, ["ring", "From a Nobel laureate"], ["flag", "From Sweden"], ["slate", "Faded: sent after the prize"]]);
      return s;
    },
    tip: tipNomination,
  };

  scenes.meitner = {
    enter() {
      const f = frame("right");
      const s = profile(f, FOCUS["Lise Meitner"]);
      setLegend([LEG.never, ["ring", "From a Nobel laureate"], ["flag", "From Sweden"]]);
      return s;
    },
    tip: tipNomination,
  };

  scenes.spin = {
    enter() {
      const f = frame("right");
      const gi = FOCUS["Samuel Abraham Goudsmit"], ui = FOCUS["George Eugene Uhlenbeck"];
      const ax0 = f.x0 + (f.mobile ? 4 : 120), ax1 = f.x1 - 4;
      const yA = 1931, yB = LAST;
      const xOf = (yr) => ax0 + ((yr - yA + 0.5) / (yB - yA + 1)) * (ax1 - ax0);
      const mid = f.y0 + f.h * 0.5;
      const gapHalf = Math.max(26, f.h * 0.08);
      const yG = mid - gapHalf, yU = mid + gapHalf;
      const letterOf = (i) => L[i];
      const gDots = byNominee.get(gi), uDots = byNominee.get(ui);
      const uLetters = new Set(uDots.map(letterOf)), gLetters = new Set(gDots.map(letterOf));
      const colW = (ax1 - ax0) / (yB - yA + 1);
      const maxPer = 13;
      const pitch = Math.max(2, Math.min(colW * 0.9, 8, (yG - f.y0 - 40) / maxPer));
      const rad = dotR(pitch) * 1.05;
      hideAll();
      const pos = new Map();
      const place = (dots, base, dir, partnerLetters) => {
        const byYear = new Map();
        for (const i of dots) { if (!byYear.has(Y[i])) byYear.set(Y[i], []); byYear.get(Y[i]).push(i); }
        for (const [yr, list] of byYear) {
          list.sort((p, q) => (partnerLetters.has(L[q]) - partnerLetters.has(L[p])) || (L[p] - L[q]));
          list.forEach((i, j) => {
            const px = xOf(yr), py = base + dir * pitch * (j + 0.5);
            setDot(i, px, py, rad, dotColor(i), 1, (byLaureate(i) ? 1 : 0) | (bySwede(i) ? 2 : 0));
            delay[i] = (yr - FIRST) * 8;
            pos.set(i, [px, py]);
          });
        }
      };
      place(gDots, yG, -1, uLetters);
      place(uDots, yU, 1, gLetters);
      let lines = "", html = "";
      const uByLetter = new Map();
      for (const i of uDots) uByLetter.set(L[i], i);
      for (const i of gDots) {
        const j = uByLetter.get(L[i]);
        if (j === undefined) continue;
        const [x1, y1] = pos.get(i), [x2, y2] = pos.get(j);
        lines += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + 5).toFixed(1)},${mid.toFixed(1)} ${(x2 + 5).toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${css(pal.ink3)}" stroke-width="0.7" opacity="0.55"/>`;
      }
      const ng = NE.get(gi), nu = NE.get(ui);
      html += lab(ax0 - 10, yG - 4, "lab--strong lab--right", "Samuel Goudsmit", f.mobile ? "b" : "rb");
      html += lab((ax0 + ax1) / 2, f.y0 + 4, "lab--muted lab--center", "Each dot is one nomination; joint letters are linked", "c");
      html += lab(ax0 - 10, yG + 10, "lab--sm lab--muted lab--right", `${ng.nomsAll} nominations, ${ng.backers} backers`, f.mobile ? "" : "r");
      html += lab(ax0 - 10, yU + 4, "lab--strong lab--right", "George Uhlenbeck", f.mobile ? "" : "r");
      html += lab(ax0 - 10, yU + 18, "lab--sm lab--muted lab--right", `${nu.nomsAll} nominations, ${nu.backers} backers`, f.mobile ? "" : "r");
      lines += line(ax0, yG, ax1, yG, css(pal.rule)) + line(ax0, yU, ax1, yU, css(pal.rule));
      for (let yr = 1935; yr <= LAST; yr += 5) html += lab(xOf(yr), f.y1 + 8, "lab--axis lab--center", yr, "c");
      lines += line(ax0, f.y1 + 0.5, ax1, f.y1 + 0.5, css(pal.rule));
      setLegend([LEG.never, ["ring", "From a Nobel laureate"], ["line", "Same letter"]]);
      return { html, lines };
    },
    tip: tipNomination,
  };

  scenes.women = {
    enter() {
      const f = frame("right");
      const women = [...NE.values()].filter((n) => people[n.i].gender === "F").sort((p, q) => q.nomsAll - p.nomsAll);
      const rows = women.map((n) => {
        const p = people[n.i];
        const other = p.other.length ? ' <i class="md"></i>' : "";
        return { p: n.i, dots: byNominee.get(n.i), label: `${esc(p.short)}${other}`, sub: `${n.nomsAll} nomination${n.nomsAll === 1 ? "" : "s"}${p.won ? `, won ${p.won}` : ""}`, star: p.won || 0 };
      });
      const s = timelineRows(f, rows);
      setLegend([LEG.won, LEG.never, ["star", "Won the physics prize"], ["medal", "Won the chemistry prize"]]);
      return s;
    },
    tip: tipNomination,
  };

  scenes["women-writers"] = {
    enter() {
      const f = frame("right");
      const writers = [...NR.values()].filter((n) => people[n.i].gender === "F").sort((p, q) => q.noms - p.noms || (people[p.i].name < people[q.i].name ? -1 : 1));
      const rows = writers.map((n) => {
        const dots = byNominator.get(n.i).slice().sort((p, q) => Y[p] - Y[q]);
        const picks = [...new Set(dots.map((i) => people[E[i]].short))];
        return { p: n.i, dots, label: esc(people[n.i].short), after: `→ ${esc(picks.join(", "))}` };
      });
      const s = barRows(f, rows);
      setLegend([["gold", "Nominee went on to win"], ["slate", "Nominee never won"]]);
      return { html: s.html, lines: "" };
    },
    tip: tipNomination,
  };

  function writerBins(f, bins, colorOf, opts = {}) {
    const groups = bins.map((b) => ({ ...b, cl: [] }));
    for (const nr of NR.values()) {
      const gi = groups.findIndex((b) => b.test(nr));
      if (gi < 0) continue;
      const dots = byNominator.get(nr.i).slice().sort((p, q) => goldDot(q) - goldDot(p));
      groups[gi].cl.push({ p: nr.i, dots, n: dots.length });
    }
    for (const g of groups) g.cl.sort((p, q) => q.n - p.n || p.p - q.p);
    const gap = f.mobile ? 10 : 24;
    const weights = groups.map((g) => Math.sqrt(g.cl.reduce((s, c) => s + c.n, 0)) + 8);
    const wsum = weights.reduce((s, v) => s + v, 0);
    const avail = f.w - gap * (groups.length - 1);
    let cursor = f.x0;
    for (let k = 0; k < groups.length; k++) { groups[k].x0 = cursor; groups[k].w = Math.max(28, (avail * weights[k]) / wsum); cursor += groups[k].w + gap; }
    const base = f.y1, top = f.y0 + 44;
    const pitch = fitPitch((p) => groups.every((g) => { for (const c of g.cl) c.R = clusterR(c.n, p); return packRows(g.cl, g.x0, g.w, base, p * 0.4, true) <= base - top; }), 6.5);
    hideAll();
    const rad = dotR(pitch);
    let html = "", lines = "";
    for (const g of groups) {
      for (const c of g.cl) c.R = clusterR(c.n, pitch);
      const h = packRows(g.cl, g.x0, g.w, base, pitch * 0.4, false);
      for (const c of g.cl) {
        const offs = sunflower(c.n, pitch);
        c.dots.forEach((i, j) => { setDot(i, c.cx + offs[j][0], c.cy + offs[j][1], rad, colorOf(i, c)); delay[i] = 0; });
      }
      const nd = g.cl.reduce((s, c) => s + c.n, 0);
      const [ax, an, cl2] = edgeAnchor(g, groups);
      const noun = g.cl.length === 1 ? "person" : "people";
      const headTxt = g.w < 70 ? `${fmt(g.cl.length)}<small>${noun}</small>` : `${fmt(g.cl.length)} ${noun}<small>${opts.sub ? opts.sub(g, nd) : `${fmt(nd)} nominations`}</small>`;
      html += lab(ax, base - h - 6, `lab--pct ${cl2}`, headTxt, `${an}b`);
      html += lab(ax, base + 8, `lab--axis ${cl2}`, esc(g.label), an);
    }
    if (opts.caption) html += lab((f.x0 + f.x1) / 2, base + 26, "lab--muted lab--center", esc(opts.caption), "c");
    lines += line(f.x0, base + 0.5, f.x1, base + 0.5, css(pal.rule));
    return { html, lines, groups, pitch };
  }

  scenes.gender = {
    enter() {
      const f = frame();
      const s = writerBins(f, [
        { label: f.mobile ? "Women" : "Recorded as women", test: (n) => people[n.i].gender === "F" },
        { label: f.mobile ? "Men" : "Recorded as men", test: (n) => people[n.i].gender === "M" },
        { label: f.mobile ? "Not recorded" : "No gender recorded", test: (n) => !people[n.i].gender },
      ], (i) => (people[R[i]].gender === "F" ? pal.accent : people[R[i]].gender === "M" ? pal.men : pal.slate),
      { caption: "What the archive records about the people who nominated" });
      setLegend([["accent", "Women"], ["men", "Men"], ["slate", "Not recorded"], ["cluster", "One cluster per nominator"]]);
      return s;
    },
    tip: tipNominator,
  };

  // bounding box of every dot on the map, in map units
  const mapBox = (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of Object.values(MAP.countries)) {
      x0 = Math.min(x0, g.x + g.box[0]); y0 = Math.min(y0, g.y + g.box[1]);
      x1 = Math.max(x1, g.x + g.box[2]); y1 = Math.max(y1, g.y + g.box[3]);
    }
    return { x0, y0, x1, y1 };
  })();
  scenes.map = {
    enter() {
      const f = frame("left");
      const top = f.y0 + 26, bottom = f.y1 - 4;
      const bw = mapBox.x1 - mapBox.x0, bh = mapBox.y1 - mapBox.y0;
      const s2 = Math.min(f.w / bw, (bottom - top) / bh);
      const ox = f.x0 + (f.w - bw * s2) / 2 - mapBox.x0 * s2, oy = top + (bottom - top - bh * s2) / 2 - mapBox.y0 * s2;
      const pitch = MAP.pitch * s2;
      const rad = dotR(pitch);
      hideAll();
      const byCountry = new Map();
      for (let i = 0; i < N; i++) {
        if (C[i] < 0) continue;
        if (!byCountry.has(C[i])) byCountry.set(C[i], []);
        byCountry.get(C[i]).push(i);
      }
      const shapes = [];
      for (const [ci, list] of byCountry) {
        const geo = MAP.countries[ci];
        if (!geo) continue;
        list.sort((p, q) => (goldDot(q) - goldDot(p)) || (p - q));
        list.forEach((i, j) => {
          const d = geo.dots[j];
          setDot(i, ox + (geo.x + d[0]) * s2, oy + (geo.y + d[1]) * s2, rad, dotColor(i));
          delay[i] = 0;
        });
        const bx = [ox + (geo.x + geo.box[0]) * s2, oy + (geo.y + geo.box[1]) * s2, ox + (geo.x + geo.box[2]) * s2, oy + (geo.y + geo.box[3]) * s2];
        shapes.push({ ci, geo, list, bx });
      }
      // labels: biggest countries first; try above, below, right, left of the shape,
      // rejecting spots that would cover another country's dots or another label
      const placed = [];
      const cell = 12, grid = new Map();
      for (const sh of shapes) for (const i of sh.list) {
        const k = `${Math.floor(tx[i] / cell)},${Math.floor(ty[i] / cell)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
      const covers = (b, own) => {
        for (let gx = Math.floor(b[0] / cell); gx <= Math.floor(b[2] / cell); gx++) {
          for (let gy = Math.floor(b[1] / cell); gy <= Math.floor(b[3] / cell); gy++) {
            for (const i of grid.get(`${gx},${gy}`) || []) {
              if (C[i] === own) continue;
              if (tx[i] > b[0] - 2 && tx[i] < b[2] + 2 && ty[i] > b[1] - 2 && ty[i] < b[3] + 2) return true;
            }
          }
        }
        return false;
      };
      const hits = (b, own) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) || covers(b, own);
      let html = "";
      const minLabel = f.mobile ? 90 : 30;
      shapes.sort((p, q) => q.list.length - p.list.length);
      for (const sh of shapes) {
        if (sh.list.length < minLabel) continue;
        const cand = new Set(sh.list.filter(counted).map((i) => E[i]));
        const won = [...cand].filter((p) => people[p].won > 0).length;
        const name = sh.geo.name === "United States" && f.mobile ? "US" : sh.geo.name === "United Kingdom" && f.mobile ? "UK" : sh.geo.name;
        const sub = `${fmt(sh.list.length)} · ${Math.round((100 * won) / cand.size)}% won`;
        const w = Math.max(name.length * 6.6, sub.length * 5.6) + 6, h = 28;
        const cx = (sh.bx[0] + sh.bx[2]) / 2, cy = (sh.bx[1] + sh.bx[3]) / 2;
        const opts = [
          [cx - w / 2, sh.bx[1] - h - 2], [cx - w / 2, sh.bx[3] + 2],
          [sh.bx[2] + 4, cy - h / 2], [sh.bx[0] - w - 4, cy - h / 2],
          [sh.bx[2] + 2, sh.bx[1] - h], [sh.bx[0] - w - 2, sh.bx[1] - h],
        ];
        let at = null;
        for (const [lx2, ly2] of opts) {
          const b = [lx2, ly2, lx2 + w, ly2 + h];
          if (b[0] < 4 || b[2] > W - 4 || b[1] < f.y0 + 6 || b[3] > H - 4) continue;
          if (!hits(b, sh.ci)) { at = b; break; }
        }
        if (!at && sh.list.length >= 80) {
          // big countries can carry their label on top of their own dots
          const b = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
          if (!placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) at = b;
        }
        if (!at) continue;
        placed.push(at);
        html += lab(at[0] + w / 2, at[1], "lab--sm lab--center lab--halo", `<b>${esc(name)}</b><br><span class="lab--muted">${sub}</span>`, "c");
      }
      html += `<div class="lab lab--muted lab--wrap" style="left:${f.x0}px;top:${f.y0 - 4}px;width:${f.w}px;transform:translateY(-100%)">Where nominations were sent from, by today's borders. Labels: nominations · share of nominees who won</div>`;
      setLegend([LEG.won, LEG.never]);
      return { html, lines: "" };
    },
    tip: tipNomination,
  };

  scenes["bins-writers"] = {
    enter() {
      const f = frame();
      const s = writerBins(f, [
        { label: f.mobile ? "1" : "1 physicist", test: (n) => n.candidates === 1 },
        { label: "2–4", test: (n) => n.candidates >= 2 && n.candidates <= 4 },
        { label: "5–9", test: (n) => n.candidates >= 5 && n.candidates <= 9 },
        { label: "10 or more", test: (n) => n.candidates >= 10 },
      ], (i) => dotColor(i), { caption: "Different physicists each person nominated →" });
      setLegend([["gold", "Nominee went on to win"], ["slate", "Nominee never won"], ["cluster", "One cluster per nominator"]]);
      return s;
    },
    tip: tipNominator,
  };

  scenes.busiest = {
    enter() {
      const f = frame();
      const bt = ST.busiest_tenth;
      const bins = f.mobile ? [
        { label: "1", test: (n) => n.noms === 1 },
        { label: `2–${bt.min_noms - 1}`, test: (n) => n.noms >= 2 && n.noms < bt.min_noms },
        { label: `${bt.min_noms}–19`, test: (n) => n.noms >= bt.min_noms && n.noms <= 19 },
        { label: "20+", test: (n) => n.noms >= 20 },
      ] : [
        { label: "1", test: (n) => n.noms === 1 },
        { label: "2", test: (n) => n.noms === 2 },
        { label: "3", test: (n) => n.noms === 3 },
        { label: `4–${bt.min_noms - 1}`, test: (n) => n.noms >= 4 && n.noms < bt.min_noms },
        { label: `${bt.min_noms}–19`, test: (n) => n.noms >= bt.min_noms && n.noms <= 19 },
        { label: "20 or more", test: (n) => n.noms >= 20 },
      ];
      const s = writerBins(f, bins, (i) => dotColor(i), { caption: "Nominations each person wrote →" });
      const g = s.groups;
      const cut = bins.findIndex((b) => b.label.startsWith(`${bt.min_noms}–`));
      const xT = (g[cut - 1].x0 + g[cut - 1].w + g[cut].x0) / 2;
      s.lines += line(xT, f.y0 + 30, xT, f.y1, css(pal.accent), 1.2, "4 3");
      const hL = packRows(g[cut - 1].cl, g[cut - 1].x0, g[cut - 1].w, f.y1, s.pitch * 0.4, true);
      const hR = packRows(g[cut].cl, g[cut].x0, g[cut].w, f.y1, s.pitch * 0.4, true);
      if (hR < hL) {
        s.html += lab(xT + 8, f.y0 + 14, "lab--sm lab--accent", "← The busiest tenth starts here");
        s.html += lab(xT + 8, f.y0 + 30, "lab--sm lab--wrap", `${fmt(bt.people)} people wrote ${bt.share}% of all nominations`);
      } else {
        s.html += lab(xT - 8, f.y0 + 14, "lab--sm lab--accent lab--right", "The busiest tenth starts here →", "r");
        s.html += lab(xT - 8, f.y0 + 30, "lab--sm lab--right", `${fmt(bt.people)} people wrote ${bt.share}% of all nominations`, "r");
      }
      const franck = FOCUS["James Franck"];
      const cl = g[g.length - 1].cl.find((c) => c.p === franck);
      if (cl) {
        s.lines += `<circle cx="${cl.cx.toFixed(1)}" cy="${cl.cy.toFixed(1)}" r="${(cl.R + 4).toFixed(1)}" fill="none" stroke="${css(pal.accent)}" stroke-width="1.5"/>`;
        s.html += lab(cl.cx - cl.R - 8, cl.cy, "lab--sm lab--strong lab--right lab--halo", `James Franck<br><span class="lab--muted">${cl.n} nominations</span>`, "rm");
      }
      setLegend([["gold", "Nominee went on to win"], ["slate", "Nominee never won"], ["cluster", "One cluster per nominator"]]);
      return s;
    },
    tip: tipNominator,
  };

  scenes.professionals = {
    enter() {
      const f = frame("right");
      const rows = ST.top_nominators.slice(0, f.mobile ? 8 : 12).map((t) => {
        const p = people[t.i];
        const md = p.awards.length ? ' <i class="md"></i>' : "";
        return { p: t.i, dots: byNominator.get(t.i), label: `${esc(p.short)}${md}`, sub: `${t.noms} nominations · ${t.first}–${t.last}` };
      });
      const s = timelineRows(f, rows);
      setLegend([["gold", "Nominee went on to win"], ["slate", "Nominee never won"], ["medal", "Nominator was a Nobel laureate"]]);
      return s;
    },
    tip: tipNomination,
  };

  scenes.rights = {
    enter() {
      const f = frame();
      const labels = D.rights;
      const groups = labels.map((label, k) => ({ label, k, dots: [] }));
      for (let i = 0; i < N; i++) if (Y[i] < 1950) groups[G[i]].dots.push(i);
      const shown = groups.filter((g) => g.dots.length && g.k !== 6);
      const notRec = groups[6].dots;
      const total = shown.reduce((s2, g) => s2 + g.dots.length, 0) + notRec.length;
      shown.sort((p, q) => q.dots.length - p.dots.length);
      const gap = f.mobile ? 8 : 28;
      const colW = Math.min(f.mobile ? 999 : 150, (f.w - gap * (shown.length - 1)) / shown.length);
      const span = colW * shown.length + gap * (shown.length - 1);
      const startX = f.x0 + (f.w - span) / 2;
      const maxN = Math.max(...shown.map((g) => g.dots.length));
      const avH = f.h - 60;
      const pitch = fitPitch((p) => Math.ceil(maxN / Math.max(1, Math.floor(colW / p))) * p <= avH, 9);
      const perRow = Math.max(1, Math.floor(colW / pitch));
      const rad = dotR(pitch);
      hideAll();
      let html = "", lines = "";
      shown.forEach((g, k) => {
        const x0 = startX + k * (colW + gap);
        g.dots.sort((p, q) => goldDot(q) - goldDot(p) || p - q);
        g.dots.forEach((i, j) => {
          const col = j % perRow, row = Math.floor(j / perRow);
          setDot(i, x0 + (col + 0.5) * pitch + (colW - perRow * pitch) / 2, f.y1 - (row + 0.5) * pitch, rad, dotColor(i));
          delay[i] = 0;
        });
        const h = Math.ceil(g.dots.length / perRow) * pitch;
        html += lab(x0 + colW / 2, f.y1 - h - 6, "lab--pct lab--center", `${Math.round((100 * g.dots.length) / total)}%<small>${fmt(g.dots.length)}</small>`, "cb");
        const shortLabel = { "Invited professor": "Invited", "Academy member": "Academy", "Previous laureate": "Laureate",
          "Nobel Committee member": "Committee", "Nordic professor": "Nordic", "Specially invited": "Special" };
        html += lab(x0 + colW / 2, f.y1 + 8, "lab--axis lab--center", esc(f.mobile ? shortLabel[g.label] || g.label : g.label), "c");
      });
      html += lab((f.x0 + f.x1) / 2, f.y1 + 26, "lab--muted lab--center", `Nominations 1901–1949, by the nominator's right to nominate (${fmt(notRec.length)} not recorded)`, "c");
      lines += line(f.x0, f.y1 + 0.5, f.x1, f.y1 + 0.5, css(pal.rule));
      setLegend([["gold", "Nominee went on to win"], ["slate", "Nominee never won"]]);
      return { html, lines };
    },
    tip: tipNomination,
  };

  scenes["bins-top"] = {
    enter() {
      const f = frame();
      const s = binScene(f, [
        { label: "None", test: (n) => n.top === 0 },
        { label: "1", test: (n) => n.top === 1 },
        { label: "2 or 3", test: (n) => n.top >= 2 && n.top <= 3 },
        { label: "4 or more", test: (n) => n.top >= 4 },
      ], { caption: "Backers from the busiest tenth of nominators →" });
      setLegend([LEG.won, LEG.never, LEG.cluster]);
      return s;
    },
    tip: tipNominee,
  };

  scenes.pickers = {
    enter() {
      const f = frame("right");
      const names = ["Albert Einstein", "Léon Charles Prudent van Hove", "Gregor Wentzel", "Wolfgang Pauli", "Stefan Meyer"].concat(f.mobile ? [] : ["James Franck", "Max Planck"]);
      const rows = names.filter((nm) => FOCUS[nm] !== undefined).map((nm) => {
        const pi = FOCUS[nm];
        const dots = byNominator.get(pi).slice().sort((p, q) => (goldDot(q) - goldDot(p)) || (E[p] - E[q]) || (Y[p] - Y[q]));
        const nr = NR.get(pi);
        const label = nm === "Léon Charles Prudent van Hove" ? "Léon Van Hove" : people[pi].name;
        return { p: pi, dots, label: esc(label), after: `${nr.winners} of ${nr.candidates} picks won` };
      });
      const s = barRows(f, rows);
      s.html += lab(f.x0 + labelCol(f, rows.map((r2) => r2.label)) + 12, f.y0 - 4, "lab--muted", "Nominations they wrote →", "b");
      setLegend([["gold", "Nominee went on to win"], ["slate", "Nominee never won"]]);
      return { html: s.html, lines: "" };
    },
    tip: tipNomination,
  };

  // ------------------------------------------------------------------ tooltips
  function countryLabel(i) {
    if (C[i] < 0) return "country not recorded";
    const now = D.countries[C[i]], then = TH[i] >= 0 ? D.then[TH[i]] : now;
    return then && then !== now ? `${then} (today ${now})` : now;
  }
  function tipNomination(i) {
    const nee = people[E[i]], nor = people[R[i]];
    const won = nee.won ? `<span class="t-won">Won the ${D.label.toLowerCase()} prize, ${nee.won}</span>` : `Never won the ${D.label.toLowerCase()} prize`;
    const after = counted(i) ? "" : '<br><span class="t-sub">Sent after their own prize was announced</span>';
    return `<b>${esc(nee.name)}</b>, ${Y[i]}<br>Nominated by ${esc(nor.name)}${byLaureate(i) ? " (laureate)" : ""}<br><span class="t-sub">from ${esc(countryLabel(i))}</span><br>${won}${after}`;
  }
  function tipNominee(i) {
    const p = people[E[i]], ne = NE.get(E[i]);
    const won = p.won ? `<span class="t-won">Won the ${D.label.toLowerCase()} prize, ${p.won}</span>` : `Never won the ${D.label.toLowerCase()} prize`;
    return `<b>${esc(p.name)}</b><br>${fmt(ne.noms)} nominations from ${fmt(ne.backers)} people in ${fmt(ne.countries)} ${ne.countries === 1 ? "country" : "countries"}<br><span class="t-sub">${ne.laureates} laureate backer${ne.laureates === 1 ? "" : "s"} · ${ne.swedes} in Sweden · ${ne.first}–${ne.last}</span><br>${won}`;
  }
  function tipNominator(i) {
    const p = people[R[i]], nr = NR.get(R[i]);
    const g = p.gender === "F" ? "Recorded as a woman" : p.gender === "M" ? "Recorded as a man" : "No gender recorded";
    return `<b>${esc(p.name)}</b><br>${fmt(nr.noms)} nomination${nr.noms === 1 ? "" : "s"} for ${fmt(nr.candidates)} ${nr.candidates === 1 ? "person" : "people"}, ${nr.first}${nr.last !== nr.first ? `–${nr.last}` : ""}<br><span class="t-sub">${nr.winners} of them went on to win · ${g}</span>`;
  }
  const hoverGroupOf = {
    tipNominee: (i) => byNominee.get(E[i]),
    tipNominator: (i) => byNominator.get(R[i]),
  };

  // ------------------------------------------------------------------ scene switching
  const stepEls = [...document.querySelectorAll(".step")];
  let current = -1;
  function render(instant) {
    const step = stepEls[current];
    const sc = scenes[step.dataset.scene];
    onFrame = null;
    delay.fill(0);
    const out = sc.enter();
    if (instant) setAnnotNow(out.html, out.lines); else setAnnot(out.html, out.lines);
    commit(instant);
    const card = step.querySelector(".card, .masthead");
    desc.textContent = card ? card.textContent.replace(/\s+/g, " ").trim() : "";
  }
  function pickStep() {
    const vh = window.innerHeight;
    let active = 0;
    for (let k = 0; k < stepEls.length; k++) {
      const c = stepEls[k].querySelector(".card, .masthead");
      const top = (c || stepEls[k]).getBoundingClientRect().top;
      if (top < vh * 0.82) active = k;
    }
    if (active !== current) {
      current = active;
      hideTip();
      render(false);
    }
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    W = rect.width; H = rect.height;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (current >= 0) render(true);
  }

  // ------------------------------------------------------------------ hover
  function hideTip() { tipEl.hidden = true; if (hoverSet) { hoverSet = null; if (!animating) draw(); } }
  function nearest(mx, my) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < N; i++) {
      if (a[i] < 0.3) continue;
      const dx = x[i] - mx, dy = y[i] - my, d = dx * dx + dy * dy;
      const lim = (r[i] + 5) * (r[i] + 5);
      if (d < lim && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function onPointer(e) {
    if (current < 0) return;
    const sc = scenes[stepEls[current].dataset.scene];
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const i = nearest(mx, my);
    if (i < 0 || !sc.tip) { hideTip(); return; }
    const html = sc.tip(i);
    if (!html) { hideTip(); return; }
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let left = e.clientX + 14, top = e.clientY + 14;
    if (left + tw > window.innerWidth - 8) left = e.clientX - tw - 14;
    if (top + th > window.innerHeight - 8) top = e.clientY - th - 14;
    tipEl.style.left = `${Math.max(8, left)}px`;
    tipEl.style.top = `${Math.max(8, top)}px`;
    const grp = sc.tip === tipNominee ? hoverGroupOf.tipNominee(i) : sc.tip === tipNominator ? hoverGroupOf.tipNominator(i) : [i];
    hoverSet = grp;
    if (!animating) draw();
  }
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointerleave", hideTip);
  window.addEventListener("scroll", () => { if (!tipEl.hidden) hideTip(); }, { passive: true });

  // ------------------------------------------------------------------ theme
  const toggle = document.getElementById("theme-toggle");
  function systemDark() { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
    readPalette();
    if (current >= 0) render(true);
  }
  try { const saved = localStorage.getItem("nf-theme"); if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved); } catch (err) { /* storage unavailable */ }
  toggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || (systemDark() ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    try { localStorage.setItem("nf-theme", next); } catch (err) { /* storage unavailable */ }
    applyTheme(next);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readPalette(); if (current >= 0) render(true); });

  // ------------------------------------------------------------------ boot
  readPalette();
  for (let i = 0; i < N; i++) { x[i] = W / 2; y[i] = H / 2; }
  resize();
  let scrollRaf = 0;
  window.addEventListener("scroll", () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; pickStep(); }); }, { passive: true });
  let resizeTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
  current = -1;
  pickStep();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (current >= 0) render(true); });

  // ------------------------------------------------------------------ database
  const fold = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rowsAll = [...NE.values()].map((ne) => {
    const p = people[ne.i];
    const nominatorNames = [...new Set(byNominee.get(ne.i).map((i) => people[R[i]].name))];
    return { ne, p, key: fold(p.name), backKeys: nominatorNames.map((n) => [n, fold(n)]),
      home: ne.homes.length ? D.countries[ne.homes[0]] : "", homesN: ne.homes.length };
  });
  const tbody = document.getElementById("db-body");
  const countEl = document.getElementById("db-count");
  const moreBtn = document.getElementById("db-more");
  const searchEl = document.getElementById("db-search");
  let sortKey = "noms", sortDir = -1, filter = "all", query = "", limit = 60;
  const open = new Set();

  function sortVal(rw) {
    switch (sortKey) {
      case "name": return rw.key;
      case "noms": return rw.ne.nomsAll;
      case "first": return rw.ne.first;
      case "backers": return rw.ne.backers;
      case "laureates": return rw.ne.laureates;
      case "swedes": return rw.ne.swedes;
      case "countries": return rw.ne.countries;
      case "home": return fold(rw.home || "~");
      default: return 0;
    }
  }
  function highlight(text, q) {
    if (!q) return esc(text);
    const k = fold(text), pos = k.indexOf(q);
    if (pos < 0) return esc(text);
    return `${esc(text.slice(0, pos))}<mark class="hit">${esc(text.slice(pos, pos + q.length))}</mark>${esc(text.slice(pos + q.length))}`;
  }
  function detailHtml(rw) {
    const list = byNominee.get(rw.ne.i).slice().sort((p, q) => Y[p] - Y[q] || L[p] - L[q]);
    let h = '<div class="detail-grid">';
    let lastYear = 0;
    for (const i of list) {
      const lt = D.letters[L[i]];
      const others = lt[3].filter((pi) => pi !== rw.ne.i).map((pi) => people[pi].name);
      const nor = people[R[i]];
      h += `<div class="y">${Y[i] !== lastYear ? Y[i] : ""}</div><div class="who"><b>${highlight(nor.name, query)}</b>${byLaureate(i) ? ' <i class="md" title="Nobel laureate"></i>' : ""}, ${esc(countryLabel(i))}${others.length ? ` <span class="with">· shared with ${esc(others.join(", "))}</span>` : ""}${counted(i) ? "" : ' <span class="with">· after their own prize</span>'} · <a href="https://www.nobelprize.org/nomination/archive/show.php?id=${lt[0]}" target="_blank" rel="noopener">letter</a></div>`;
      lastYear = Y[i];
    }
    h += "</div>";
    const p = rw.p;
    const prizes = p.awards.map((a2) => `${CAT[a2[0]]} ${a2[1]}`).join(", ");
    h += `<p class="detail-note">${p.birth ? `Born ${p.birth}${p.death ? `, died ${p.death}` : ""}. ` : ""}${prizes ? `Nobel Prize: ${esc(prizes)}. ` : ""}<a href="https://www.nobelprize.org/nomination/archive/show_people.php?id=${p.aid}" target="_blank" rel="noopener">Archive record</a></p>`;
    return h;
  }
  function renderTable() {
    const q = fold(query.trim());
    let rows = rowsAll.filter((rw) => {
      if (filter === "won" && !rw.p.won) return false;
      if (filter === "never" && rw.p.won) return false;
      if (filter === "women" && rw.p.gender !== "F") return false;
      if (!q) return true;
      rw.via = null;
      if (rw.key.includes(q)) return true;
      const hit = rw.backKeys.find(([, k]) => k.includes(q));
      if (hit) { rw.via = hit[0]; return true; }
      return false;
    });
    rows.sort((p, q2) => {
      const u = sortVal(p), v = sortVal(q2);
      return (u < v ? -1 : u > v ? 1 : 0) * sortDir || q2.ne.nomsAll - p.ne.nomsAll;
    });
    countEl.textContent = `${fmt(rows.length)} ${rows.length === 1 ? "person" : "people"}`;
    const shown = rows.slice(0, limit);
    moreBtn.hidden = rows.length <= limit;
    let h = "";
    for (const rw of shown) {
      const p = rw.p, ne = rw.ne;
      const isOpen = open.has(ne.i);
      const medal = p.won ? '<i class="md" title="Nobel laureate in physics"></i>' : p.other.length ? '<i class="rg" title="Nobel laureate in another category"></i>' : "";
      const sub = p.won ? `Won ${p.won}` : p.other.length ? `${CAT[p.other[0][0]]} ${p.other[0][1]}` : "";
      const via = rw.via && q ? `<small>nominated by ${highlight(rw.via, q)}</small>` : sub ? `<small>${esc(sub)}</small>` : "";
      const years2 = ne.first === ne.last ? `${ne.first}` : `${ne.first}–${ne.last}`;
      h += `<tr class="row" tabindex="0" data-i="${ne.i}" aria-expanded="${isOpen}"><td class="name l">${highlight(p.name, q)}${medal}${via}</td><td>${ne.nomsAll}</td><td class="l">${years2} <span class="muted">(${ne.years})</span></td><td>${ne.backers}</td><td>${ne.laureates || '<span class="muted">0</span>'}</td><td>${ne.swedes || '<span class="muted">0</span>'}</td><td>${ne.countries}</td><td class="l">${esc(rw.home)}${rw.homesN > 1 ? ` <span class="muted">+${rw.homesN - 1}</span>` : ""}</td></tr>`;
      if (isOpen) h += `<tr class="detail"><td colspan="8">${detailHtml(rw)}</td></tr>`;
    }
    tbody.innerHTML = h;
  }
  document.querySelectorAll(".people th").forEach((th) => {
    th.tabIndex = 0;
    const act = () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "name" || k === "home" || k === "first" ? 1 : -1; }
      document.querySelectorAll(".people th").forEach((o) => o.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      renderTable();
    };
    th.addEventListener("click", act);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
  });
  tbody.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr.row");
    if (!tr) return;
    const i = +tr.dataset.i;
    if (open.has(i)) open.delete(i); else open.add(i);
    renderTable();
  });
  tbody.addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr.row");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); }
  });
  let searchTimer = 0;
  searchEl.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = searchEl.value; limit = 60; renderTable(); }, 120); });
  document.querySelectorAll(".db-filter button").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter; limit = 60;
    document.querySelectorAll(".db-filter button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    renderTable();
  }));
  moreBtn.addEventListener("click", () => { limit += 100; renderTable(); });
  renderTable();
})();
