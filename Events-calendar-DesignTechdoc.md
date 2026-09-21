# Technical & Architecture Design Document

**Project:** Autonomous Local Event Aggregator (Fontainebleau Region)
**Date:** September 20, 2026
**Version:** 2.3 (governance decision, ~3-day cadence, DATAtourisme measured)
**Status:** v2.3 deployed and confirmed in production (September 20: live site serves the new frontend, `data.json` carries `windowEnd`, 161 events) · 🟠 **the grounding terms issue (§3.G) is now a knowingly accepted risk, not a blocker — see the decision of September 20 in §7 and the conditions in §8**

---

## 1. Project Overview & Objectives

The goal of this project is to maintain an autonomous, low-cost event tracking application for the Fontainebleau area (≈15 km radius including Avon, Samois-sur-Seine, Barbizon, Moret-Loing-et-Orvanne, Nemours, Thomery, Bois-le-Roi, Bourron-Marlotte, Vaux-le-Vicomte and Blandy-les-Tours).

The system automatically scans official agendas, local association publications and ticketing platforms, formats the extracted data into a standardized JSON structure, and updates the live web application **without manual intervention**. Events are shown on a **map** and on a **calendar** for the **next 3 months** (reduced from 4 on September 20 to avoid saturating the map and the list), with a focus on **sports, cultural and family activities**.

### Success criteria & launch plan

1. **Beta:** friends & family launch to gather feedback.
2. **Launch / outreach:** contact sports clubs and associations, the City of Fontainebleau, INSEAD and others to get feedback, distribute the app and boost activity.

> Consequence: once the app is shown to institutions, **data trust is the product**. A wrong date or a dead link costs more credibility than a missing event. Validation and verification (Section 5) are therefore treated as first-class features, not polish.

---

## 2. System Architecture & Tech Stack

```
┌─────────────────────────┐
│   GitHub Actions Cron   │  Daily trigger (06:00 UTC) + manual dispatch
│                         │  → real scan only if data > 60 h old (~every 3 days)
└───────────┬─────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│  scripts/fetch-events.js  (Node.js 22, zero dependencies)    │
│                                                              │
│  1. 4 narrow scans ──► Gemini (gemini-3.6-flash)             │
│     sport / nature / culture / family   + Google Search      │
│  2. Validate & normalise every record (bad ones dropped)     │
│  3. Merge with data.json on stable key, prune past events    │
│  4. Geocode (BAN API + cache, bounding-box guard)            │
│  5. Verify URLs (dead links dropped)                         │
│  6. Write data.json {generatedAt, events} + cache + report   │
└───────────┬──────────────────────────────────────────────────┘
            │  git commit & push to 'main' (rebase + retry)
            ▼
┌───────────────────────┐
│  data.json (+ cache)  │  Flat JSON, source of truth
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│     GitHub Pages      │  Static site: index.html (Leaflet + FullCalendar)
└───────────────────────┘
```

### Core technologies

| Layer | Technology |
|---|---|
| Runtime & scripting | Node.js 22, standard library only (`fs`, `path`, `crypto`, global `fetch`) |
| AI & search grounding | Google Gemini API (`gemini-3.6-flash`, override with `GEMINI_MODEL`) with `{ google_search: {} }` |
| Geocoding | BAN — Base Adresse Nationale (`api-adresse.data.gouv.fr`), free, no key |
| CI/CD & automation | GitHub Actions (`.github/workflows/daily-check.yml`) |
| Data storage | Flat JSON files (`data.json`, `geocode-cache.json`) |
| Frontend | Static `index.html`, Leaflet 1.9.4 (map), FullCalendar 6.1.11 (+ French locale) |
| Hosting | GitHub Pages |

### Repository layout

| File | Location in repo |
|---|---|
| Extraction pipeline | `scripts/fetch-events.js` |
| DATAtourisme — shared library (download, parse, match) | `scripts/datatourisme.js` |
| DATAtourisme coverage probe (observation only) | `scripts/datatourisme-coverage.js` |
| Workflow | `.github/workflows/daily-check.yml` |
| Frontend | `index.html` |
| Event data (generated) | `data.json` |
| Geocoding cache (generated) | `geocode-cache.json` |
| Coverage workflow | `.github/workflows/datatourisme-coverage.yml` |
| Coverage reports (generated, git-ignored) | `reports/` |

---

## 3. Technical Challenges & Solutions

### A. Model budget & response extraction (v1, in production)

**Problem:** with Search Grounding, `gemini-3.6-flash` consumed most of its token budget in invisible reasoning (`thoughtsTokenCount` ≈ 6000), cutting off the JSON and causing zero-candidate errors. Strict MIME output (`application/json`) also collided with the search tool.

**Solution:** larger output budget, no `response_mime_type`, JSON extracted programmatically from all returned parts.
*v2 update:* budget raised to 16 384 tokens (`GEMINI_MAX_OUTPUT_TOKENS`) because thinking tokens count against it; string-aware array extraction; **truncated outputs are salvaged** (all complete objects are kept) instead of failing the run.

### B. Cloud infrastructure & cost control (v1)

**Problem:** the cloud provider originally required heavy monthly minimums for search-grounded LLM endpoints.
**Solution:** a small prepaid balance on Google Cloud bypassed the barrier.
*v2 update:* every run reports tokens and number of search queries per scan (job summary).
*v2.2 correction:* the original assumption that costs would stay at "fractions of a cent per month" is **not supported by Google's current price list** — see the estimate in §3.G. Real numbers from the run summaries must replace the estimate.

### C. Temporal filtering & GPS integrity (v1)

**Problem:** past events and missing coordinates broke the list and map.
**Solution (v1):** rolling window in the prompt (4 months in v1/v2; **3 months since v2.2**, `WINDOW_MONTHS`), a guard clause on new events, fallback coordinates at Fontainebleau centre.
*v2 update:* see E (past events were never pruned from the stored file; fallback coordinates hid problems).

### D. Client-side caching (v1)

**Problem:** visitors saw stale cached copies of `data.json`.
**Solution:** `fetch('./data.json', { cache: 'no-cache' })`.

### E. Hardening review & v2 changes (September 19, 2026)

A code review of `fetch-events.js`, `daily-check.yml` and `index.html` produced the following fixes (all implemented in v2):

