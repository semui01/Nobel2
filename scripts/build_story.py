#!/usr/bin/env python3
"""Clean the parsed archive, join Nobel Prize records, and compute the story's figures.

Input : data/<prize>/archive.json          (parse_archive.py)
        .cache/api/laureates.json          (api.nobelprize.org/2.1/laureates)
Output: data/<prize>/nominations.csv       one row per nomination (nominator x nominee x letter)
        data/<prize>/people.csv            one row per person
        data/<prize>/corrections.csv       every change made to the archive's values
        data/<prize>/stats.json            every figure quoted in the story
        site/data/<prize>.json             compact data for the page

Counting rules (see the methodology section of the page):
  * A nomination is one nominator putting one nominee forward on one letter.
    A letter with several nominees or several signers counts once for each.
  * "Won" means won this prize at any time, including after the archive ends.
  * Nominations dated after the nominee's own prize was announced are kept in
    totals but left out of every rate and comparison.
  * A laureate backer is a nominator whose own Nobel Prize, in any category,
    was announced before the nomination year.
  * Letters whose writer the archive withholds ("N.N.") count as one nominator each.
"""
import argparse
import collections
import csv
import difflib
import json
import os
import re
import statistics
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIZE_LABEL = {"physics": "Physics", "chemistry": "Chemistry", "medicine": "Physiology or Medicine"}
API_CATEGORY = {"Physics": "physics", "Chemistry": "chemistry", "Physiology or Medicine": "medicine",
                "Literature": "literature", "Peace": "peace", "Economic Sciences": "economics"}
CATEGORY_LABEL = {"physics": "Physics", "chemistry": "Chemistry", "medicine": "Physiology or Medicine",
                  "literature": "Literature", "peace": "Peace", "economics": "Economic Sciences"}

# ---------------------------------------------------------------- countries

MODERN = {
    "US": "United States", "GB": "United Kingdom", "DE": "Germany", "FR": "France", "SE": "Sweden",
    "DK": "Denmark", "IT": "Italy", "NL": "Netherlands", "CH": "Switzerland", "RU": "Russia",
    "AT": "Austria", "NO": "Norway", "PL": "Poland", "JP": "Japan", "IN": "India", "BE": "Belgium",
    "FI": "Finland", "CA": "Canada", "AU": "Australia", "HU": "Hungary", "CZ": "Czech Republic",
    "SK": "Slovakia", "IL": "Israel", "ES": "Spain", "IE": "Ireland", "RO": "Romania", "TN": "Tunisia",
    "BR": "Brazil", "AM": "Armenia", "BG": "Bulgaria", "HR": "Croatia", "ZA": "South Africa",
    "UY": "Uruguay", "TR": "Turkey", "PE": "Peru", "RS": "Serbia", "PK": "Pakistan", "UA": "Ukraine",
    "GR": "Greece", "SY": "Syria", "IS": "Iceland", "NZ": "New Zealand", "CL": "Chile", "EE": "Estonia",
    "EG": "Egypt", "AR": "Argentina", "MX": "Mexico", "PT": "Portugal", "CN": "China", "LV": "Latvia",
    "LT": "Lithuania", "SI": "Slovenia", "BY": "Belarus", "GE": "Georgia", "LU": "Luxembourg",
}
# Cities named on letters whose country the archive records wrongly or under a
# state that no longer exists. Value: the country the city is in today.
CITY_NOW = {
    "Leiden": "NL", "Utrecht": "NL", "Zurich": "CH", "Boston": "US", "New York": "US", "Buffalo": "US",
    "London": "GB", "Newcastle": "GB", "Oslo": "NO", "Strasbourg": "FR", "Kiev": "UA",
    "Lemberg (now Lviv)": "UA", "Bratislava": "SK", "Zagreb": "HR", "Prague": "CZ",
}
CITY_LABEL = {"Lemberg (now Lviv)": "Lviv", "Leningrad (now St Petersburg)": "Leningrad",
              "Krakow (Cracow)": "Krakow", "Braunschweig (Brunswick)": "Braunschweig",
              "Berlin-Dahlem": "Berlin"}


def country_then(code, raw_name, year):
    """Everyday name of the state a letter was sent from, in the year it was sent."""
    if code in ("RU", "SU"):
        return "Russian Empire" if year <= 1917 else ("Russia" if year < 1922 else "Soviet Union")
    if raw_name.startswith("CZECHOSLOVAKIA"):
        return "Czechoslovakia"
    if raw_name.startswith("YUGOSLAVIA"):
        return "Yugoslavia"
    if code == "AT" and year <= 1918:
        return "Austria-Hungary"
    if code == "HU" and year <= 1918:
        return "Austria-Hungary"
    return MODERN.get(code, raw_name.title())


def parse_country(raw, city, year, corrections, where):
    """Return (then, now) everyday country names for a letter address."""
    raw = (raw or "").strip()
    city = (city or "").strip()
    m = re.match(r"(.+?) \((\w\w)\)(?: now (.+?) \((\w\w)\))?$", raw)
    code_now = None
    then = None
    if m:
        name, code, _, now_code = m.groups()
        code_now = now_code or code
        if code == "SU" and not now_code:
            code_now = "UA" if city == "Kiev" else "RU"
        if code == "YU" and not now_code:
            code_now = CITY_NOW.get(city, "RS")
        then = country_then(code, name, year)
    if city in CITY_NOW and CITY_NOW[city] != code_now:
        fixed = CITY_NOW[city]
        historical_shift = (city == "Strasbourg" and year <= 1918) or city in ("Kiev", "Lemberg (now Lviv)", "Prague", "Bratislava", "Zagreb")
        if not historical_shift:
            corrections.append({"where": where, "field": "country", "archive": raw or "(blank)",
                                "corrected": MODERN[fixed], "basis": f"city on the letter: {city}"})
            then = MODERN[fixed]
        code_now = fixed
        if then is None:
            then = MODERN[fixed]
    if code_now is None:
        return None, None
    return then, MODERN.get(code_now, code_now)


