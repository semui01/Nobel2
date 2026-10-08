#!/usr/bin/env python3
"""Download the public Nobel Prize nomination archive for one prize category.

Fetches, for every year in range:
  list.php?prize=N&year=Y   -> the year's nominations (show.php ids)
  show.php?id=X             -> one nomination letter (nominees, nominators, comments)
and then show_people.php?id=P for every person referenced, which records
whether the archive links that person to a Nobel Prize (in any category).

Raw HTML is cached under .cache/archive/ so reruns only fetch what is missing.
Standard library only.

    python3 scripts/scrape_archive.py --prize physics --first 1901 --last 1975
"""
import argparse
import concurrent.futures as cf
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = "https://www.nobelprize.org/nomination/archive/"
PRIZES = {"physics": 1, "chemistry": 2, "medicine": 3, "literature": 4, "peace": 5}
UA = "Mozilla/5.0 (compatible; nobel-nominations-research/1.0)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "archive")


def fetch(url, path, retries=5):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, encoding="utf-8") as f:
            return f.read()
    delay = 2
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            text = raw.decode("utf-8", errors="replace")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(tmp, path)
            return text
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(delay)
            delay *= 2


def fetch_many(jobs, workers, label):
    """jobs: list of (url, path). Fetches concurrently, politely."""
    todo = [j for j in jobs if not (os.path.exists(j[1]) and os.path.getsize(j[1]) > 0)]
    print(f"{label}: {len(jobs)} total, {len(todo)} to fetch", file=sys.stderr)
    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch, u, p): u for u, p in todo}
        for fut in cf.as_completed(futs):
            fut.result()
            done += 1
            if done % 200 == 0:
                print(f"  {label}: {done}/{len(todo)}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prize", default="physics", choices=PRIZES)
    ap.add_argument("--first", type=int, default=1901)
    ap.add_argument("--last", type=int, default=1975)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    pid = PRIZES[args.prize]

    list_jobs = [
        (f"{BASE}list.php?prize={pid}&year={y}", os.path.join(CACHE, "list", f"{pid}-{y}.html"))
        for y in range(args.first, args.last + 1)
    ]
    fetch_many(list_jobs, args.workers, "year lists")

    show_ids = []
    for _, path in list_jobs:
        with open(path, encoding="utf-8") as f:
            show_ids += re.findall(r"show\.php\?id=(\d+)", f.read())
    show_ids = list(dict.fromkeys(show_ids))
    show_jobs = [(f"{BASE}show.php?id={i}", os.path.join(CACHE, "show", f"{i}.html")) for i in show_ids]
    fetch_many(show_jobs, args.workers, "nominations")

    people = []
    for _, path in show_jobs:
        with open(path, encoding="utf-8") as f:
            people += re.findall(r"show_people\.php\?id=(\d+)", f.read())
    people = list(dict.fromkeys(people))
    people_jobs = [(f"{BASE}show_people.php?id={i}", os.path.join(CACHE, "people", f"{i}.html")) for i in people]
    fetch_many(people_jobs, args.workers, "people")
    print(f"done: {len(show_ids)} nominations, {len(people)} people", file=sys.stderr)


if __name__ == "__main__":
    main()
