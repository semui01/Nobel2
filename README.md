# Nomination Files

Data stories built from the [Nobel Prize nomination archive](https://www.nobelprize.org/nomination/archive/).
The first one is **How to win the Physics Nobel**: an interactive, scroll-driven look at every public
nomination for the Nobel Prize in Physics from 1901 to 1975 (4,019 letters, 5,964 nominations),
followed by a searchable database of everyone nominated and a methodology section.

Open `docs/physics/index.html` in a browser to read it. It is a single self-contained file.

## How it is built

```
scripts/scrape_archive.py   download the archive pages for one prize (cached in .cache/, not committed)
scripts/parse_archive.py    turn the cached HTML into data/<prize>/archive.json
scripts/build_story.py      clean the data, join the Nobel Prize laureate records, compute every figure
scripts/build_map.mjs       precompute the dot map (one dot per nomination, inside each country's outline)
scripts/build_site.mjs      fill the story text from the data, check its claims, inline everything into one page
site/src/                   page template, styles and script
```

```sh
npm install                                  # d3-geo, topojson-client, world-atlas (map build only)
python3 scripts/scrape_archive.py --prize physics --first 1901 --last 1975
curl -A "Mozilla/5.0" -o .cache/api/laureates.json "https://api.nobelprize.org/2.1/laureates?limit=1200&format=json"
npm run build
```

The scraper is polite (4 parallel requests, retries with backoff) and caches every page, so reruns only
fetch what is missing. The other prizes use the same pipeline (`--prize chemistry`, `medicine`,
`literature`, `peace`); the story text in `site/src/template.html` is specific to physics.

## Outputs

| File | What it holds |
| --- | --- |
| `data/physics/nominations.csv` | one row per nomination: year, letter, nominee, nominator, where it was sent from, flags |
| `data/physics/people.csv` | everyone in the physics archive, with Nobel Prizes and nomination counts |
| `data/physics/corrections.csv` | every change made to the archive's values, with its basis |
| `data/physics/stats.json` | every figure quoted in the story |
| `docs/physics/index.html` | the finished page |

## Method in brief

A nomination is one person putting one physicist forward in one year; a letter with several signers or
nominees counts once for each pairing. "Won" means won the physics prize at any time, including after
1975, using the Nobel Prize's own laureate records. Nominations sent after the nominee's own prize was
announced are kept in totals but left out of rates. Countries are where a letter was sent from, by
today's borders. The page's methodology section has the details, and `build_site.mjs` stops the build
if a claim in the text no longer matches the data.

Data: Nobel Prize nomination archive and laureate records, © The Nobel Foundation. This is an
independent analysis, not affiliated with the Nobel Foundation or the Royal Swedish Academy of Sciences.
