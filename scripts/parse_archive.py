#!/usr/bin/env python3
"""Parse the cached nomination-archive HTML into one JSON file.

Input : .cache/archive/{list,show,people}/  (written by scrape_archive.py)
Output: data/<prize>/archive.json

The output keeps the archive's own wording; cleaning and analysis happen in
build_story.py. Each archive record ("show" page) has one or more nominees
and one or more nominators (co-signers are listed as Nominator 1, 2, ...).
"""
import argparse
import glob
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "archive")
PRIZES = {"physics": 1, "chemistry": 2, "medicine": 3, "literature": 4, "peace": 5}
CATEGORY_SLUGS = {
    "physics": "physics", "chemistry": "chemistry", "medicine": "medicine",
    "literature": "literature", "peace": "peace", "economic-sciences": "economics",
}


def clean(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def main_block(page):
    a = page.find('<div id="main">')
    b = page.find("<!-- End Main Content", a)
    if b < 0:
        b = page.find("</article>", a)
    return page[a:b]


def awards_in(fragment):
    out = []
    for m in re.finditer(r"prizes/([a-z-]+)/(\d{4})/", fragment):
        out.append({"category": CATEGORY_SLUGS.get(m.group(1), m.group(1)), "year": int(m.group(2))})
    return out


def parse_show(page, rid):
    body = main_block(page)
    body = body[: body.find("</table>")]
    rows = re.findall(r"<tr[^>]*>(.*?)(?=<tr|$)", body, flags=re.S)
    rec = {"id": rid, "year": None, "number": None, "nominees": [], "nominators": [],
           "motivation": "", "comments": ""}
    current = None
    pending_comment = False
    for row in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)
        if not cells:
            continue
        joined = " ".join(cells)
        label = re.search(r'<span class="rubr">([^<]+):</span>', cells[0])
        head = re.search(r"<b>(Nominee(?: \d+)?|Nominator(?: \d+)?):</b>", joined)
        if pending_comment:
            pending_comment = False
        if head:
            current = {"pid": None, "name": "", "fields": {}, "awards": []}
            if head.group(1).startswith("Nominee"):
                rec["nominees"].append(current)
            else:
                rec["nominators"].append(current)
            continue
        if label and len(cells) > 1:
            key = label.group(1).strip()
            raw = cells[1]
            if key == "Year":
                rec["year"] = int(clean(raw))
            elif key == "Number":
                rec["number"] = clean(raw)
            elif key == "Motivation":
                rec["motivation"] = clean(raw)
            elif current is not None:
                if key == "Name":
                    pid = re.search(r"show_people\.php\?id=(\d+)", raw)
                    current["pid"] = int(pid.group(1)) if pid else None
                    current["name"] = clean(raw)
                else:
                    current["fields"][key] = clean(raw)
            continue
        if "Awarded the" in joined and current is not None:
            current["awards"] += awards_in(joined)
            continue
        if re.search(r">\s*Comments:", "<x>" + cells[0]):
            if len(cells) > 1 and clean(cells[1]):
                rec["comments"] = clean(cells[1])
            else:
                pending_comment = True
            continue
    return rec


def parse_people(page, pid):
    body = main_block(page)
    person = {"pid": pid, "display": "", "fields": {}, "awards": [], "nominee_in": [], "nominator_in": []}
    h2 = re.search(r"<h2>(.*?)</h2>", body, flags=re.S)
    person["display"] = clean(h2.group(1)) if h2 else ""
    table = body[: body.find("</table>")]
    for m in re.finditer(r'<span class="rubr">([^<]+):</span></td><td[^>]*>(.*?)</td>', table, flags=re.S):
        person["fields"][m.group(1).strip()] = clean(m.group(2))
    rest = body[body.find("</table>"):]
    awarded = re.search(r"<p>Awarded the(.*?)</p>", rest, flags=re.S)
    if awarded:
        person["awards"] = awards_in(awarded.group(1))
    for role, key in (("Nominee in", "nominee_in"), ("Nominator in", "nominator_in")):
        sec = re.search(role + r" \d+ nominations?:</b>(.*?)</ul>", rest, flags=re.S)
        if not sec:
            continue
        for m in re.finditer(r'show\.php\?id=(\d+)">\s*(.*?)</a>', sec.group(1), flags=re.S):
            text = clean(m.group(2))
            cm = re.match(r"(Physics|Chemistry|Physiology or Medicine|Literature|Peace)\s+(\d{4})\s+(?:by|for)\s+(.*)", text)
            entry = {"id": int(m.group(1))}
            if cm:
                entry.update({"category": cm.group(1), "year": int(cm.group(2)), "other": cm.group(3)})
            else:
                entry["text"] = text
            person[key].append(entry)
    return person


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prize", default="physics", choices=PRIZES)
    args = ap.parse_args()
    pid = PRIZES[args.prize]

    order = []
    years = {}
    for path in sorted(glob.glob(os.path.join(CACHE, "list", f"{pid}-*.html"))):
        year = int(re.search(r"-(\d{4})\.html$", path).group(1))
        with open(path, encoding="utf-8") as f:
            ids = list(dict.fromkeys(int(i) for i in re.findall(r"show\.php\?id=(\d+)", f.read())))
        years[year] = len(ids)
        order += ids

    records = []
    for rid in order:
        with open(os.path.join(CACHE, "show", f"{rid}.html"), encoding="utf-8") as f:
            records.append(parse_show(f.read(), rid))

    pids = sorted({p["pid"] for r in records for p in r["nominees"] + r["nominators"] if p["pid"]})
    people = {}
    for p in pids:
        path = os.path.join(CACHE, "people", f"{p}.html")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                people[p] = parse_people(f.read(), p)

    out_dir = os.path.join(ROOT, "data", args.prize)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "archive.json"), "w", encoding="utf-8") as f:
        json.dump({"prize": args.prize, "years": years, "records": records,
                   "people": [people[p] for p in pids if p in people]},
                  f, ensure_ascii=False, indent=0)
    missing = [p for p in pids if p not in people]
    print(f"{len(records)} records, {len(people)} people parsed, {len(missing)} people pages missing")


if __name__ == "__main__":
    main()