| # | Finding | v2 fix |
|---|---|---|
| 1 | Past events never removed from stored data (filter only applied to new results) | Existing events are re-validated every run and pruned when `endDate < today`; frontend also hides finished events |
| 2 | One malformed record (e.g. missing title) crashed the whole run | Per-record validation; invalid records are dropped and counted by reason |
| 3 | Untrusted web/LLM text injected with `innerHTML`; `javascript:` links possible | All fields HTML-escaped; only `http(s)` URLs accepted; `rel="noopener noreferrer"`; FullCalendar no longer receives raw URLs |
| 4 | Dedup on title only (same title on another date overwrote the first) | Key = normalised title + `startDate` + normalised city |
| 5 | Fragile IDs (`ACT_${length+1}`) that collide once pruning exists | Stable hash ID `EVT_<sha1[0:10]>`; legacy `ACT_` IDs are preserved |
| 6 | Calendar hard-coded to `2026-10-01`; age filter `0` treated as "no filter" | `initialDate` removed (defaults to today); explicit empty-vs-0 handling |
| 7 | Model GPS trusted blindly, any number accepted | Bounding-box guard, BAN geocoding with cache, `geoSource` / `geoApprox` flags |
| 8 | No check that URLs exist | HTTP verification; 404/410/unknown domain dropped, bot-blocked sites kept as `unverified` |
| 9 | Greedy regex, single large prompt limited recall | 4 narrow scans (sport / nature / culture / family), merged and deduplicated |
| 10 | No timeout, retry or backoff | `AbortSignal.timeout`, 3 attempts with exponential backoff on 408/429/5xx |
| 11 | API key passed in the URL query string | Sent in the `x-goog-api-key` header |
| 12 | Workflow: excess permissions, no concurrency, no timeout, push race | `contents: write` only, `concurrency` group, `timeout-minutes: 20`, `pull --rebase` + retry, run report in job summary |
| — | Date computed in UTC; `setMonth` overflow (Oct 31 + 4 months) | Europe/Paris date; overflow-safe month arithmetic |
| — | FullCalendar v6 has no CSS file (link was dead); French locale not loaded | Dead link removed; `@fullcalendar/core` French locale script added; week starts Monday |

**Test status:** v2 was tested **offline with mocked Gemini, BAN and web responses** (unit tests + end-to-end: retries, truncation salvage, dead/blocked URLs, redirect resolution, geocoding fallbacks, idempotence, failure paths), the workflow's commit/rebase/push step against a local bare remote, and the frontend in a simulated DOM (XSS payloads, filters, calendar). v2 has since been deployed and confirmed working; monitoring of the first automated runs continues (Roadmap, Step 0).

### F. Beta-readiness changes & date display (v2.1, September 20, 2026)

| # | Need | v2.1 change |
|---|---|---|
| 14 | Users must know how fresh the data is | `data.json` is now `{ schemaVersion, generatedAt, events }`. The header shows *"Données mises à jour le …"* (Paris time) and turns into a **warning after 3 days without update**. The frontend still accepts the old bare array |
| 15 | Feedback loop for wrong data | **"Signaler une erreur"** link on every card (pre-filled with event ID, title, URL) + a general link in the footer. Channel is configured in one place (`FEEDBACK` block in `index.html`: pre-filled form URL or e-mail); links stay hidden until one is set |
| 16 | Attribution and prudence | Each card shows the organizer and the **source website**, with a "vérifiez auprès de l'organisateur" note; page footer carries the full disclaimer and the OpenStreetMap credit |
| 34 | Listings showed "Sunday" without a date | The date is now **always displayed from the structured `startDate`/`endDate`**, never from free text: *"Dimanche 11 octobre 2026"* (1 day), *"Du samedi 12 au dimanche 13 décembre 2026"* (2–3 days), *"Du 1 octobre au 15 novembre 2026"* (longer). Also shown in the map popup. `schedule` now only carries opening hours (prompt updated) |
| 35 | Weekday in free text can contradict the date | New validation `weekday_mismatch`: a record is dropped when its schedule names a weekday that does not occur within the event's dates (short events only, French or English). Disable with `WEEKDAY_CHECK=0` |

### G. Terms & cost review of Gemini Search grounding (item 13, September 20, 2026)

**Sources read:** Gemini API Additional Terms of Service (effective March 23, 2026), *Grounding with Google Search* documentation and *Gemini API pricing* page (both consulted September 20, 2026), DATAtourisme documentation. This is a technical reading of the published terms, **not legal advice**; Google's interpretation may differ.

#### 1. Terms — "Grounding with Google Search" use restrictions