# ---------------------------------------------------------------- names

# Misspellings in the archive, corrected to the spelling in published sources.
NAME_FIX = {
    "Martin Schwarzchild": "Martin Schwarzschild",
    "Theodor V lonescu": "Theodor V Ionescu",
    "Christian Möller": "Christian Møller",
}

def gender_of(value):
    """The archive's gender field; anything but M or F counts as not recorded."""
    value = (value or "").strip().upper()
    return value if value in ("M", "F") else ""


def fold(s):
    s = s or ""
    for a, b in (("ø", "o"), ("Ø", "O"), ("æ", "ae"), ("Æ", "Ae"), ("ß", "ss"), ("ł", "l"), ("Ł", "L"), ("đ", "d"), ("ı", "i")):
        s = s.replace(a, b)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z ]", " ", s.lower()).split()


def tidy_name(display, first, last):
    """Archive heading 'Wilhelm C Röntgen' -> 'Wilhelm Röntgen'. Keeps initials when no first name."""
    name = re.sub(r"\s+", " ", display or "").strip()
    if not name:
        name = f"{first} {last}".strip()
    tokens = name.split(" ")
    if len(tokens) > 1:
        has_given = any(len(t.strip(".")) > 1 and not re.fullmatch(r"(?:[A-Z]\.?)+", t) for t in tokens[:-1])
        out = []
        for i, t in enumerate(tokens):
            last_tok = i == len(tokens) - 1
            if not last_tok and has_given and re.fullmatch(r"(?:[A-Z]\.?)+", t) and i > 0:
                continue  # drop middle initials after a given name
            if t == "v.":
                t = "von"
            if not has_given and not last_tok and re.fullmatch(r"[A-Z]", t):
                t = t + "."
            out.append(t)
        name = " ".join(out)
    return name


# ---------------------------------------------------------------- page data

RIGHTS = ["Invited professor", "Academy member", "Previous laureate", "Nobel Committee member",
          "Nordic professor", "Specially invited", "Not recorded"]


def right_of(prof):
    """The right under which a nominator was invited, as the archive records it (1901-1949)."""
    p = (prof or "").lower()
    if "nobel committee" in p:
        return 3
    if "royal swedish academy" in p:
        return 1
    if "previous winner" in p:
        return 2
    if "nordic" in p:
        return 4
    if "chairholder" in p or "invited university" in p:
        return 0
    if "specially invited" in p:
        return 5
    return 6


PARTICLES = {"van", "de", "der", "den", "von", "du", "la", "le", "di", "da", "ter", "zu", "del", "dos", "das"}


def short_name(p):
    """First name and surname, for chart labels: 'Hendrik Christoffel van de Hulst' -> 'Hendrik van de Hulst'."""
    name = re.sub(r"\s*\([^)]*\)", "", p["name"]).strip()
    if p.get("api") or p.get("anon") or p["org"]:
        return name
    toks = name.split()
    if len(toks) <= 2 or len(toks[0].strip(".")) <= 1:
        return name
    suffix = toks[-1] if toks[-1].lower().strip(".") in ("jr", "sr") else ""
    core = toks[:-1] if suffix else toks
    last = [core[-1]]
    k = len(core) - 2
    while k > 0 and core[k].lower() in PARTICLES:
        last.insert(0, core[k])
        k -= 1
    return " ".join([core[0]] + last + ([suffix] if suffix else []))


