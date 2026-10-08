// Assemble the story page: fill every figure in the text from the data, check the
// claims the text makes, and inline the styles, script and data into one file.
//
//   node scripts/build_site.mjs physics
// writes docs/physics/index.html (a complete page) and
//        site/dist/physics.html (the same page without the document wrapper).
import fs from "node:fs";

const prize = process.argv[2] || "physics";
const data = JSON.parse(fs.readFileSync(`site/data/${prize}.json`, "utf8"));
const map = fs.readFileSync(`site/data/${prize}-map.json`, "utf8");
const S = data.stats;
const P = data.people;
const n = data.noms;
const N = n.y.length;

const fmt = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v);
const YEAR_KEYS = new Set(["quiet_year", "busy_year", "last_winner_year"]);
const pct = (a, b) => Math.round((100 * a) / b);
const check = (ok, msg) => { if (!ok) { console.error(`claim check failed: ${msg}`); process.exitCode = 1; } };

const focus = data.focus;
const nominee = new Map(data.nominees.map((r) => [r[0], { noms: r[1], nomsAll: r[2], backers: r[3], countries: r[4], swedes: r[5], laureates: r[6], top: r[7], first: r[8], last: r[9], years: r[10], won: r[11] }]));
const nominator = new Map(data.nominators.map((r) => [r[0], { noms: r[1], candidates: r[2], winners: r[3], first: r[4], last: r[5], top: r[6] }]));
const nameOf = (i) => P[i][0];
const wonPhysics = (i) => P[i][4].some((a) => a[0] === prize);

// year details
function yearInfo(year) {
  const idx = [];
  for (let i = 0; i < N; i++) if (n.y[i] === year) idx.push(i);
  return { noms: idx.length, names: new Set(idx.map((i) => n.e[i])).size, winners: [...new Set(idx.map((i) => n.e[i]))].filter((p) => P[p][4].some((a) => a[0] === prize && a[1] === year)).map(nameOf) };
}
const quiet = yearInfo(S.quietest_year), busy = yearInfo(S.busiest_year);
check(quiet.winners.length === 0 && S.quietest_year === 1941, "no physics prize in the quietest year (1941)");
check(JSON.stringify(busy.winners.sort()) === JSON.stringify(["Aage N. Bohr", "Ben R. Mottelson", "James Rainwater"]), "1975 winners");

// joint letters for Goudsmit and Uhlenbeck, Meitner's co-nominees
const lettersWith = (pi) => new Set(data.letters.map((lt, k) => (lt[3].includes(pi) ? k : -1)).filter((k) => k >= 0));
const gl = lettersWith(focus["Samuel Abraham Goudsmit"]), ul = lettersWith(focus["George Eugene Uhlenbeck"]);
const guJoint = [...gl].filter((k) => ul.has(k)).length;
const mei = lettersWith(focus["Lise Meitner"]);
const meiWith = (name) => [...mei].filter((k) => data.letters[k][3].includes(focus[name])).length;

// women
const womenNominees = [...nominee.keys()].filter((i) => P[i][1] === "F");
const womenWriters = [...nominator.keys()].filter((i) => P[i][1] === "F");
const womenWriterNoms = [];
for (let i = 0; i < N; i++) if (P[n.r[i]][1] === "F") womenWriterNoms.push(i);
check(womenWriterNoms.every((i) => P[n.e[i]][1] !== "F"), "no woman nominated a woman");
const curieNoms = womenWriterNoms.filter((i) => n.r[i] === focus["Marie Curie"]).map((i) => nameOf(n.e[i]));
check(JSON.stringify([...new Set(curieNoms)].sort()) === JSON.stringify(["Henri Poincaré", "J.J. Thomson"]), "Marie Curie nominated Thomson and Poincaré");
const womenWon = womenNominees.filter(wonPhysics).map((i) => [nameOf(i), P[i][4].find((a) => a[0] === prize)[1]]);
check(JSON.stringify(womenWon.sort()) === JSON.stringify([["Maria Goeppert Mayer", 1963], ["Marie Curie", 1903]]), "the two women who won");

// countries: best pickers among countries sending more than 30 nominations
const big = S.countries.filter((c) => c.country !== "Not recorded" && c.noms > 30).sort((a, b) => b.pct - a.pct);
const cty = Object.fromEntries(S.countries.map((c) => [c.country, c]));
check(big[0].country === "Denmark", "Denmark leads");
check(big[1].country === "Switzerland" && big[2].country === "Finland" && cty.Switzerland.pct > cty.Finland.pct, "Switzerland, then Finland");
check(["Netherlands", "India"].every((c) => big.slice(3, 5).some((b) => b.country === c)) && cty.Netherlands.pct === cty.India.pct, "Netherlands and India next, tied");