- The tool may only be used in an application **owned and operated by you** that displays the grounded results, **together with Google's Search Suggestions**, **to the end user who submitted the prompt**.
- It is not allowed to **cache, frame, syndicate, resell, analyse or learn from** grounded results or suggestions. Using the tool to **extract or collect Links programmatically** (for example to find pages to crawl or scrape) is explicitly called a violation.
- Copying or storing grounded results is only allowed in narrow cases (evaluating display, an end user's own chat history, legal compliance).
- Grounded results may not be modified or mixed with other content.
- Other points: only *Paid Services* may be used for users in the EEA, Switzerland or the UK (**satisfied**: billing is enabled); the API must not be used in services directed at people under 18 (the app targets parents and adults — keep in mind for any child-oriented feature).

**Assessment:** our pipeline runs a scheduled job (no end-user prompt), extracts events **and their URLs** from grounded results, **stores them in `data.json`** and **publishes them to every visitor** without Search Suggestions. On a plain reading, this is outside the permitted use. Since the plan is to approach the City, clubs and INSEAD, this is a **launch blocker**, not a detail.

#### 2. Cost — Gemini 3.6 Flash, paid tier

- Tokens (output includes thinking): **$0.75 / $3.75 per million tokens (input / output) until December 31, 2026, then $1.50 / $7.50.**
- Search grounding (Gemini 3.x): **5,000 free search requests per month, then $14 per 1,000**; billed **per individual search query the model executes**, not per prompt. Not available on the free tier.
- `gemini-3.6-flash` is now labelled the *previous generation* Flash model (3.7 and 3.8 exist).
- **Estimate (assumptions to be replaced by real numbers):** 4 scans × ≈15 000 output tokens ≈ 60 000 tokens/day ≈ 1.8 M/month ≈ **$7/month** today and ≈ **$14/month from January**; searches ≈ 4 scans × ≈8 queries × 30 ≈ 1 000/month (inside the free 5 000). A 5 € prepaid balance would therefore last on the order of a month, not years. Widening the search (more scans) multiplies this.

#### 3. Options

| Option | Fits the terms? | Notes |
|---|---|---|
| A. Keep grounding, comply | ❌ Not with a shared, stored, published dataset | Would require displaying results and suggestions only to the prompting user |
| **B. Direct-source extraction (recommended)** | ✅ (per-source terms still to check) | A registry of source pages/feeds; our own fetcher (robots.txt, rate limits); the LLM only **extracts structured fields from the fetched text** — no search tool, so JSON mode works, far less thinking, no per-search fee, and every event is traceable to a source URL |
| C. Open data first | ✅ | **DATAtourisme**: national open-data platform fed by tourism offices, free, open licence, updated daily, includes cultural and sports events; a daily CSV export (dates, city, coordinates, website, description) is published on data.gouv.fr. Also OpenAgenda and city/tourism-office iCal or RSS feeds (coverage of the Fontainebleau area to be verified) |
| D. Interim | ⚠️ Risk accepted knowingly | Keep the current pipeline only for a small private beta, with no institutional outreach on grounded data |

**Decision taken on September 20 (project lead):** option **D + C** — keep Google Search grounding as the main collector, with the risk accepted knowingly, and add DATAtourisme as a second, fully automatic source. Option B (a hand-built source registry) is **dropped for now**: it is more work than the current pipeline, it breaks whenever a site changes, and its starting coverage would be lower than Google's long tail. An app that misses the good local events has no users, and that risk was judged larger than the contractual one for a local project with no revenue.

The reading of the terms in this section still stands — it is the *response* that changed, not the analysis. The conditions attached to accepting the risk are listed in §8.

---

### H. DATAtourisme — measured, not estimated (item 44, September 20, 2026)

The real dataset was downloaded and analysed rather than read about. Three findings contradicted the documentation-based assumptions:

1. **A much lighter file exists.** `datatourisme-reg-idf.csv` (**9 MB**, Île-de-France, so Seine-et-Marne included) replaces the national events file `datatourisme-fma.csv` (64 MB) with the same local coverage.
2. **The data is fresh.** Every CSV was updated the same day (September 20), not 7 days old as first reported. The fallback to the authenticated official flux is unnecessary.
3. **The real schema has none of the expected columns.** A script written from the documentation would have failed on the first run.

| Expected | Actual |
|---|---|
| `startDate` / `endDate` | `Periodes_regroupees` → `2026-10-22<->2026-10-25`, several periods separated by `\|` |
| city | `Code_postal_et_commune` → `77300#Fontainebleau` |
| event URL | buried in `Contacts_du_POI` → `Label#http://…` |
| category | pipe-separated list of ontology URIs (`…core#TheaterEvent`) |
| price | **does not exist** |

**Measured coverage** (bounding box of the project, 3-month window, against the 125 events then in `data.json`):

| Measure | Value |
|---|---|
| Events in the box and the window | 56 |
| … short (≤ 14 days) | 29 |
| … recurring / year-round | 27 |
| Already present in `data.json` | 2–3 |
| **Absent, short** | **27** |

**Reading:** the two sources are almost disjoint. DATAtourisme does not validate Gemini, it **complements** it. The overlap is measured on normalised titles, so it is a lower bound.

**Merged into the pipeline the same day (§3.I)**, ahead of the "two or three weekly reports" gate originally planned for item 45 — the project lead reviewed these measured numbers directly and decided they were enough to act on, rather than wait on repeated runs of the same probe.

What is missing is worth having: Championnat de France de CCE, Jump Bost, the Fontainebleau theatre season, the Nemours prehistory museum programme, concerts, Journées du Patrimoine. Among them **6 `SportsEvent` + 3 `SportsCompetition`** — which attacks item 38 (sports coverage) without touching the grounded prompt.

**The trap:** 23 `Market` + 23 `SaleEvent`, essentially weekly markets published as `2026-01-01<->2026-12-31`. Imported as-is they would saturate the map. The probe classifies them separately (by ontology class or by duration > 14 days) and any future merge must keep them apart or exclude them.

---

### I. DATAtourisme merged into the pipeline (item 45, September 20, 2026)

`scripts/fetch-events.js` now imports `scripts/datatourisme.js` (the module the coverage probe
also uses, so both describe the exact same data) as a **second, independent source**, run
alongside the four Gemini scans on every real scan.

**What is imported:** only the short, dated events (§3.H) — weekly markets and other
`Market`/`SaleEvent` records, or anything spanning more than `DT_SHORT_EVENT_MAX_DAYS` (14) days,
are excluded before the data ever reaches validation. **One record per date**: an event with
several separate dates (e.g. a play performed on five evenings) becomes one `data.json` entry per
date, because the exact date is the useful information and a first-to-last span would misstate
which days it actually runs (decision of September 20).

**Deduplication:** Gemini records are merged first, on the existing exact key
(`title|startDate|city`). DATAtourisme records then go through the same key, and additionally
through `isSameOccurrence()` — a fuzzy check (normalised title match + overlapping date + city not
contradicting) against every already-known record, so a DATAtourisme entry phrased differently
from its Gemini counterpart ("Concert de musique classique" vs. a fuller Gemini title) is still
caught. This fuzzy check is intentionally **per-occurrence**: it must not treat the second showing
of a multi-date event as a duplicate of the first (an earlier version of this logic did exactly
that and silently dropped every extra date — caught before deploy by comparing the merged output
against the source events one by one).

**Validation is identical for both sources:** a DATAtourisme record with no URL (the CSV's
`Contacts_du_POI` field does not always carry one — about 3 of 29 in the September 20 sample) is
rejected by `validateEvent()` exactly like an incomplete Gemini record. `organizer` is left empty
for DATAtourisme events — the CSV only names the data publisher (a tourism agency), not the actual
event organizer — so the card shows the source domain alone rather than a misleading attribution.

**Provenance:** DATAtourisme events carry `source: "datatourisme"`; Gemini events have no `source`
field (kept `undefined` so every pre-existing `data.json` entry stays byte-identical). The
frontend does not currently read this field — it exists for debugging and for a future UI
distinction (item 46).

**Failure tolerance:** either source can fail without stopping the run — the guard now reads *"all
Gemini scans failed **and** DATAtourisme failed"* rather than *"all Gemini scans failed"*. Verified
by forcing every Gemini scan to fail (invalid key) and confirming DATAtourisme alone still produced
a valid, published update.

**Known pre-existing issue surfaced by this test, not caused by it:** two Gemini-only duplicates
already existed in `data.json` before today — the same event stored twice under two different
commune spellings (a "Salon du Champignon" listed for both Fontainebleau and Avon, a "Grand Noël de
Vaux-le-Vicomte" listed for both Maincy and Vaux-le-Vicomte). The exact key includes the city, so
two spellings of the same place create two records. Tracked as item 47.

### J. Fuzzy same-day duplicate cleanup (item 47, September 20, 2026)

**Trigger:** while reviewing the live site, the project lead spotted duplicate cards — the same
event listed twice under two different commune spellings ("25ème Salon du Champignon" under both
Fontainebleau and Avon; "Le Grand Noël de Vaux-le-Vicomte" under both Maincy and Vaux-le-Vicomte —
the château is administratively in Maincy). `eventKey()` (title + startDate + city) cannot catch
these: the city genuinely differs between the two records.

**A wider audit surfaced more of the same pattern**, not caught by an exact key either because
the title itself was reworded rather than the city: "Le Grand Noël de Vaux-le-Vicomte" also existed
as "…au Château de…" and "…du Château de…" (three spellings of one event, all in Maincy);
"Animations Toussaint : Blandy des Légendes" and "Blandy des Légendes : Animations de la Toussaint"
(same words, reordered); "Championnat de France CCE" and "…de CCE" (one added word). All are a
direct consequence of the four parallel Gemini scans (sport/nature/culture/famille, item 9) each
independently re-discovering the same real event and phrasing it slightly differently.

**The fix — `dedupeFuzzy(records, stats)`, called on every run, over the full merged set (stored
+ new, from every source):**

- Titles are reduced to a **canonical signature**: lower-cased, accents stripped, split into
  words, grammatical connectors removed (*le, la, de, du, au, château, …*), remaining words
  sorted. Two records **merge automatically** only when their signature is identical AND their
  date is identical — i.e. they carry the exact same set of meaningful words, regardless of word
  order, connectors, or the city label. Two unrelated real events sharing every content word in
  their name, on the same day, within the 15 km collection radius, would be an extraordinary
  coincidence, so this is treated as certain.
- **Deliberately not fuzzy beyond that.** A pair that merely *overlaps* — "Meeting d'Automne TDA"
  vs "Meeting d'Automne TDA Poneys" / "…Équitation" — is left alone: these read like two
  disciplines of the same meeting, not certainly the same record, and a wrong merge silently
  deletes a real event, which the project treats as worse than an extra card. Such pairs (same
  date, high but non-identical word overlap, Jaccard ≥ 0.6) are only **reported**
  (`stats.similarSameDay`, printed in the run summary) for a human to judge — never merged.
- **Which record survives a merge:** an already-stored record over a brand-new one (keeps a
  stable id and any already-verified URL); among ties, whichever already has `urlStatus: "ok"`;
  among further ties, a legacy `ACT_` id over a hash `EVT_` id; the loser's useful fields
  (organizer, description, city, locationName if the winner lacks them) are merged into the
  winner via the existing `mergeInto()` before it is dropped.
- **Tested against the real, live `data.json`** before this was applied: every one of the 9 pairs
  it merged was manually reviewed and confirmed to be a genuine rewording, not a distinct event
  (the sports "TDA Poneys/Équitation" and "Championnat de France CCE / …au Grand Parquet" pairs
  were confirmed to correctly stay **separate**, appearing only in the review list).

**Immediate cleanup, September 20:** applied once by hand (no network calls — the existing
`fromExisting()`/`dedupeFuzzy()`/`serializeEvent()` functions, exported for this purpose, reused
directly against the stored file) to the then-live `data.json`: **161 → 152 events**, 9 duplicates
merged. Going forward this runs automatically as step 3b of every real scan, so it is
self-healing, not a one-off — the next re-occurrence of this pattern (from Gemini, from
DATAtourisme, or between the two) is fixed the same way without intervention.

### K. Manual overrides — the feedback loop gets an output (item 24, September 21, 2026)

Item 15 shipped the *input* of the feedback loop (a "report an error" link on every card,
feeding a Google Form). It had no *output*: `data.json` is regenerated from scratch on every
scan, so a correction made there is erased by the next run. A visitor could report a wrong date
and nothing could be done about it that lasted.

`overrides.json` is now the only hand-edited data file in the repository, and it is applied on
every run:

```json
{
  "EVT_cd4a6118fa": {
    "note": "Date corrigée après signalement du 21/09",
    "fields": { "startDate": "2026-10-03", "price": "12 €" }
  },
  "EVT_0badc0ffee": { "hidden": true }
}
```

**Why it is keyed by event id.** The id is `sha1(title|startDate|city)` of the *original*
record. A fresh scan that re-reports the same event with the same wrong date derives the same
id, so it picks the same override up again. The correction is durable by construction — there
is no `locked: true` flag to set and no state to maintain.

**Why the record map is re-keyed afterwards.** `title`, `startDate` and `city` are exactly the
three parts of `eventKey()`. Correcting any of them moves the record to a different key, while
the next scan still reports the uncorrected one under the old key — both would be published, so
the fix would *create* the duplicate it was meant to remove. `applyOverrides()` therefore
re-keys the whole map and merges the collision. This is covered by a test that simulates a full
round trip: correct, serialise, reload, re-inject the uncorrected sighting — one record out,
carrying the corrected date.

**Order in the pipeline.** After the fuzzy dedup, before geocoding and URL verification, so a
hand-corrected address is actually geocoded and a hand-corrected link is actually checked.
Corrections to `lat`/`lng` set `geoSource: "manual"` and are never overwritten; corrections to
`city` or `locationName` drop the cached position and force a re-geocode.

**Nothing is accepted blindly.** Every value goes through the same coercion as pipeline data
(`isValidIsoDate`, `cleanUrl`, `cleanText`, `normalizeCategory`). A value that fails is skipped
and named in the run report, never written. Two traps found while testing: `cleanUrl()` and
`normalizeCategory()` answer `null` on a value they refuse, which would have *blanked* the field
instead of leaving it alone; and blanking `title` or `city` would produce a garbage `eventKey`.
Both are now rejections. An override matching no event is reported so the entry can be pruned.

**Still manual.** The form responses are not yet read by anything: a human reads the sheet and
writes the entry. Automating the ingestion is a separate step (see §9, item 48) and deliberately
not the same decision — the form is open to anyone with the link, so it is an unauthenticated
write path into published data.

### L. English interface (item 33, phase 1, September 21, 2026)

A FR/EN switch in the header, `?lang=` in the URL, the choice remembered per visitor, and the
browser's own language as the initial guess. 48 interface strings in a `STRINGS` dictionary.

**Event data stays French, deliberately.** Titles, descriptions, schedules and prices are shown
exactly as the organisers publish them. A translated title cannot be matched back to the real
event: a visitor who reads "Mushroom Fair" finds nothing under that name on the organiser's
site, on a poster or at the ticket desk. In English the footer says so in one line. This also
keeps the recurring translation cost at zero — measured at ~8,700 tokens for a full pass over
the 152 events, which is cheap but not free, and would have to be re-paid for every new event.

**Category values are not translated either** — they are the data enum (`Sport & Outdoor`,
`Nature & Environnement`, `Culture & Ateliers`) and the `<option value>` the filter matches on.
Only the displayed label moves, through `categoryLabel()`. A test asserts that filtering still
returns results after switching to English, because translating the values would silently break
every filter.

### M. Period filter (item 49, September 21, 2026)

A fourth filter beside "date spécifique": today / next 2 weeks / next 3 months, defaulting to
3 months, which is exactly the previous behaviour. An event matches as soon as it *starts* on or
before the last day of the period — one that started last week and runs until December is still
shown under "Today", which is what a visitor means by "what can I do today".

A specific date **overrides** the period rather than intersecting with it, so picking a date two
months out while the period says "today" cannot return an empty list.

---

## 4. Data Schema (`data.json`, v2.1)

Since v2.1 the file is an object (v1/v2 wrote a bare array; both are read by the script and the frontend). Fields added in v2 are marked ★.

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-09-20T06:03:12.000Z",
  "windowEnd": "2026-12-20",
  "events": [
    {
      "id": "EVT_3fa9c01b7e",
      "title": "String",
      "category": "Sport & Outdoor | Nature & Environnement | Culture & Ateliers",
      "ageMin": 0,
      "ageMax": 99,
      "city": "String",
      "locationName": "String",
      "lat": 48.4021,
      "lng": 2.7012,
      "geoSource": "ban | model | city | default",
      "geoApprox": false,
      "dateType": "event",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "schedule": "Opening hours only, e.g. 10h–18h",
      "price": "String",
      "organizer": "String",
      "description": "String",
      "url": "String (http/https URL)",
      "urlStatus": "ok | unverified",
      "urlCheckedAt": "YYYY-MM-DD",
      "source": "datatourisme (absent for Gemini events)"
    }
  ]
}
```

★ `geoSource`, `geoApprox`, `urlStatus`, `urlCheckedAt`. ★★ `source` (v2.3, DATAtourisme events only).

**Rules**

- **Identity:** key = `normalise(title) | startDate | normalise(city)`; `id` = hash of the key. Existing IDs (e.g. `ACT_002`) are kept.
- **Geocoding order:** BAN venue match (score ≥ 0.6, inside bounding box) → model coordinates (inside bounding box) → BAN city centroid → Fontainebleau centre. Only `ban` is considered verified (`geoApprox: false`).
- **Bounding box:** lat 48.20–48.65, lng 2.45–3.00.
- **URLs:** 2xx/3xx → `ok`; 404/410/non-existent domain → event dropped; anything else (403, 429, 5xx, timeout) → `unverified`, kept. Google grounding redirect links are resolved to the real page or the event is dropped. Checks are repeated every 7 days.
- **Categories:** exactly three values; common variants (e.g. "Nature & Patrimoine") are mapped, anything else is rejected.
- **Re-sighting of a known event:** `endDate`, `schedule`, `price` are refreshed; text fields are kept (avoids daily LLM rewrites); a verified URL is kept stable.
- **Dates and hours:** `startDate`/`endDate` are the source of truth for display; `schedule` holds hours only. A schedule naming a weekday that contradicts the dates causes the record to be rejected (`weekday_mismatch`).
- **`windowEnd`:** last day of the collection window (today + `WINDOW_MONTHS`, Paris date). Events **starting after** it are kept in the file but **hidden by the frontend**, so nothing already discovered is lost when the window is reduced and events appear as the window slides forward.
- **`generatedAt`:** ISO timestamp (UTC) of the last run that changed the data, refreshed once per Paris day even when nothing changed. Result: at most one bot commit per day when the data is stable.
- **Output:** events sorted by `startDate`, then title; file rewritten only if content or the daily stamp changed.

---

## 5. Pipeline Behaviour & Safety Nets

| Situation | Behaviour |
|---|---|
| One scan fails (after 3 attempts) | Other scans continue; run succeeds; failure shown in the report. Events are pruned **only by date**, never by absence, so a partial failure deletes nothing |
| DATAtourisme unreachable or its schema changed | Gemini results are still published; the failure is shown in the report (`stats.dt.error`); `data.json` is not blocked on it |
| All scans fail, or no valid event returned | Run **fails** (exit 1); `data.json` untouched; GitHub notifies |
| Every source fails (all 4 Gemini scans **and** DATAtourisme) | Run **fails** (exit 1); `data.json` untouched |
| Two records share the same date and, once reworded, the same meaningful words | Merged automatically (§3.J); reported in the summary as `crossCityDeduped` |
| Two records share a date and are merely *similar* (not word-identical) | Left as two records; listed in the summary (`similarSameDay`) for manual review, never auto-merged |
| `data.json` corrupted / not an array | Run fails; file never overwritten |
| Output truncated at token limit | Complete objects are salvaged; flagged in the report |
| Record invalid (date, category, URL, location, weekday…) | Dropped, counted by reason (`invalid_start_date`, `invalid_url`, `dead_url`, `weekday_mismatch`, …) |
| Data updated less than `MIN_RUN_INTERVAL_HOURS` (60 h) ago | Run **skipped**: exit 0, no Gemini call, no cost, `data.json` untouched; the job summary says when the next scan is due. A manual dispatch (`FORCE_RUN=1`) and a local `DRY_RUN` always execute |
| Nothing changed | No write, no commit (except the once-a-day `generatedAt` refresh) |
| `main` moved during the run | `git pull --rebase` + up to 3 push attempts |

**Migration note (first v2 run):** stored events go through the same validation. Legacy events with an invalid category or URL, and past events, are removed (git history is the backup); legacy coordinates are re-geocoded once and then cached.

---

## 6. Operations Runbook

- **Secrets:** `GEMINI_API_KEY` (GitHub → Settings → Secrets and variables → Actions).
- **Manual run:** Actions → *Check Quotidien & Mise à jour Data Gemini* → *Run workflow*.
- **Run report:** open the run → *Summary* (scans, tokens, search queries, added/refreshed/pruned, dead URLs, geocoding sources, rejection reasons).
- **Local dry run** (writes nothing): `GEMINI_API_KEY=… DRY_RUN=1 node scripts/fetch-events.js`
- **Force a scan despite the cadence:** `GEMINI_API_KEY=… FORCE_RUN=1 node scripts/fetch-events.js` (a manual *Run workflow* does this automatically)
- **DATAtourisme coverage probe:** Actions → *Couverture DATAtourisme (observation)* → *Run workflow*, or locally `node scripts/datatourisme-coverage.js`. It downloads ~9 MB, writes only `reports/`, and never touches `data.json`. Use `DT_CSV_PATH=…` to run against a local copy.
- **Environment variables (pipeline):** `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS` (16384), `MAX_EVENTS_PER_SCAN` (20), `WINDOW_MONTHS` (3), `MIN_RUN_INTERVAL_HOURS` (60), `FORCE_RUN`, `DATA_PATH`, `GEOCODE_CACHE_PATH`, `WEEKDAY_CHECK` (set `0` to disable), `DRY_RUN`, `DATATOURISME` (set `0` to collect from Gemini only), `DT_SHORT_EVENT_MAX_DAYS` (14), `DT_MAX_PERIODS` (12, caps dates per event), `DT_CSV_PATH` (local CSV, skips the download).
- **Environment variables (coverage probe):** `WINDOW_MONTHS` (3), `DT_SHORT_EVENT_MAX_DAYS` (14), `DT_MAX_EXAMPLES` (20), `DT_REPORT_DIR` (`reports`), `DT_CSV_PATH`, `DATA_PATH`.
- **Cadence:** the workflow triggers daily but the script only scans when `data.json` is older than `MIN_RUN_INTERVAL_HOURS`. A skipped day exits 0, calls nothing and writes nothing; the job summary says so. A failed or skipped day is retried the next morning rather than three days later.
- **Feedback links (frontend):** in `index.html`, fill the `FEEDBACK` block. `formUrl` = a pre-filled form link where `{id}`, `{title}`, `{url}` mark the values to inject (for Google Forms: *⋮ → Get pre-filled link*, type `{id}`, `{title}`, `{url}` in the three pre-filled fields, *Get link*, paste it as `formUrl`; Google writes the braces as `%7B…%7D` and both forms are handled). Suggested form fields: event ID, title and link (short-answer fields, pre-filled by the link), type of problem (date / place / price / dead link / cancelled / other), details, optional contact. `email` = simplest option, but the address is visible in the page source. Leave both empty to hide the links.
- **Rollback:** `git revert` the bot commit (every data change is a commit).
- **Pages:** assumed to deploy from the `main` branch ("Deploy from a branch" in Settings → Pages); after the first v2 run, confirm the site shows the new data.

---

## 7. Decisions Log

| Date | Decision | Rationale / trade-off |
|---|---|---|
| 2026-09-19 | **Pipeline stays fully automatic and publishes straight to `main`** (no manual review queue), including during the beta | Keeps the system autonomous and low-effort. Risk of publishing a wrong event is mitigated by validation, URL verification, geocoding checks and the "report an error" loop (planned) rather than by a human gate |
| 2026-09-19 | Several narrow scans instead of one large prompt | Better recall, smaller outputs, partial-failure tolerance |
| 2026-09-19 | Prune by date only, never by absence from scans | LLM recall varies day to day; absence does not mean cancellation |
| 2026-09-19 | Keep `data.json` as a bare array for now | Avoids breaking the frontend; `{generatedAt, events}` planned with the "last updated" feature |
| 2026-09-20 | `data.json` becomes `{ schemaVersion, generatedAt, events }`; both readers accept the old array | Needed for the "last updated" banner; backward compatible so deploy order does not matter |
| 2026-09-20 | `generatedAt` refreshed once per Paris day, not on every run | Honest freshness signal without a commit on each run |
| 2026-09-20 | Display dates from structured fields only; `schedule` = hours only | Free-text weekdays ("Sunday") were ambiguous and can contradict the real date |
| 2026-09-20 | Reject records whose schedule weekday contradicts the dates | Trust over recall: an inconsistent record is likely to have a wrong date |
| 2026-09-20 | Feedback channel configured in one `FEEDBACK` block, links hidden until set | No contact address hard-coded |
| 2026-09-20 | **Feedback channel = Google Form** | Structured reports collected in a sheet; no e-mail address exposed in the page |
| 2026-09-20 | Collection window reduced from 4 to 3 months; `windowEnd` added, events beyond it hidden not deleted | Avoids saturating map and list; keeps already-found events for when they enter the window |
| 2026-09-20 | Age shown as "Tout public" / "Dès X ans" / "Jusqu'à Y ans" / "X–Y ans"; `ageMax ≥ 90` = no upper limit | "0-99 ans" was noise |
| 2026-09-20 | Terms review: Google Search grounding does not fit a stored, published dataset (§3.G) → **plan to move to direct-source extraction**. Decision pending on the interim period | Compliance, cost and traceability |
| 2026-09-20 | **Governance: the grounding risk is accepted knowingly.** Google/Gemini stays the main collector; the full pivot to a source registry (item 37) is dropped | A local project with no revenue and no users is the bigger risk. The exposure is contractual (key or project suspension), not a lawsuit; `data.json` is versioned in git, so the site survives a cut-off. Conditions in §8 |
| 2026-09-20 | Dedicated Google Cloud project, billing account and API key — verified, no separate Google account created | Isolates a possible suspension from SpacePlan, Helioso and GardenBrawls without the cost of a second identity |
| 2026-09-20 | **Cadence: one real scan every ~3 days**, implemented as a 60 h guard inside the script rather than a `*/3` cron | A `*/3` cron is irregular at month boundaries and cannot catch up. The daily trigger + threshold retries a failed or skipped day the next morning. Cost divided by ~3 |
| 2026-09-20 | Stale-data warning moved from 3 to 5 days | Must leave room for one missed run at the new cadence |
| 2026-09-20 | **DATAtourisme added as a second source**, starting in observation mode | Measured: ~27 short events absent from `data.json`, including sports competitions. Sources are almost disjoint, so it complements rather than replaces (§3.H) |
| 2026-09-20 | The coverage probe uses the **regional** file `datatourisme-reg-idf.csv` (9 MB), not the national events file (64 MB) | Same local coverage, seven times lighter |
| 2026-09-20 | Weekly markets (`Market` / `SaleEvent`, or duration > 14 days) are classified apart | Imported as-is they would saturate the map and the list |
| 2026-09-20 | **DATAtourisme merged into the pipeline as a second source**, ahead of the "two or three weekly reports" gate | The project lead reviewed the measured coverage (§3.H) directly and judged it sufficient, rather than wait on repeated identical probe runs |
| 2026-09-20 | A multi-date DATAtourisme event becomes one `data.json` record per date, not one record spanning first-to-last | An exact date is the useful information; a span would misstate which days the event actually runs |
| 2026-09-20 | Fuzzy dedup against Gemini uses a stricter per-occurrence rule (`isSameOccurrence`) than the coverage report's per-event rule (`isSameEvent`) | The report's rule (same city OR overlapping dates) would treat two dates of the same play as duplicates of each other once each date is its own record, and silently delete one |
| 2026-09-20 | DATAtourisme events ship with `organizer` left empty | The CSV names the data publisher, not the real organizer; a wrong attribution is worse than none |
| 2026-09-20 | **Fuzzy same-day duplicates merged automatically on every run** (§3.J), scoped to word-set-identical titles only | Live duplicates spotted by the project lead; the exact-word-set rule is safe enough to automate, a looser fuzzy match is not (risk of hiding a real event) |
| 2026-09-20 | The live `data.json` was cleaned once by hand, offline, with the same function the pipeline now runs automatically | 161 → 152 events; no reason to wait for the next scheduled (paid) scan to fix duplicates already known |
| 2026-09-21 | **`overrides.json`, keyed by event id, is the only hand-edited data file** and is re-applied on every run (§3.K) | The "report an error" link had no output: `data.json` is regenerated each scan, so any correction made there was erased. Keying by id makes the fix survive a re-scan with no flag to maintain |
| 2026-09-21 | `applyOverrides()` re-keys the record map and merges collisions | `title`/`startDate`/`city` are `eventKey()`; correcting one of them would otherwise publish both the corrected record and the next scan's uncorrected sighting |
| 2026-09-21 | An override with an invalid value is **skipped and reported**, never written; `title` and `city` cannot be blanked | `cleanUrl()`/`normalizeCategory()` return `null` on refusal, which would have wiped the field; an empty title produces a garbage key |
| 2026-09-21 | Form responses are **not** auto-applied yet; a human still transcribes them into `overrides.json` | The form is open to anyone with the link — an unauthenticated write path into published data. Automating ingestion is item 48 and a separate risk decision |
| 2026-09-21 | **English version = interface only. Event data stays French** (§3.L) | A translated title cannot be matched back to the real event on a poster, a ticket desk or the organiser's own site. Also keeps the recurring translation cost at zero |
| 2026-09-21 | Category **values** stay French; only the displayed label is translated | The values are the data enum and the `<option value>` the filter matches on — translating them breaks every filter silently |
| 2026-09-21 | Language resolution: `?lang=` → stored choice → browser language → French | Makes a link shareable in a chosen language, and an INSEAD visitor lands in English without hunting for a switch |
| 2026-09-21 | Period filter defaults to "3 mois", and a specific date overrides it instead of intersecting | The default reproduces the previous behaviour exactly; intersecting would let an empty result look like a bug |
| 2026-09-21 | Helioso logo + link in the footer, AVIF with a PNG fallback | The PNG is 483 KB and is only fetched by a browser without AVIF support |

---

## 8. Risks & Open Questions

| Risk / question | Mitigation / next step |
|---|---|
| LLM hallucination (dates, prices, venues, URLs) | Validation + URL checks + geocoding flags now; "report an error" link and source attribution planned; manual review of the first weeks of data before outreach |
| 🟠 **Google Search grounding terms** (§3.G): results may only be shown, with Search Suggestions, to the prompting end user; no caching, storing, syndicating or link collection. **Risk accepted knowingly on September 20** | Conditions: dedicated Google Cloud project, billing account and API key (done, item 43); key restricted to the Gemini API; budget alert; `data.json` versioned in git so the site survives a suspension. Exposure grows with visibility — **re-assess before contacting the City or INSEAD**, when DATAtourisme coverage will also be known |
| 🟢 Cost: estimated ≈ $7/month now, ≈ $14/month from January 2027 at a daily cadence (§3.G). **Divided by ~3 by the new cadence** → roughly $2–5/month | Still to be replaced by real run-summary numbers (item 39); budget alert on the dedicated project |
| DATAtourisme CSV schema may change | The probe validates the columns and **fails loudly**, listing the columns actually found, instead of producing an empty report |
| Legal / attribution: reuse of organizers' listings | Always link to the source; consider contacting large sources; prefer structured/open data where available |
| Scheduled workflows can be auto-disabled after 60 days of repository inactivity | Verify how bot commits count; add a keep-alive if needed |
| Model name / API changes (`gemini-3.6-flash`) | Model is configurable via `GEMINI_MODEL`; failure is loud (exit 1) |
| Recall of a single source family (web search only) | Source registry + open data (items 37, 27, 38) |
| Cancelled events stay listed until their end date | Future: stale/`lastSeen` detection, "report an error" feedback |

---

## 9. Roadmap & To-Do List (by priority)

**Legend:** `[x]` done and in production · `[~]` implemented in v2 code, **to be verified in production** · `[ ]` open

### Done (v1)

- [x] Set up Google Cloud billing and Gemini API key configuration
- [x] Configure GitHub Actions workflow for scheduled runs
- [x] Robust regex JSON extraction for `gemini-3.6-flash`
- [x] Rolling date window (4 months, now 3) and GPS fallbacks
- [x] Clean historical database placeholders
- [x] `{ cache: 'no-cache' }` in the frontend `fetchData()`

### Step 0 — Deploy and verify

- [x] Deploy v2 and v2.1 (`scripts/fetch-events.js`, `.github/workflows/daily-check.yml`, `index.html`) — confirmed working September 20
- [x] Deploy v2.2: 3-month window (`windowEnd`), age labels, Google Form placeholder fix — confirmed September 20 (`data.json` now `{ schemaVersion, generatedAt, events }`, 125 events)
- [x] Deploy v2.3 (`scripts/fetch-events.js`, `index.html`, `daily-check.yml`, + `scripts/datatourisme-coverage.js` and `datatourisme-coverage.yml`): ~3-day cadence, 5-day stale warning, DATAtourisme probe — pushed September 20, live site verified (`formatAge` and `STALE_AFTER_DAYS` served, old `0-99 ans` label gone)
- [x] Check that a `windowEnd` field appears in `data.json` — present since the run of September 20, 14:00 UTC (`"windowEnd": "2026-12-20"`, 161 events). The frontend's 3-month filter is now active
- [ ] Run the DATAtourisme workflow once on GitHub and confirm the real CSV parses there as it does locally
- [x] Create the Google Form and paste its pre-filled link in `FEEDBACK.formUrl` — done September 20. Link verified locally against a real event (accents, apostrophes and French quotes round-trip correctly; the footer link leaves the three fields empty). **Remaining: publish the form with "anyone with the link" as the responder setting**, otherwise visitors hit a permission error
- [ ] Read the token and search-query numbers of a real run summary and compare with the §3.G estimate
- [ ] Monitor the first 3–5 automated runs: recurring execution, no duplicates, rejection reasons, dead-link count, geocoding sources, tokens/search queries per scan (cost check)
- [ ] Confirm GitHub Pages redeploys after the bot's push

### P0 — Critical correctness & security (before beta)

- [~] 1. Prune past events on every run (pipeline) and hide them in the frontend
- [~] 2. Per-record validation; a bad record must never crash the run
- [~] 3. Escape all untrusted content in the frontend; accept only `http(s)` URLs
- [~] 4. Dedup key = title + startDate + city (replaces title-only)
- [~] 5. Stable hash IDs (replaces `ACT_${length+1}`)
- [~] 6. Frontend bugs: hard-coded calendar `initialDate`; age filter `0`

### P1 — Quality & reliability (before beta)

- [~] 7. GPS: bounding-box guard, BAN geocoding + cache, `geoApprox` flag
- [~] 8. URL verification (dead links dropped, bot-blocked kept as `unverified`)
- [~] 9. Robust JSON extraction + several narrow scans
- [~] 10. Timeout, retry and exponential backoff on API calls
- [~] 11. API key moved from URL to header
- [~] 12. Workflow hygiene: least privilege, concurrency, timeout, rebase-and-retry push, run report
- [x] 13. Cost & terms check — done September 20 (§3.G). **Result: the grounded approach does not fit the terms and costs more than assumed → items 37–40**
- [x] 40. **Decision (owner: project lead):** grounded runs continue, risk accepted knowingly, with the conditions of §8 — decided September 20
- [ ] ~~37. **Compliance pivot:** replace Google Search grounding with direct-source extraction~~ — **dropped September 20.** More work than the current pipeline, fragile to site changes, lower starting coverage. Revisit only if Google suspends the key or if DATAtourisme turns out to cover enough on its own (item 45)
- [x] 42. **Cadence of ~3 days:** 60 h guard inside the script, daily trigger, `FORCE_RUN=1` on manual dispatch; stale warning moved to 5 days
- [x] 43. **Google Cloud isolation:** dedicated project, billing account and API key — verified September 20. Remaining: restrict the key to the Gemini API, and set a budget alert
- [x] 44. **DATAtourisme coverage probe:** `scripts/datatourisme-coverage.js` + weekly workflow, observation mode, written against the **verified** schema and tested on the real file (§3.H)
- [x] 45. **DATAtourisme merged into the pipeline** (§3.I) — decided and shipped September 20, ahead of the original "two or three weekly reports" prerequisite (explicit call by the project lead on the measured numbers). Verified: Gemini forced to fail entirely, DATAtourisme alone still produced a valid publish; multi-date events keep every date; one real cross-source duplicate caught
- [ ] 46. Frontend: visually distinguish `source: "datatourisme"` cards, or a filter toggle — currently invisible to visitors. **Note (September 21): no published event carries `source` yet** — the live `data.json` predates the merge of item 45, so this cannot be verified until the first real scan after it
- [x] 48a. **`overrides.json` — the feedback loop gets an output** (§3.K). Hand-edited, applied on every run, keyed by event id so a correction survives a re-scan. Tested offline against the real `data.json`, including a full correct→publish→reload→re-sight round trip
- [ ] 48b. **Automate the ingestion of form responses**: publish the response sheet as CSV, read it in the pipeline, auto-apply only the safe reversible signal (hide a cancelled / non-existent event), queue everything else in the run report for review. Blocked on the published CSV URL
- [x] 47. **Fuzzy same-day duplicate cleanup** (§3.J) — `dedupeFuzzy()` in `scripts/fetch-events.js`, run every scan over the full merged set. Fixes the two duplicates found while testing item 45, and any future re-occurrence of the same pattern, automatically
- [ ] 27. Open/structured sources first (moved up from P3): DATAtourisme (verify coverage of the Fontainebleau area; daily CSV export on data.gouv.fr), OpenAgenda, city and tourism-office iCal/RSS feeds
- [ ] 38. Widen sports & associations coverage **through the source registry** (club and federation calendars, association agendas, HelloAsso pages, châteaux programmes) — not by tuning the grounded prompt
- [ ] 39. Cost guardrails & model review: log estimated cost per run, budget alert on the Google Cloud project, re-evaluate the model (3.6 Flash is now "previous generation"; prices rise on January 1, 2027; a lighter model may be enough for pure extraction)

### P2 — Beta readiness & product/UX

*Item numbers are stable identifiers, not ranks; the order within each list is the priority.*

**Beta gates (needed to collect useful feedback):**
- [~] 14. "Last updated" timestamp in the UI (`data.json` → `{ generatedAt, events }`, stale warning after 3 days)
- [~] 15. "Report an error" link on each card and in the footer (channel = Google Form; link installed and tested September 20). Form fields, in order: event ID, title, link (the three pre-filled ones), problem type, details, optional contact
- [~] 16. Source attribution + "verify with the organizer" note (card + footer)
- [~] 34. Always show the explicit date for single-day and short (2–3 day) events; `schedule` = hours only
- [~] 35. Weekday-vs-date consistency check (`weekday_mismatch`)
- [ ] 17. Privacy-friendly analytics (GoatCounter / Plausible / Umami)

**Other UX & product:**
- [ ] 18. Marker clustering / spiderfy; distinct style for approximate positions (`geoApprox`)
- [ ] 19. Card ↔ marker linking (cards are already in start-date order, sorted by the pipeline)
- [ ] 20. Error state when `data.json` fails to load; reset-filters button; list view on mobile
- [ ] 21. Category badge normalization on the frontend (existing item); align category set with heritage/château visits
- [ ] 22. Family axis: `family: true` tag / audience filter (age range alone is weak)
- [ ] 23. Decide on recurring events (`dateType: "recurring"` is handled by the frontend but never produced by the extractor)
- [ ] 24. Manual overrides (`overrides.json` or `locked: true`) so hand corrections survive re-scans
- [ ] 25. SRI hashes for CDN scripts (Leaflet, FullCalendar)
- [ ] 26. Open Graph / sharing metadata; accessibility pass on tabs and filters
- [x] 33. **English version, phase 1 — interface only** (§3.L): FR/EN switch with flags in the header, 48-string dictionary, translated category *labels* (values stay French), `lang` attribute, English footer and disclaimer, `?lang=` shareable parameter, browser-language detection, FullCalendar locale follows. **Event data stays French by decision, not by omission** — phases 2 and 3 of the original item are dropped, see §7
- [x] 49. Period filter (today / 2 weeks / 3 months) — **done September 21** (§3.M), default "3 mois" = previous behaviour, a specific date overrides it
- [x] 50. Helioso brand credit in the footer — **done September 21**
- [~] 36. Friendlier age label ("Tout public", "Dès 6 ans", "Jusqu'à 12 ans", "6–12 ans")
- [~] 41. Collection window reduced to 3 months (`windowEnd`; events beyond it hidden, not deleted)

### P3 — Data sources & long-term robustness

- [ ] 28. Stale / cancelled event detection (`lastSeen`, feedback loop) — never by absence alone
- [ ] 29. Failure alerting beyond default GitHub emails (e.g. auto-opened issue)
- [ ] 30. Keep-alive for the scheduled workflow if the 60-day inactivity rule applies
- [ ] 31. Cache dead-URL results to avoid re-checking events re-suggested by the LLM each day
- [ ] 32. Consider a dedicated `data` branch to keep `main` history free of daily bot commits

### Milestones

**Beta gate (friends & family):** Step 0 + P0 (1–6) + P1 (7–12) + items 14–17 and 34–35 (item 15 needs the Google Form link), with at least one week of clean automated runs. **Only as a small private test** while items 37/27 are under way (decision 40).
**Outreach gate (city, clubs, INSEAD…):** **re-assess the grounding risk (§8) with the DATAtourisme coverage figures in hand (items 44, 45)** · item 39 · beta feedback processed · items 16, 24 · manual review of a few weeks of published data. The decision of September 20 accepts the risk for a private beta; institutional outreach is a deliberate increase in visibility and must be decided separately.





link data form to get feedback:
https://docs.google.com/forms/d/e/1FAIpQLScRjLM5_R4K_d-0UUJk7lT1hvP8UBKyBMtniKskJviaG8ZRgw/viewform?usp=publish-editor