def export_site(prize, people, noms, letters, NS, NR, S, top_ids, first_prize):
    nominee_order = sorted(NS, key=lambda pid: (-NS[pid]["noms_all"], NS[pid]["name"]))
    nominator_order = sorted((pid for pid in NR if pid not in NS), key=lambda pid: (-NR[pid]["noms"], people[pid]["name"]))
    order = nominee_order + nominator_order
    idx = {pid: i for i, pid in enumerate(order)}

    def awards(p):
        return [[a[0], a[1], a[2]] for a in p["awards"]]

    P = []
    for pid in order:
        p = people[pid]
        P.append([p["name"], p["gender"], p["birth"], p["death"], awards(p), 1 if p.get("anon") else 0,
                  0 if isinstance(pid, str) else pid, short_name(p)])

    country_count = collections.Counter(n["signer"]["now"] for n in noms if n["signer"]["now"])
    countries = [c for c, _ in country_count.most_common()]
    for n in noms:
        if n["entry"]["now"] and n["entry"]["now"] not in countries:
            countries.append(n["entry"]["now"])
    cidx = {c: i for i, c in enumerate(countries)}
    then_names = sorted({n["signer"]["then"] for n in noms if n["signer"]["then"]})
    tidx = {c: i for i, c in enumerate(then_names)}

    letter_idx = {id(lt): i for i, lt in enumerate(letters)}
    L = []
    for lt in letters:
        L.append([lt["id"], lt["year"], lt["number"], [idx[e["p"]["pid"]] for e in lt["nominees"]],
                  [idx[s["p"]["pid"]] for s in lt["signers"]], lt["comments"]])

    cols = {k: [] for k in "yerlfctg"}
    for n in noms:
        cols["y"].append(n["year"])
        cols["e"].append(idx[n["nominee"]["pid"]])
        cols["r"].append(idx[n["nominator"]["pid"]])
        cols["l"].append(letter_idx[id(n["letter"])])
        cols["f"].append((0 if n["after_win"] else 1) | (2 if n["laureate_backer"] else 0) | (4 if n["swedish"] else 0))
        cols["c"].append(cidx[n["signer"]["now"]] if n["signer"]["now"] else -1)
        cols["t"].append(tidx[n["signer"]["then"]] if n["signer"]["then"] else -1)
        cols["g"].append(right_of(n["signer"]["prof"]) if n["year"] < 1950 else 6)

    home = collections.defaultdict(collections.Counter)
    for n in noms:
        if n["entry"]["now"]:
            home[n["nominee"]["pid"]][n["entry"]["now"]] += 1
    E = []
    for pid in nominee_order:
        s = NS[pid]
        homes = [cidx[c] for c, _ in home[pid].most_common()]
        E.append([idx[pid], s["noms"], s["noms_all"], s["backers"], s["countries"], s["swedes"], s["laureates"],
                  s["top_backers"], s["first"], s["last"], s["years"], s["won"] or 0, homes])
    R = []
    for pid in sorted(NR, key=lambda q: (-NR[q]["noms"], people[q]["name"])):
        r = NR[pid]
        R.append([idx[pid], r["noms"], r["candidates"], r["winners"], r["first"], r["last"], 1 if pid in top_ids else 0])

    def find(name):
        for pid in order:
            if people[pid]["name"] == name:
                return idx[pid]
        raise KeyError(name)

    focus_names = ["Arnold Sommerfeld", "Samuel Abraham Goudsmit", "George Eugene Uhlenbeck", "Albert Einstein",
                   "Lise Meitner", "Otto Robert Frisch", "Otto Hahn", "Henri Poincaré", "Chien-Shiung Wu", "James Franck",
                   "Murray Gell-Mann", "Wilhelm Ostwald", "Max Planck", "Nikolai Nikolaevic Bogoljubov", "John Bardeen",
                   "Marie Curie", "Maria Goeppert Mayer", "Glenn T. Seaborg", "Stefan Meyer", "Léon Charles Prudent van Hove",
                   "Gregor Wentzel", "Wolfgang Pauli", "Aage N. Bohr", "Ben R. Mottelson", "James Rainwater"]
    focus = {name: find(name) for name in focus_names}

    stats = json.loads(json.dumps(S, ensure_ascii=False))
    for o in stats["overlooked"]:
        o["i"] = idx[o.pop("pid")]
    for o in stats["top_nominators"]:
        o["i"] = idx[o.pop("pid")]

    site = {"prize": prize, "label": PRIZE_LABEL[prize], "people": P, "countries": countries, "then": then_names,
            "rights": RIGHTS, "noms": cols, "letters": L, "nominees": E, "nominators": R, "focus": focus, "stats": stats}
    out = os.path.join(ROOT, "site", "data")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, f"{prize}.json"), "w", encoding="utf-8") as f:
        json.dump(site, f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- main build

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prize", default="physics")
    args = ap.parse_args()
    prize = args.prize
    label = PRIZE_LABEL[prize]

    with open(os.path.join(ROOT, "data", prize, "archive.json"), encoding="utf-8") as f:
        archive = json.load(f)
    with open(os.path.join(ROOT, ".cache", "api", "laureates.json"), encoding="utf-8") as f:
        api = json.load(f)["laureates"]

    corrections = []

    # Nobel Prize announcements: (category, award year) -> announcement year
    announced = {}
    api_by_prize = collections.defaultdict(list)
    for lau in api:
        for p in lau.get("nobelPrizes", []):
            cat = API_CATEGORY[p["category"]["en"]]
            yr = int(p["awardYear"])
            ann = int((p.get("dateAwarded") or str(yr))[:4])
            announced[(cat, yr)] = ann
            api_by_prize[(cat, yr)].append(lau)

    # ----------------------------------------------------- people
    pages = {p["pid"]: p for p in archive["people"]}
    people = {}

    def person(pid, rec_person):
        if pid in people:
            return people[pid]
        page = pages.get(pid, {})
        flds = page.get("fields", {})
        p = {
            "pid": pid,
            "raw": NAME_FIX.get(rec_person["name"], rec_person["name"]),
            "name": NAME_FIX.get(rec_person["name"]) or tidy_name(page.get("display") or rec_person["name"], flds.get("Firstname", ""), flds.get("Lastname/org", "")),
            "gender": gender_of(flds.get("Gender")),
            "birth": int(flds["Year, Birth"]) if flds.get("Year, Birth", "").isdigit() else None,
            "death": int(flds["Year, Death"]) if flds.get("Year, Death", "").isdigit() else None,
            "awards": [],      # [(category, award year, announcement year)]
            "org": bool(flds.get("Lastname/org")) and not flds.get("Firstname"),
            "api": None,
            "other_noms": collections.Counter(),  # nominations as nominee in other categories
        }
        if rec_person["name"] in NAME_FIX:
            corrections.append({"where": f"person {pid}", "field": "name", "archive": rec_person["name"],
                                "corrected": NAME_FIX[rec_person["name"]], "basis": "spelling in published sources"})
        for a in page.get("awards", []) + rec_person.get("awards", []):
            key = (a["category"], a["year"])
            if key not in [(x[0], x[1]) for x in p["awards"]]:
                p["awards"].append((a["category"], a["year"], announced.get(key, a["year"])))
        for n in page.get("nominee_in", []):
            if n.get("category") and n["category"] != label:
                p["other_noms"][n["category"]] += 1
        people[pid] = p
        return p

    # ----------------------------------------------------- nominations
    noms = []
    letters = []
    anon = 0
    for rec in archive["records"]:
        year = rec["year"]
        signers = []
        for s in rec["nominators"]:
            if s["pid"] is None or re.fullmatch(r"N\.?\s*N\.?", s["name"] or ""):
                anon += 1
                key = f"nn{rec['id']}-{len(signers)}"
                p = people.setdefault(key, {"pid": key, "raw": s["name"], "name": "Name withheld (N.N.)", "gender": "",
                                            "birth": None, "death": None, "awards": [], "org": False, "api": None,
                                            "anon": True, "other_noms": collections.Counter()})
            else:
                p = person(s["pid"], s)
                if not p["gender"]:
                    p["gender"] = gender_of(s["fields"].get("Gender"))
            then, now = parse_country(s["fields"].get("Country"), s["fields"].get("City"), year, corrections,
                                      f"letter {rec['id']} ({year}), nominator {s['name']}")
            signers.append({"p": p, "then": then, "now": now, "prof": s["fields"].get("Profession", ""),
                            "univ": s["fields"].get("University", ""), "city": CITY_LABEL.get(s["fields"].get("City", ""), s["fields"].get("City", ""))})
        nominees = []
        for n in rec["nominees"]:
            p = person(n["pid"], n)
            if not p["gender"]:
                p["gender"] = gender_of(n["fields"].get("Gender"))
            then, now = parse_country(n["fields"].get("Country"), n["fields"].get("City"), year, corrections,
                                      f"letter {rec['id']} ({year}), nominee {n['name']}")
            nominees.append({"p": p, "then": then, "now": now, "univ": n["fields"].get("University", ""),
                             "city": CITY_LABEL.get(n["fields"].get("City", ""), n["fields"].get("City", ""))})
        letter = {"id": rec["id"], "year": year, "number": rec["number"], "signers": signers, "nominees": nominees,
                  "comments": rec["comments"], "motivation": rec["motivation"]}
        letters.append(letter)
        for s in signers:
            for n in nominees:
                noms.append({"year": year, "letter": letter, "nominee": n["p"], "nominator": s["p"], "signer": s, "entry": n})

    # ----------------------------------------------------- laureate records from the API
    def match_api(p):
        if not p["awards"] or p.get("anon"):
            return None
        best, score = None, 0
        toks = set(fold(p["raw"])) | set(fold(p["name"]))
        for cat, yr, _ in p["awards"]:
            for lau in api_by_prize[(cat, yr)]:
                names = " ".join(filter(None, [lau.get("knownName", {}).get("en"), lau.get("fullName", {}).get("en"),
                                               lau.get("familyName", {}).get("en"), lau.get("orgName", {}).get("en")]))
                sc = len(toks & set(fold(names)))
                if sc > score:
                    best, score = lau, sc
        return best

    # The archive links laureates only some of the time (rarely for prizes after
    # 1975). Find the rest in the Nobel Prize's laureate records: same last name,
    # given names that agree, birth years equal when both are known, and the
    # person old enough to have written or received each letter.
    active_years = collections.defaultdict(list)
    for n in noms:
        active_years[n["nominee"]["pid"]].append(n["year"])
        active_years[n["nominator"]["pid"]].append(n["year"])
    suffixes = {"jr", "sr", "ii", "iii"}
    particles = {"von", "van", "de", "der", "den", "du", "la", "le", "di", "da", "sir", "lord"}

    def split_name(s):
        toks = [t for t in fold(re.sub(r"\(.*?\)", " ", s or "")) if t not in suffixes]
        toks = [t for t in toks if t not in particles] or toks
        return toks[:-1], (toks[-1] if toks else "")

    by_last = collections.defaultdict(list)
    for lau in api:
        if "orgName" in lau:
            continue
        given = (lau.get("givenName") or {}).get("en", "")
        family = (lau.get("familyName") or {}).get("en", "")
        g, last = split_name(f"{given} {family}")
        by_last[last].append((g, lau))

    def given_agree(a, b):
        if not a or not b:
            return False
        for x, y in zip(a, b):
            if len(x) > 1 and len(y) > 1:
                if x != y:
                    return False
            elif x[0] != y[0]:
                return False
        return True

    for p in people.values():
        if p["awards"] or p.get("anon") or p["org"]:
            continue
        g, last = split_name(p["raw"])
        hits = []
        for lg, lau in by_last.get(last, []):
            by = int((lau.get("birth") or {}).get("year") or 0) or None
            if not given_agree(g, lg):
                continue
            if p["birth"] and by:
                if p["birth"] != by:
                    continue
            else:
                if not (len(g[0]) > 1 and len(lg[0]) > 1):
                    continue  # unknown birth year: need a written-out first name on both
                if by and min(active_years[p["pid"]]) < by + 25:
                    continue
            hits.append(lau)
        if len(hits) == 1:
            lau = hits[0]
            for prz in lau["nobelPrizes"]:
                cat = API_CATEGORY[prz["category"]["en"]]
                yr = int(prz["awardYear"])
                p["awards"].append((cat, yr, announced[(cat, yr)]))
            corrections.append({"where": f"person {p['pid']} ({p['raw']})", "field": "laureate",
                                "archive": "no prize linked",
                                "corrected": "; ".join(f"{CATEGORY_LABEL[API_CATEGORY[z['category']['en']]]} {z['awardYear']}" for z in lau["nobelPrizes"]),
                                "basis": "Nobel Prize laureate record with the same name" + (" and birth year" if p["birth"] else "")})

    for p in people.values():
        lau = match_api(p)
        if lau:
            p["api"] = lau["id"]
            known = (lau.get("knownName") or lau.get("orgName") or {}).get("en")
            if known:
                p["name"] = known
            g = {"male": "M", "female": "F"}.get(lau.get("gender"))
            if g and p["gender"] and g != p["gender"]:
                corrections.append({"where": f"person {p['pid']} {p['name']}", "field": "gender", "archive": p["gender"],
                                    "corrected": g, "basis": "Nobel Prize laureate record"})
            if g:
                p["gender"] = g
            for prz in lau.get("nobelPrizes", []):
                cat = API_CATEGORY[prz["category"]["en"]]
                yr = int(prz["awardYear"])
                if (cat, yr) not in [(a[0], a[1]) for a in p["awards"]]:
                    p["awards"].append((cat, yr, announced[(cat, yr)]))
        p["awards"].sort(key=lambda a: a[2])

    # ----------------------------------------------------- merge duplicate people
    # The archive sometimes files one person under two records. Join two records
    # only when the names cannot belong to different people:
    #   * same last name and same first given name, middle initials compatible, or
    #   * initials only: the same two or more initials and a shared country;
    # and never when both birth years are known and differ.
    countries_of = collections.defaultdict(set)
    for n in noms:
        countries_of[n["nominator"]["pid"]].add(n["signer"]["now"])
        countries_of[n["nominee"]["pid"]].add(n["entry"]["now"])

    def name_parts(p):
        toks = fold(re.sub(r"\(.*?\)", " ", p["raw"] or p["name"]))
        toks = [t for t in toks if t not in ("von", "van", "de", "der", "den", "du", "la", "le", "di", "da", "sir", "lord")]
        return toks[:-1], toks[-1] if toks else ""

    def same_person(a, b):
        if a["birth"] and b["birth"] and a["birth"] != b["birth"]:
            return None
        ga, la = name_parts(a)
        gb, lb = name_parts(b)
        if not ga or not gb or la != lb:
            return None
        full_a = [t for t in ga if len(t) > 1]
        full_b = [t for t in gb if len(t) > 1]
        if a["birth"] and a["birth"] == b["birth"] and full_a and full_b and (set(full_a) <= set(full_b) or set(full_b) <= set(full_a)):
            return "same last name and birth year; one record gives more of the given names"
        if full_a and full_b:
            if full_a[0] != full_b[0]:
                return None
            # every given name or initial present in both must agree by first letter
            for x, y in zip(ga[1:], gb[1:]):
                if x[0] != y[0]:
                    return None
            return "same first name and last name; birth years agree or one is blank"
        if not full_a and not full_b and len(ga) >= 2 and ga == gb and countries_of[a["pid"]] & countries_of[b["pid"]] - {None}:
            return "same initials and last name, writing from the same country"
        return None

    merged = {}
    # two archive records linked to the same laureate are the same person
    by_api = collections.defaultdict(list)
    for p in people.values():
        if p["api"]:
            by_api[p["api"]].append(p)
    for grp in by_api.values():
        grp.sort(key=lambda q: (q["birth"] is None, str(q["pid"])))
        for other in grp[1:]:
            merged[other["pid"]] = grp[0]["pid"]
            corrections.append({"where": f"person {other['pid']} ({other['raw']})", "field": "identity",
                                "archive": f"separate record {other['pid']}", "corrected": f"same person as {grp[0]['pid']} ({grp[0]['raw']})",
                                "basis": "both records match the same Nobel laureate"})
            grp[0]["birth"] = grp[0]["birth"] or other["birth"]
    # spelling and transliteration variants (Zavojskij / Zavoiskij, Mueller / Müller):
    # same known birth year, and names that agree once spelled alike
    def skeleton(word):
        for a, b in (("sch", "sh"), ("tch", "ch"), ("ue", "u"), ("oe", "o"), ("ae", "a"), ("kh", "h"), ("ch", "h"),
                     ("ts", "c"), ("tz", "z"), ("ks", "x"), ("w", "v"), ("j", "i"), ("y", "i")):
            word = word.replace(a, b)
        return re.sub(r"(.)\1+", r"\1", word)

    def similar(u, v):
        return difflib.SequenceMatcher(None, skeleton(u), skeleton(v)).ratio()

    by_birth = collections.defaultdict(list)
    for p in people.values():
        if p.get("anon") or p["org"] or p["pid"] in merged or not p["birth"]:
            continue
        by_birth[p["birth"]].append(p)
    for grp in by_birth.values():
        # keep the record with the fullest, most carefully spelled name
        grp.sort(key=lambda q: (-len(q["awards"]), -len([t for t in name_parts(q)[0] if len(t) > 1]),
                                -sum(1 for ch in q["raw"] if ord(ch) > 127), str(q["pid"])))
        for i, keep in enumerate(grp):
            if keep["pid"] in merged:
                continue
            for other in grp[i + 1:]:
                if other["pid"] in merged:
                    continue
                ga, la = name_parts(keep)
                gb, lb = name_parts(other)
                if not ga or not gb or la == lb or similar(la, lb) < 0.85:
                    continue
                fa, fb = ga[0], gb[0]
                if len(fa) > 1 and len(fb) > 1:
                    if similar(fa, fb) < 0.75:
                        continue
                elif skeleton(fa)[0] != skeleton(fb)[0]:
                    continue
                merged[other["pid"]] = keep["pid"]
                corrections.append({"where": f"person {other['pid']} ({other['raw']})", "field": "identity",
                                    "archive": f"separate record {other['pid']}", "corrected": f"same person as {keep['pid']} ({keep['raw']})",
                                    "basis": "same birth year; the names differ only in spelling or transliteration"})
                keep["death"] = keep["death"] or other["death"]
                keep["gender"] = keep["gender"] or other["gender"]

    groups = collections.defaultdict(list)
    for p in people.values():
        if p.get("anon") or p["org"] or p["pid"] in merged:
            continue
        given, last = name_parts(p)
        if not given:
            continue
        groups[last].append(p)
    for key, grp in groups.items():
        if len(grp) < 2:
            continue
        grp.sort(key=lambda q: (q["birth"] is None, -len(q["awards"]), str(q["pid"])))
        for i, keep in enumerate(grp):
            if keep["pid"] in merged:
                continue
            for other in grp[i + 1:]:
                if other["pid"] in merged:
                    continue
                basis = same_person(keep, other)
                if not basis:
                    continue
                merged[other["pid"]] = keep["pid"]
                corrections.append({"where": f"person {other['pid']} ({other['raw']})", "field": "identity",
                                    "archive": f"separate record {other['pid']}", "corrected": f"same person as {keep['pid']} ({keep['raw']})",
                                    "basis": basis})
                keep["birth"] = keep["birth"] or other["birth"]
                keep["death"] = keep["death"] or other["death"]
                keep["gender"] = keep["gender"] or other["gender"]
                for a in other["awards"]:
                    if a not in keep["awards"]:
                        keep["awards"].append(a)
    for n in noms:
        if n["nominee"]["pid"] in merged:
            n["nominee"] = people[merged[n["nominee"]["pid"]]]
        if n["nominator"]["pid"] in merged:
            n["nominator"] = people[merged[n["nominator"]["pid"]]]
    for lt in letters:
        for s in lt["signers"]:
            if s["p"]["pid"] in merged:
                s["p"] = people[merged[s["p"]["pid"]]]
        for e in lt["nominees"]:
            if e["p"]["pid"] in merged:
                e["p"] = people[merged[e["p"]["pid"]]]
    for pid in merged:
        people.pop(pid, None)

    # ----------------------------------------------------- per-nomination flags
    def first_prize(p, cat=prize):
        own = [a for a in p["awards"] if a[0] == cat]
        return own[0] if own else None

    for n in noms:
        won = first_prize(n["nominee"])
        n["after_win"] = bool(won and n["year"] > won[2])
        n["laureate_backer"] = any(a[2] < n["year"] for a in n["nominator"]["awards"])
        n["swedish"] = n["signer"]["now"] == "Sweden"

    counted = [n for n in noms if not n["after_win"]]

    # ----------------------------------------------------- per-nominee metrics
    nominees = collections.defaultdict(list)
    for n in counted:
        nominees[n["nominee"]["pid"]].append(n)
    allnoms_by_nominee = collections.defaultdict(list)
    for n in noms:
        allnoms_by_nominee[n["nominee"]["pid"]].append(n)

    def nominee_stats(pid):
        lst = nominees.get(pid, [])
        p = people[pid]
        won = first_prize(p)
        return {
            "pid": pid, "name": p["name"], "gender": p["gender"],
            "noms": len(lst), "noms_all": len(allnoms_by_nominee[pid]),
            "backers": len({n["nominator"]["pid"] for n in lst}),
            "countries": len({n["signer"]["now"] for n in lst if n["signer"]["now"]}),
            "swedes": len({n["nominator"]["pid"] for n in lst if n["swedish"]}),
            "laureates": len({n["nominator"]["pid"] for n in lst if n["laureate_backer"]}),
            "first": min((n["year"] for n in allnoms_by_nominee[pid]), default=None),
            "last": max((n["year"] for n in allnoms_by_nominee[pid]), default=None),
            "years": len({n["year"] for n in allnoms_by_nominee[pid]}),
            "won": won[1] if won else None,
            "other": [a for a in p["awards"] if a[0] != prize],
        }

    nominee_ids = sorted(allnoms_by_nominee, key=lambda pid: -len(allnoms_by_nominee[pid]))
    NS = {pid: nominee_stats(pid) for pid in nominee_ids}
    rated = [s for s in NS.values() if s["noms"] > 0]  # nominees with at least one counted nomination

    def rate(group):
        group = list(group)
        w = sum(1 for s in group if s["won"])
        return {"n": len(group), "won": w, "pct": round(100 * w / len(group)) if group else 0}

    # ----------------------------------------------------- per-nominator metrics
    by_nominator = collections.defaultdict(list)
    for n in noms:
        by_nominator[n["nominator"]["pid"]].append(n)

    def nominator_stats(pid):
        lst = by_nominator[pid]
        p = people[pid]
        picks = {n["nominee"]["pid"] for n in lst}
        picks_won = {q for q in picks if first_prize(people[q])}
        return {"pid": pid, "name": p["name"], "gender": p["gender"], "anon": bool(p.get("anon")),
                "noms": len(lst), "candidates": len(picks), "winners": len(picks_won),
                "first": min(n["year"] for n in lst), "last": max(n["year"] for n in lst),
                "laureate": [a for a in p["awards"]],
                "countries": sorted({n["signer"]["now"] for n in lst if n["signer"]["now"]})}

    NR = {pid: nominator_stats(pid) for pid in by_nominator}

    # ----------------------------------------------------- figures for the story
    S = {}
    S["first_year"], S["last_year"] = min(n["year"] for n in noms), max(n["year"] for n in noms)
    S["nominations"] = len(noms)
    S["letters"] = len(letters)
    S["nominees"] = len(NS)
    S["nominators"] = len(NR)
    S["anon_letters"] = sum(1 for p in NR.values() if p["anon"])
    S["after_win"] = sum(1 for n in noms if n["after_win"])
    S["after_win_people"] = len({n["nominee"]["pid"] for n in noms if n["after_win"]})
    winners = [s for s in NS.values() if s["won"]]
    S["winners"] = len(winners)
    S["winners_by_end"] = sum(1 for s in winners if s["won"] <= S["last_year"])
    S["winners_after"] = sum(1 for s in winners if s["won"] > S["last_year"])
    S["last_winner"] = max((s["won"], s["name"]) for s in winners)
    per_year = collections.Counter(n["year"] for n in noms)
    S["per_year"] = dict(sorted(per_year.items()))
    S["busiest_year"] = max(per_year, key=per_year.get)
    S["quietest_year"] = min(per_year, key=per_year.get)
    S["won_share_noms"] = round(100 * sum(1 for n in noms if first_prize(n["nominee"])) / len(noms))

    # nominations-received bins
    bins = [(1, 1, "1 nomination"), (2, 4, "2–4"), (5, 9, "5–9"), (10, 19, "10–19"), (20, 10**6, "20 or more")]
    S["by_noms"] = [{"label": lab, **rate(s for s in rated if lo <= s["noms"] <= hi)} for lo, hi, lab in bins]
    S["backers_10"] = {"below": rate(s for s in rated if s["backers"] < 10), "atleast": rate(s for s in rated if s["backers"] >= 10)}
    S["countries_bins"] = [{"label": lab, **rate(s for s in rated if lo <= s["countries"] <= hi)} for lo, hi, lab in
                           [(0, 1, "1 country"), (2, 3, "2–3"), (4, 10**6, "4 or more")]]
    S["swedish"] = {"with": rate(s for s in rated if s["swedes"] > 0), "without": rate(s for s in rated if s["swedes"] == 0),
                    "share_noms": round(100 * sum(1 for n in noms if n["swedish"]) / len(noms), 1)}
    S["laureate_bins"] = [{"label": lab, **rate(s for s in rated if lo <= s["laureates"] <= hi)} for lo, hi, lab in
                          [(0, 0, "No laureate backer"), (1, 1, "1 laureate backer"), (2, 10**6, "2 or more")]]
    S["laureate_share_noms"] = round(100 * sum(1 for n in noms if n["laureate_backer"]) / len(noms))

    def meets(s):
        return s["noms"] >= 10 and s["backers"] >= 10 and s["laureates"] >= 2 and s["countries"] >= 4 and s["swedes"] >= 1
    fit = [s for s in rated if meets(s)]
    S["fit"] = rate(fit)
    S["overlooked"] = sorted(({"name": s["name"], "pid": s["pid"], "noms": s["noms"], "other": s["other"]} for s in fit if not s["won"]),
                             key=lambda x: -x["noms"])

    # women
    women = [s for s in NS.values() if s["gender"] == "F"]
    S["women_nominees"] = sorted(({"name": s["name"], "noms": s["noms_all"], "won": s["won"], "first": s["first"], "last": s["last"], "other": s["other"]} for s in women), key=lambda x: -x["noms"])
    S["nominee_share_women"] = round(100 * len(women) / len(NS), 1)
    named_nominators = [p for p in NR.values() if not p["anon"]]
    gender_counts = collections.Counter(p["gender"] or "?" for p in NR.values())
    S["nominator_gender"] = dict(gender_counts)
    S["women_nominators"] = sorted(({"name": p["name"], "noms": p["noms"], "candidates": p["candidates"]} for p in NR.values() if p["gender"] == "F"), key=lambda x: -x["noms"])
    S["women_for_women"] = [{"year": n["year"], "from": n["nominator"]["name"], "to": n["nominee"]["name"]} for n in noms
                            if n["nominator"]["gender"] == "F" and n["nominee"]["gender"] == "F"]

    # countries of nominations (where sent from)
    by_country = collections.defaultdict(list)
    for n in noms:
        by_country[n["signer"]["now"] or "Not recorded"].append(n)
    S["countries"] = []
    for c, lst in sorted(by_country.items(), key=lambda kv: -len(kv[1])):
        picks = {n["nominee"]["pid"] for n in lst if not n["after_win"]}
        won = {q for q in picks if first_prize(people[q])}
        S["countries"].append({"country": c, "noms": len(lst), "candidates": len(picks), "won": len(won),
                               "pct": round(100 * len(won) / len(picks)) if picks else 0})

    # nominators
    S["nominators_by_candidates"] = [{"label": lab, "people": sum(1 for p in NR.values() if lo <= p["candidates"] <= hi)}
                                     for lo, hi, lab in [(1, 1, "1 candidate"), (2, 4, "2–4"), (5, 9, "5–9"), (10, 10**6, "10 or more")]]
    ranked = sorted(NR.values(), key=lambda p: (-p["noms"], p["name"]))
    # the busiest tenth: everyone at or above the nomination count that comes
    # closest to splitting off a tenth of all nominators
    threshold = min(range(2, 40), key=lambda t: abs(sum(1 for p in ranked if p["noms"] >= t) - len(ranked) / 10))
    top = [p for p in ranked if p["noms"] >= threshold]
    S["busiest_tenth"] = {"people": len(top), "noms": sum(p["noms"] for p in top), "share": round(100 * sum(p["noms"] for p in top) / len(noms)),
                          "min_noms": threshold, "pct_people": round(100 * len(top) / len(ranked), 1)}
    S["top_nominators"] = [{"name": p["name"], "pid": p["pid"], "noms": p["noms"], "candidates": p["candidates"], "first": p["first"], "last": p["last"],
                            "laureate": p["laureate"]} for p in ranked[:15]]
    top_ids = {p["pid"] for p in top}
    for s in NS.values():
        s["top_backers"] = len({n["nominator"]["pid"] for n in nominees.get(s["pid"], []) if n["nominator"]["pid"] in top_ids})
    S["top_backer_bins"] = [{"label": lab, **rate(s for s in rated if lo <= s["top_backers"] <= hi)} for lo, hi, lab in
                            [(0, 0, "None"), (1, 1, "1"), (2, 3, "2 or 3"), (4, 10**6, "4 or more")]]
    pickers = [p for p in NR.values() if p["candidates"] >= 6 and not p["anon"]]
    S["best_pickers"] = sorted(({"name": p["name"], "candidates": p["candidates"], "winners": p["winners"], "noms": p["noms"],
                                 "pct": round(100 * p["winners"] / p["candidates"])} for p in pickers),
                               key=lambda x: (-x["pct"], -x["candidates"]))[:15]
    S["most_winners_picked"] = sorted(({"name": p["name"], "winners": p["winners"], "candidates": p["candidates"]} for p in NR.values() if not p["anon"]),
                                      key=lambda x: -x["winners"])[:5]
    S["single_nominee_nominators_pct"] = round(100 * sum(1 for p in NR.values() if p["candidates"] == 1) / len(NR))
    S["most_nominated"] = [{"name": s["name"], "noms": s["noms_all"], "won": s["won"], "backers": s["backers"], "first": s["first"], "last": s["last"]}
                           for s in sorted(NS.values(), key=lambda s: -s["noms_all"])[:25]]
    S["most_nominated_never_won"] = [x for x in S["most_nominated"] if not x["won"]][:10]
    S["corrections"] = len(corrections)
    S["merges"] = sum(1 for c in corrections if c["field"] == "identity")
    S["name_fixes"] = len(NAME_FIX)
    S["linked"] = sum(1 for c in corrections if c["field"] == "laureate")
    S["country_fixes"] = sum(1 for c in corrections if c["field"] == "country")
    # nominations the same people received in other prize categories (from their archive pages)
    S["other_category_noms"] = {people[pid]["name"]: dict(people[pid]["other_noms"]) for pid in NS if people[pid]["other_noms"]}

    # ----------------------------------------------------- write outputs
    out = os.path.join(ROOT, "data", prize)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(S, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, "corrections.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["where", "field", "archive", "corrected", "basis"])
        w.writeheader()
        w.writerows(corrections)
    with open(os.path.join(out, "nominations.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["archive_id", "year", "letter_number", "nominee", "nominee_archive_id", "nominee_won_year",
                    "nominator", "nominator_archive_id", "nominator_gender", "sent_from_then", "sent_from_today",
                    "nominator_city", "nominator_profession", "laureate_backer", "after_nominee_won"])
        for n in noms:
            won = first_prize(n["nominee"])
            w.writerow([n["letter"]["id"], n["year"], n["letter"]["number"], n["nominee"]["name"], n["nominee"]["pid"],
                        won[1] if won else "", n["nominator"]["name"], n["nominator"]["pid"] if not n["nominator"].get("anon") else "",
                        n["nominator"]["gender"], n["signer"]["then"] or "", n["signer"]["now"] or "", n["signer"]["city"],
                        n["signer"]["prof"], int(n["laureate_backer"]), int(n["after_win"])])
    with open(os.path.join(out, "people.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["archive_id", "name", "gender", "birth", "death", "nobel_prizes", "nominations_received",
                    "nominations_written", "different_backers"])
        for p in sorted(people.values(), key=lambda q: q["name"]):
            if p.get("anon"):
                continue
            w.writerow([p["pid"], p["name"], p["gender"], p["birth"] or "", p["death"] or "",
                        "; ".join(f"{CATEGORY_LABEL[a[0]]} {a[1]}" for a in p["awards"]),
                        NS[p["pid"]]["noms_all"] if p["pid"] in NS else 0,
                        NR[p["pid"]]["noms"] if p["pid"] in NR else 0,
                        NS[p["pid"]]["backers"] if p["pid"] in NS else ""])

    export_site(prize, people, noms, letters, NS, NR, S, top_ids, first_prize)
    print(json.dumps({k: S[k] for k in ["nominations", "letters", "nominees", "nominators", "anon_letters", "after_win",
                                        "after_win_people", "winners", "winners_by_end", "winners_after", "last_winner",
                                        "busiest_year", "quietest_year", "corrections"]}, ensure_ascii=False))
    return people, noms, letters, NS, NR, S, top_ids


if __name__ == "__main__":
    main()