// nominating rights before 1950
const rightCounts = new Array(data.rights.length).fill(0);
let pre50 = 0;
for (let i = 0; i < N; i++) if (n.y[i] < 1950) { rightCounts[n.g[i]]++; pre50++; }

// pickers
const ein = nominator.get(focus["Albert Einstein"]);
check(ein.candidates === 10 && ein.winners === 10, "Einstein 10 of 10");
const vh = nominator.get(focus["Léon Charles Prudent van Hove"]);
check(vh.candidates === 9 && vh.winners === 9, "Van Hove 9 of 9");
const wz = nominator.get(focus["Gregor Wentzel"]);
check(wz.candidates === 7 && wz.winners === 7, "Wentzel 7 of 7");
const meyer = nominator.get(focus["Stefan Meyer"]);
check(S.most_winners_picked[0].name === "Stefan Meyer", "Stefan Meyer picked the most winners");
const franck = nominator.get(focus["James Franck"]);
check(S.top_nominators[0].name === "James Franck", "Franck most prolific");
check(franck.first === 1927, "Franck began in 1927");
const seab = nominator.get(focus["Glenn T. Seaborg"]);

// profiles
const som = nominee.get(focus["Arnold Sommerfeld"]);
check(S.most_nominated_never_won[0].name === "Arnold Sommerfeld", "Sommerfeld most nominated without winning");
check(som.swedes === 0 && som.noms >= 10 && som.backers >= 10 && som.laureates >= 2 && som.countries >= 4, "Sommerfeld met every condition but the Swedish one");
const gou = nominee.get(focus["Samuel Abraham Goudsmit"]), uhl = nominee.get(focus["George Eugene Uhlenbeck"]);
check(gou.nomsAll === uhl.nomsAll && gou.backers === uhl.backers && gou.laureates === uhl.laureates && gou.swedes === 0 && uhl.swedes === 0, "Goudsmit and Uhlenbeck match");
const ein2 = nominee.get(focus["Albert Einstein"]);
check(ein2.first === 1910, "Einstein first nominated 1910");
const meit = nominee.get(focus["Lise Meitner"]);
const meiChem = (S.other_category_noms["Lise Meitner"] || {}).Chemistry || 0;
const poin = nominee.get(focus["Henri Poincaré"]);
check(poin.first === 1904 && poin.last === 1912, "Poincaré 1904–1912");
const bog = nominee.get(focus["Nikolai Nikolaevic Bogoljubov"]);
check(bog.first === 1959 && bog.last === 1975, "Bogoliubov 1959–1975");
const wu = nominee.get(focus["Chien-Shiung Wu"]);
const overOther = S.overlooked.filter((o) => o.other.length).map((o) => o.name).sort();
check(JSON.stringify(overOther) === JSON.stringify(["Ernest Rutherford", "Frédéric Joliot", "Irène Joliot-Curie", "Otto Hahn"]), "the four overlooked who won chemistry");

const nominatorGender = S.nominator_gender;
const unknown = nominatorGender["?"] || 0;

const T = {
  letters: S.letters, nominees: S.nominees, nominations: S.nominations, nominators: S.nominators,
  quiet_year: S.quietest_year, quiet_noms: quiet.noms, quiet_names: quiet.names,
  busy_year: S.busiest_year, busy_noms: busy.noms, busy_names: busy.names,
  bn0_n: S.by_noms[0].n, bn0_won: S.by_noms[0].won, bn4_n: S.by_noms[4].n, bn4_won: S.by_noms[4].won, bn4_pct: S.by_noms[4].pct,
  winners: S.winners, winners_by_end: S.winners_by_end, winners_after: S.winners_after, last_winner_year: S.last_winner[0],
  b10_hi_n: S.backers_10.atleast.n, b10_hi_pct: S.backers_10.atleast.pct, b10_lo_n: S.backers_10.below.n, b10_lo_pct: S.backers_10.below.pct,
  c4_n: S.countries_bins[2].n, c4_pct: S.countries_bins[2].pct, c1_n: S.countries_bins[0].n, c1_pct: S.countries_bins[0].pct,
  sw_share: Math.round(S.swedish.share_noms), sw_with_pct: S.swedish.with.pct, sw_with_n: S.swedish.with.n, sw_without_pct: S.swedish.without.pct,
  laureate_share: S.laureate_share_noms, l2_n: S.laureate_bins[2].n, l2_pct: S.laureate_bins[2].pct, l0_n: S.laureate_bins[0].n, l0_pct: S.laureate_bins[0].pct,
  fit_n: S.fit.n, fit_won: S.fit.won, fit_pct: S.fit.pct, over_n: S.overlooked.length,
  poin_noms: poin.nomsAll, bog_noms: bog.nomsAll, bog_backers: bog.backers,
  som_noms: som.nomsAll, som_backers: som.backers, som_countries: som.countries, som_laureates: som.laureates,
  gu_joint: guJoint, gu_noms: gou.nomsAll, gu_backers: gou.backers, gu_laureates: gou.laureates,
  mei_noms: meit.nomsAll, mei_chem: meiChem, mei_total: meit.nomsAll + meiChem, mei_frisch: meiWith("Otto Robert Frisch"), mei_hahn: meiWith("Otto Hahn"),
  ein_backers: ein2.backers, ein_noms: ein2.noms,
  women_n: womenNominees.length, wu_noms: wu.nomsAll,
  wn_n: womenWriters.length, named: S.nominators - S.anon_letters, wn_noms: womenWriterNoms.length,
  ng_unknown: unknown, ng_pct: pct(unknown, S.nominators), anon_letters: S.anon_letters,
  countries_n: S.countries.filter((c) => c.country !== "Not recorded").length,
  dk_pct: cty.Denmark.pct, ch_pct: cty.Switzerland.pct, fi_pct: cty.Finland.pct, nl_pct: cty.Netherlands.pct,
  w1_n: S.nominators_by_candidates[0].people, w10_n: S.nominators_by_candidates[3].people,
  bt_people: S.busiest_tenth.people, bt_min: S.busiest_tenth.min_noms, bt_share: S.busiest_tenth.share, bt_pct_people: S.busiest_tenth.pct_people,
  name_fixes: S.name_fixes,
  franck_noms: franck.noms, franck_cands: franck.candidates, seab_noms: seab.noms, seab_cands: seab.candidates,
  r_inv: pct(rightCounts[0], pre50), r_acad: pct(rightCounts[1], pre50), r_laur: pct(rightCounts[2], pre50), r_comm: pct(rightCounts[3], pre50),
  tb3_n: S.top_backer_bins[3].n, tb3_pct: S.top_backer_bins[3].pct, tb0_n: S.top_backer_bins[0].n, tb0_pct: S.top_backer_bins[0].pct,
  meyer_won: meyer.winners, meyer_cands: meyer.candidates,
  after_win: S.after_win, after_win_people: S.after_win_people, merges: S.merges, linked: S.linked, country_fixes: S.country_fixes,
};
check(T.w1_n / S.nominators > 0.45 && T.w1_n / S.nominators < 0.5, "'nearly half' wrote for one physicist");
check(T.mei_total === 49, "Meitner 49 in all");

let html = fs.readFileSync("site/src/template.html", "utf8");
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (["CSS", "JS", "DATA", "MAP"].includes(k)) return m;
  if (!(k in T)) { console.error(`missing value for {{${k}}}`); process.exitCode = 1; return m; }
  return YEAR_KEYS.has(k) ? String(T[k]) : fmt(T[k]);
});
const cssText = fs.readFileSync("site/src/style.css", "utf8");
const js = fs.readFileSync("site/src/app.js", "utf8");
const json = (s) => s.replace(/</g, "\\u003c");
html = html
  .replace("/*{{CSS}}*/", () => cssText)
  .replace("/*{{JS}}*/", () => js)
  .replace("/*{{DATA}}*/", () => json(JSON.stringify(data)))
  .replace("/*{{MAP}}*/", () => json(map));

fs.mkdirSync("site/dist", { recursive: true });
fs.writeFileSync(`site/dist/${prize}.html`, html);
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${html.slice(0, html.indexOf("</style>") + 8)}\n</head>\n<body>\n${html.slice(html.indexOf("</style>") + 8)}\n</body>\n</html>\n`;
fs.mkdirSync(`docs/${prize}`, { recursive: true });
fs.writeFileSync(`docs/${prize}/index.html`, full);
console.log(`site: docs/${prize}/index.html (${(full.length / 1024).toFixed(0)} KB)`);
