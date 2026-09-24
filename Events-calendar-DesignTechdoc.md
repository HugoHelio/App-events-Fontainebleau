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

### J. Fuzzy same-day duplicate cleanup (item 47, September 20 — rule replaced September 21, see §3.P)

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
**2 weeks** — 53 of the 194 events currently in the window. The default answers "what is on
soon" instead of dumping the full three months; "Dans les 3 mois" reproduces the old view for
anyone who wants it. An event matches as soon as it *starts* on or
before the last day of the period — one that started last week and runs until December is still
shown under "Today", which is what a visitor means by "what can I do today".

A specific date **overrides** the period rather than intersecting with it, so picking a date two
months out while the period says "today" cannot return an empty list.

### N. Feedback ingestion — the loop closes (item 48, September 21, 2026)

`scripts/feedback.js` reads the Google Form response sheet, published as CSV, on every run.
It is the input half of the loop; §3.K is the output half.

**The threat model drives the whole design.** The form is open to anyone with the link, so
every row is an unauthenticated write attempt against published data. Therefore:

| Signal | What happens |
|---|---|
| "n'existe pas", "annulé", "doublon" | **Auto-applied** as `hidden: true`, capped, always listed in the run report |
| "lien mort" | **Not** a hide: the URL's verification stamp is cleared so step 5 re-checks it and drops it on its own evidence |
| wrong date, price, title, place, "autre" | **Never auto-applied.** Queued in the run report for a human to transcribe into `overrides.json` |

Hiding is the only automatic action because it is reversible, idempotent, and the project's
own rule (§5) is that a missing event costs less than a wrong one. Writing a visitor-supplied
date or title into `data.json` is the exact opposite of that rule.

**Burst cap.** More than `FEEDBACK_MAX_AUTO_HIDE` (5) hide requests in one run applies
*nothing* and shouts in the report. Mass-hiding is the attack — emptying the site — so
refusing to act on a burst is the safe failure mode, not applying the first five.

**No state between runs.** Hiding is idempotent, so re-reading the whole sheet every time is
correct and needs no cursor file. The review queue is self-clearing instead: an event that
already has an entry in `overrides.json` drops out of it, so the list shrinks as it is worked
through rather than nagging forever.

**`overrides.json` always wins.** Auto-hides are the base layer, the hand-written file is laid
on top. If a visitor reports "cancelled" and the project lead has written a correction for that
event, the human decision survives.

**The sheet URL is never committed.** Responses can carry the optional contact field, and the
repository is public, which would make it harvestable. It comes from the `FEEDBACK_CSV_URL`
GitHub secret; unset, the feature is simply off. A feedback failure is logged and the scan
continues — the form must never cost a whole run.

**Robust to the form being reworded.** Columns are found by pattern, not by exact header (the
live sheet already has a stray trailing space in one of them), and problem types are matched on
keyword pairs rather than exact labels — "le lien est mort" and "lien cassé" both land on
`recheck`. Every distinct label seen is echoed in the run report with the action it mapped to,
so a miscategorised option is visible on the first run rather than silently mishandled. A CSV
with no id or problem-type column fails loudly instead of guessing.

### X. Static pages for search engines (item 68, September 24, 2026)

**Why.** The site is one page that loads `data.json` with JavaScript. A crawler sees a title, a
map and nothing else: none of the ~200 events is indexable, and nobody searching "que faire à
Samois" can land here. Search traffic is the precondition to any form of monetisation, so this
comes first.

**What.** `scripts/generate-pages.js` runs in the daily workflow right after the collector,
including on the days the cadence guard skips the scan, and writes plain HTML that needs no script:

| Path | Content |
|---|---|
| `/evenements/<titre>-<commune>-<jeton>/` | One page per upcoming event: dates, hours, place, price, age, description, organiser link, "Voir sur la carte", five other events in the same commune. schema.org `Event` markup |
| `/que-faire/<commune>/` | "Que faire à … ?" — every upcoming event in the commune |
| `/que-faire/` | Index of communes, linked from the footer of `index.html` (a plain link, so a crawler finds it without JavaScript) |
| `/sitemap.xml` | All of the above + the home page and `?lang=en` with their `hreflang` pair (the hand-written sitemap of 22/09 is now generated) |
| `/404.html` | **Hand-written, not generated.** What GitHub Pages serves for a missing path — mostly a visitor arriving from a search result for an event that is over |

Pages are French only, like the data they are made of (only `description` is translated, and the
English text is machine output — not something to put in front of a search engine).

**Rules, each one a lesson from earlier in this document:**

- **The script never writes `data.json`.** The first draft did, and rewrote it as a bare v1
  array — dropping `schemaVersion` and `windowEnd` — after crashing on the v2 object it could
  not read. The pipeline stays the only writer: `serializeEvent()` stores `pageUrl` using the
  generator's own `pagePath()`, so the two can never disagree. The field is derived on every
  write, never carried over.
- **Addresses are stable.** A title-date slug changes whenever an override or a merge edits the
  title, and a URL Google already holds breaks. The address ends with a token of the `id` — the
  hash for `EVT_…`, `act014` for the v1 `ACT_014` records still live — and the id is kept for
  the life of a record. When the readable part changes, the old folder becomes a `noindex`
  redirect to the new one.
- **Past events are deleted**, not tombstoned: `404.html` does that job for every one of them,
  with no state to keep. A multi-day event keeps its page until its last day.
- **schema.org `Event` only for events whose link was verified** (`urlStatus: ok`, 173 of 214).
  A rich result with a wrong date is worse than none — the principle of §5 applied to Google.
  An approximate position is not sent as `geo`. An `Offer` is only emitted for an unambiguous
  price (`Gratuit`, `12 €`): "Gratuit pour les adhérents" or "10 € plein, 8 € réduit" would have
  become a false price in a search result. The page itself always shows the full text.
- **Everything is escaped**, JSON-LD included (`<` → `\u003c`, so a title cannot close the
  script block); links go through the same `http(s)`-only check as `safeUrl()` in the frontend.
- **Deterministic, written only on change.** A run with nothing new writes nothing and commits
  nothing. Everything is computed in memory before the first write, so a crash leaves the
  previous pages intact; the workflow step is `continue-on-error` — a page failure never blocks
  the data.
- **The commit names its paths.** `git add -A` at the root was proposed and refused: the bot
  publishes to `main` without review, and any stray file would go live. `-A` is used on
  `evenements/` and `que-faire/` only, so deletions are published too.

**Frontend.** Each card links to its page ("Fiche" / "Page"). `?event=<id>` — the target of the
pages' "Voir sur la carte" — widens the period filter if needed, opens the marker and highlights
the card; it runs once per load.

**Town filter (same day).** A fourth filter, « Ville », next to the period. It passes the test
the age filter failed (§7, 23/09): Fontainebleau holds 142 of 214 events and every other town
1 to 11, so each option returns a genuinely different set. Options are built from the data —
only towns with something upcoming, so no option leads to an empty list by construction.
Choosing a town frames the map on its markers (capped at zoom 14). `?ville=<nom>` is the target
of "Voir sur la carte" on the commune pages; it is applied only if the name is in the list.

**Size.** 214 events → 214 + 25 HTML files, ~2 MB. The first commit is large; after that a
scan touches only the pages whose event changed, plus the commune pages listing them.

**Tested offline** (13 cases, scratch suite): both `data.json` shapes, HTML and `</script>`
injection, `javascript:`/`data:` links, JSON-LD gating, prices, age wording identical to the
cards, past and running events, redirect on title change, legacy ids, slugs, serializer/generator
agreement, sitemap, and an end-to-end run on disk (idempotent, deletions, `data.json`
untouched). Rendered in a headless browser: event page, commune page, 404, and the deep link.

### W2. Sibling duplicates, judged (item 51c, September 24, 2026)

§3.W stopped automatic merging at "sibling" titles — each carries a word the other lacks —
because « Meeting TDA Poneys » / « TDA Équitation » (two competitions) and « Meeting TDA CREIF »
/ « TDA (Tournée des As) » (one) have the same shape. Structure cannot separate them; meaning can.
The shadow comparison (§3.Z) then showed ~15 true duplicates on the live site (« La Flûte
enchantée » ×2, « sentier 17 » ×4, four « Murder Party » at Blandy…), and the project lead asked
for them to go without manual review.

`scripts/dedupe-judge.js`, run after `dedupeFuzzy()` and before the overrides:

1. **Candidates, mechanically**: same occasion (same rule as §3.W — two single days must be the
   same day), compatible towns, shared **distinctive** words: kind-of-event words (concert,
   visite, découverte, initiation…), place words (Fontainebleau, forêt, château…) and the towns
   themselves do not count. ≥ 50 % shared, and a single shared word only if it is long
   (« collectionnistes », not « noël »). 93 pairs on the data of 24/09.
2. **Judged by Gemini without grounding**, both full records side by side (dates, venue,
   organiser, schedule, description, link), temperature 0, structured answer. The prompt names
   the TDA trap and says "in doubt, false". This call compares two records we already hold: no
   search, outside the grounding terms (§3.G), like the translation.
3. **Verdicts cached** in `dedupe-cache.json` (generated, committed), keyed by the two ids. A pair
   is asked once. A duplicate re-reported by a later scan gets back its old id (the id is a hash of
   its key) and is merged again for free. Entries expire after 150 days.

Merging keeps the stored, verified record (id, hence overrides, and title stay) and takes from the
other what it knew better: a deeper page on the same site, an exact position over an approximate
one, an image. Three variants collapse into one whatever order the pairs come in.

Safety: a record hidden in `overrides.json` is never merged (a hidden winner would take its
duplicate down with it); `"keepSeparate": ["EVT_…"]` forbids a pair whatever the verdict — that
is how a merge listed in the run report is undone. Without a key, only cached verdicts apply; a
failing call changes nothing. Tested with a simulated Gemini: merges, siblings kept, cache reuse,
escape hatches, failure, and candidates that must never be asked (two evenings, two towns).

**Note on timing**: the step runs inside a real scan. The cadence guard (60 h) skips everything on
the days in between, so the first merges appear on the next scan.

### Z. Direct sources and the shadow comparison (item 72, September 24, 2026)

**Goal.** Take the published data out of the grounding terms (§3.G, §8) without losing key
events. Decision of 24/09: nothing changes in production until legitimate sources find
**≥ 90 % of the published events over several consecutive runs**; the residue stays on Gemini
as a known, accepted risk. Obscuring provenance was proposed and rejected (§7).

**Survey of the sites behind the Gemini events** (host of the `url` field, 167 events):

| Site | Events | What it exposes | Reader |
|---|---|---|---|
| fontainebleau.fr | 27 | TYPO3 agenda page, plain HTML | `page` (Gemini, no grounding) |
| fontainebleau-tourisme.com | 23 | Apidae list (133 events, paginated) + one page per event in a stable format | `apidae-ot`, **deterministic** |
| anvl.fr | 22 | Calendar from a booking plugin (AJAX); RSS feed | `page` on the feed — partial |
| chateaudefontainebleau.fr | 19 | Agenda page + rich RSS feed | `page` |
| chateau-blandy.fr | 10 | "Programmation à venir" | `page` |
| grandparquet.com | 9 | **`.ics` feed** (The Events Calendar) | `ics`, deterministic |
| aaff.fr, vaux-le-vicomte.com, ville-melun.fr | 8 + 3 + 3 | Agenda built by JavaScript: the raw page holds no event; a headless browser did not recover them either | not read (`enabled: false`) |
| david-nature.com | 3 | `robots.txt`: `Disallow: /` for every robot | **never read** |

Most Gemini events point to a site's **home page**: the model found the event somewhere but did
not keep the page. Direct reading gives each event its own page — a quality gain on its own.

**Code.** `sources.json` (hand-edited registry) → `scripts/sources.js` (readers) →
`scripts/compare-sources.js` (comparison, report). Workflow `sources-compare.yml`: Mondays and on
demand, **read-only** (`contents: read`), report in the job summary and as an artifact. Nothing
it reads is published.

- Manners: identified user agent, `robots.txt` honoured (own group first, then `*`, longest rule
  wins), one request per second per host, page caps. The tourist office costs ~110 requests per
  run, about two minutes.
- `apidae-ot` is deliberately **not** model-based: dates come from "Périodes d'ouverture" through
  a tested French date parser (`Du 05/06 au 02/11/2026`, `Du vendredi 2 au dimanche 4 octobre
  2026`, several periods in a row…). The town comes from the list's `data-apidae-commune`, not
  from the page: the first postcode on an event page is the tourist office's own address.
- `page` sends the page text to Gemini **without the search tool**, structured JSON output, with
  links kept as `text (url)` so each event can get its own page. (A first version wrote
  `<url>`, which the tag stripper then removed: caught by a test.)
- Matching: *certain* = same or contained title (≥ 12 characters), or all distinctive words
  shared; *probable* = ≥ 70 % of distinctive words shared. Always with overlapping dates and a
  compatible town. Kind-of-event words (exposition, concert, visite…) and place words (Fontainebleau,
  forêt, château…) do not count: on the first run DATAtourisme's all-year "Le marché de
  Fontainebleau" matched every "… en forêt de Fontainebleau".

**First run, 24/09, local, without the Gemini-read sites** (no key on the project lead's machine):
**43 %** of 210 published events found (79 certain, 12 probable). The tourist office alone finds
63. The `page` sources run in CI. The report lists every missed event by site of origin, the
probable matches to check by eye, and events read on the sites but **absent** from Fontainebleau
Live (61 from the tourist office alone: a coverage gain to sort, not a list to publish).

**Found on the way: published duplicates.** Matching the published set against itself finds
~20 groups, about 15 of them true duplicates under two titles (« La Flûte enchantée » ×2, « Les
Collectionnistes » ×2, « Y'a de la joie » ×2, « Blandy enchanté » ×2…). They inflate the
comparison's denominator and show twice on the site. Item 51c.

### Z2. The organisers' sites become a source (item 72, step 2, September 24, 2026)

The first CI comparison run (24/09) read the sites fine from GitHub — except fontainebleau.fr,
which answers **HTTP 418** to cloud addresses while answering normally elsewhere: not worked
around, the site decides who reads it. It found 68 events Fontainebleau Live did not have. The
project lead asked to publish them, to take the more precise information (links, positions), and
not to review anything by hand. Gemini grounding stays on, unchanged.

**A fourth source in `fetch-events.js`**, after OpenAgenda, same validation as every other source.
Each site record goes, in order:

1. **Confirm and enrich** an event already held — exact key, or `isSameOccurrence()`. This uses
   a new `enrichFrom()`, not `mergeInto()`: it **never touches the dates** (one dated performance
   on a site must not shorten a multi-day record it matched), takes the event's own page when ours
   is a home page (or a deeper page on the same site), takes a postal address when our position is
   approximate — the geocoding step then re-resolves it — fills blanks, and marks the record
   `source: "site"`.
2. Otherwise **add it**, unless it is a standing offer: a period longer than 14 days (the
   DATAtourisme "recurring" threshold, §3.H) confirms but is never announced — the château's little
   train, a museum's six-month opening.
3. Wording too different for `isSameOccurrence()` is caught by the judged dedupe (§3.W2), which
   keeps the stored record and, for a site record, merges through `enrichFrom()` too.

**`source: "site"`** is now a provenance value (validation, `fromExisting()`, the comparison).
It says "a legitimate source confirms this": the grounding exit criterion (§3.Z) is readable in
`data.json` itself.

**The tourist office's pages are completed by Gemini without grounding**: category, one-sentence
description (reformulated, not copied), hours, venue with postal address, organiser, age. Dates
are never asked — they come from the tested parser. Cached by page URL + text hash in
`sources-cache.json` (generated, committed) like the translations: an unchanged page costs nothing.

**Reader fixes from the first CI run**: pages are cut to their `<main>` / longest `<article>`
(Blandy's menus were three quarters of the text); a `follow` pattern reads the event pages a list
links to, where the dates are (Blandy, Samois, Moret); Henson is disabled — its "Évènement" tag
was a news archive for every Henson centre, its Fontainebleau outings are shop offers.

Daily workflow: timeout 20 → 30 minutes (polite reading, one request per second per host, ~5 min
when a real scan runs), `sources-cache.json` committed. Tested: unit tests for `enrichFrom()`,
period split, standing offers, the enrichment cache, `mainContent()`; and **an end-to-end run of
`main()` on the real data.json with a simulated internet** — Trail de Barbizon kept its id, gained
the event page and an address, dates untouched; a duplicate brocante enriched, not duplicated; two
new events added; a standing offer refused; a `robots.txt` Disallow never fetched.

### Y. Calendar feeds and the free partner widget (items 69 & 71, September 24, 2026)

Two ways for the programme to travel without anyone coming back to the site. Both are built from
what §3.X already produces, and neither adds a server, an account or a dependency.

**Calendar feeds.** `generate-pages.js` also writes iCalendar files that a calendar app
subscribes to and re-downloads on its own:

| File | Content |
|---|---|
| `/agenda/fontainebleau-live.ics` | Everything |
| `/agenda/categorie/<type>.ics` | One per category (« Sport & Outdoor »…) |
| `/agenda/commune/<commune>.ics` | One per town — same slug as `/que-faire/<commune>/` |
| `/agenda/feeds.json` | Index name → path, read by the site and the widget page: nothing outside the generator ever rebuilds a slug |

On the site, « Ajouter à mon agenda », **below** the map + list (or the calendar), opens a panel whose feed follows
the filters (town first, then category, else everything): Google Agenda (`calendar.google.com/…?cid=webcal://…`),
Apple / Outlook (`webcal://`), copy the link. Each commune page offers its own feed.

Rules, all silent failures if broken — a calendar app that cannot read a feed just shows nothing:
- RFC 5545: CRLF, lines folded at **75 octets** (not characters), `\ ; ,` escaped, all-day
  `DTEND` **exclusive**. `.gitattributes` marks `*.ics -text`: with `core.autocrlf` on the
  project lead's Windows checkout, git would otherwise store them with LF.
- `UID` = event id: an app updates an entry instead of duplicating it, and drops it when it
  leaves the feed. `DTSTAMP` comes from `lastSeen`, not the clock: an unchanged event is an
  unchanged file, so no daily commit.
- **Events longer than 7 days are left out** (39 of 214 on 24/09). A four-month exhibition as
  an all-day entry would sit at the top of the visitor's calendar every day until January.
  They keep their page and stay on the map.
- All-day entries only: `schedule` is free text (« 9h30–12h30 et 14h–17h »), and a time guessed
  from it would be a wrong time in someone's phone. Hours go in the description.
- `TRANSP:TRANSPARENT`: a listing, never shown as "busy".
- **A published feed is never deleted.** A town with nothing left gets an empty calendar:
  some apps show an error, or drop the subscription, when a feed starts returning 404.
- Google refreshes subscribed calendars on its own schedule, sometimes more than a day: the UI
  says so. Google cannot add a subscription from its mobile app — the hint says to use a computer.

Validated with an independent parser (Python `icalendar`, scratch only): all 30 files parse,
175 events in the main feed, every line ≤ 75 octets.

**Free widget.** `/widget/?ville=…&cat=…&n=…` is a small hand-written page meant for an
`<iframe>` on a partner's site (town hall, tourist office, lodging, club). It reads `/data.json`
itself, so it is always as fresh as the site. Same hostile-input rules as `index.html`
(`textContent` only, links are same-site paths of the generated shape). `noindex`, and **no
analytics**: it runs on other people's pages, whose visitors agreed to nothing from us. A town
unknown to the data is not echoed in the heading.

`/widget/integrer/` is the partner page: pick town, type and count, see a live preview, copy
the code. The code is the iframe **plus a plain link under it** to the commune page — a link
inside an iframe counts for nothing in search, the one in the partner's own page does. The free
tier asks to keep that mention; a paid tier (own colours, no mention, own events first) is not
built — see §9.

### V. The real brand arrives (item 61, September 23, 2026)

The project lead delivered the Fontainebleau Live artwork: an oak leaf — the forest — with a
live-signal trace through it, plus a scene of trees, château and people out walking.

**Colours were measured, not guessed.** Every file is an interlaced PNG, so reading the palette
needed a small Adam7 decoder rather than an eyedropper on a screenshot:

| | | |
|---|---|---|
| forêt | `#1d3b29` | 12.28:1 on white |
| lime | `#afe14f` | 8.02:1 on the forest green, **1.53:1 on white** |
| crème | `#f4f3ef` | the page background |
| grès | `#c9a059` | the château in the artwork |

**The invented accent goes.** The terracotta `#e2653c` was chosen on 21 September to differentiate
from a neighbouring site, at a time when no brand existed. One does now, and it carries its own
warm colour — the sandstone of the château. Keeping both would have been two accents arguing.

The split the token system already had makes this work: lime is 1.53:1 on white and can never
carry text on paper, so it stays `--accent` (dark grounds only) while `--accent-ink` becomes the
sandstone darkened to `#8f6a25`, which reads at 4.93:1. Two names, one impossible mistake fewer.

**Which file goes where, and why it matters.** The lockup with type is transparent with *dark*
lettering: correct on the cream footer, invisible on the dark banner. The banner therefore uses
the app icon, which carries its own dark ground and reads anywhere. The wide scene is 1200×630
but transparent with the drawing in the left third — a transparent link preview is composited by
each platform on whatever background it likes, so dark artwork vanishes on a dark card. It is
flattened onto the brand cream, scaled to 72% of the card height and centred, which turned the
previous generated placeholder into the real thing.

| Rôle | Fichier |
|---|---|
| Favicon | `Icon-FL-fav-v2.png` (32×32) — **essai en cours**, voir ci-dessous |
| Icône PWA | `Icon-FL-pwa-vS.png` (192), `Icon-FL-pwa-vH.png` (512) |
| Icône iOS | `Icon-FL-pwa-vH.png` |
| Marque du bandeau | `Icon-FL-pwa-vS.png` |
| Signature du pied de page | `Icon-FL-v1ST-512-512.png` |
| Aperçu de lien | `og-image.png`, composé depuis `BackgroundDeco-FL-v1.png` |

**Favicon v2 — essai posé le 23/09, à trancher en regardant un onglet.** La v2 est une feuille
vert foncé, la v1 une feuille lime. Les deux sont 32×32, la v2 n'est plus entrelacée (le point « à
faire plus tard » de l'item 61b, réglé au passage sur ce fichier). Leur contraste est exactement
inverse, et aucune des deux ne gagne partout :

| | Onglet clair (#f1f3f4) | Onglet sombre (#202124) |
|---|---|---|
| v1, lime (#9dcd4a) | 1,67:1 — invisible | 8,64:1 |
| v2, vert foncé (#2f502e) | 8,18:1 | 1,77:1 — invisible |

La v2 est le meilleur choix unique parce que le thème clair reste le défaut des navigateurs. Le
vrai correctif serait de déclarer les deux avec `media="(prefers-color-scheme: …)"` sur les `<link
rel="icon">` — deux lignes, les deux fichiers existent déjà. Non fait : les navigateurs qui
ignorent `media` retiennent la dernière icône déclarée, donc l'ordre décide qui est mal servi, et
il faut vérifier sur de vrais onglets avant de choisir cet ordre.

**Espacement du bandeau, corrigé le 23/09.** La marque était trop collée au texte. L'écart passe
à `clamp(1.1rem, 2.4vw, 2rem)` — 16 → 29 px sur un écran large, 11 → 18 px sur téléphone. Le
budget est venu d'un défaut trouvé en mesurant : `.header-inner` réservait toujours `6rem` à
droite pour le sélecteur de langue, alors qu'en dessous de 560 px celui-ci passe **au-dessus** du
contenu (le bandeau prend 3 rem de marge haute). Sur un écran de 320 px, ces 96 px inutiles
laissaient 133 px au bloc de texte, pour un mot — « Fontainebleau » — qui en mesure environ 217 et
ne peut pas se couper. Le retrait de cette réserve sur mobile rend 89 px : l'écart augmente et le
texte cesse d'être rogné.

**Left for later:** the source PNGs are interlaced, which costs size for no benefit on an icon
(73 kB for the 512). Re-exporting them non-interlaced, and the footer lockup at the size it is
actually displayed, would trim the page. Not urgent: roughly 95 kB of brand imagery loads on a
page view, the rest is fetched only by a scraper or when installing the app.

### W. Where title matching runs out (item 51 follow-up, September 23, 2026)

Three more duplicate groups reported live. They failed for three different reasons, and only two
of them are fixable by rule.

| Groupe | Ce qui bloquait | Réponse |
|---|---|---|
| « Exposition Le panache des Lumières » ×2 | 19 sept. → 25 janv. contre 20 sept. → 25 janv. : la règle exigeait un jour de début identique | Règle assouplie |
| « Soirées » / « Soirée aux Chandelles » | pluriel : deux chaînes différentes, donc deux ensembles de mots différents | Règle assouplie |
| Chandelles ×3, #ForêtBelle ×3 | chaque titre porte un mot que l'autre n'a pas | **Aucune règle** — `overrides.json` |

**Assouplissement 1 — le pluriel.** Le `-s` ou `-x` final est retiré des mots d'au moins cinq
lettres. Le seuil n'est pas cosmétique : sans lui, « bus » deviendrait « bu » et « mas »
deviendrait « ma ».

**Assouplissement 2 — les périodes qui se chevauchent.** Deux fiches pluri-journalières dont les
périodes se recouvrent décrivent la même chose ; deux fiches d'un seul jour, non. Un concert le
14 et un concert le 15 sont deux concerts, et les fusionner en supprimerait un. Une période et un
jour isolé ne fusionnent pas non plus : une date unique à l'intérieur d'une saison est un
événement, pas une redite de la saison.

**Mesuré avant d'être écrit :** sur les 222 fiches publiées, les deux assouplissements réunis ne
produisent que **2 fusions supplémentaires**, toutes deux vérifiées à la main. Le rendement est
faible parce que la règle de §3.P avait déjà fait le gros du travail — c'est le résultat attendu,
pas une déception.

**Ce que la règle ne fera pas.** « Soirée aux Chandelles - Clôture de saison » et « Soirée aux
Chandelles : Clôture festive » ont exactement la forme de « Meeting d'Automne TDA Poneys » et
« … Équitation » : chacun porte un mot propre. Le premier couple est une même soirée décrite deux
fois, le second deux épreuves distinctes. **Rien dans les titres ne les sépare.** Un seuil de
similarité les fusionnerait tous les deux, et la garde des parapluies de §3.P — qui existe
précisément pour protéger le cas TDA — serait perdue. La règle s'arrête donc ici, volontairement :
la consigne du chef de projet était de réduire les doublons *sans évincer trop d'événements*.

**Ce qui prend le relais.** Le rapport de run listait déjà ces paires ; il donne désormais leur
identifiant, de sorte que trancher revient à coller une ligne dans `overrides.json` (§3.K) au lieu
de fouiller `data.json`. Les deux groupes signalés ont été traités ainsi — quatre fiches masquées,
chacune avec sa raison écrite —, après vérification sur les sites des organisateurs :

- **#ForêtBelle** : le SMICTOM annonce bien un week-end du 26 **et** 27 septembre, le ramassage
  sur la D607 ayant lieu le dimanche 27 de 9 h à 12 h. La fiche conservée portait déjà ces dates
  et ces horaires : **aucune date n'a été corrigée**, les deux autres fiches pointaient seulement
  vers des associations participantes plutôt que vers l'organisateur.
- **Soirées aux Chandelles** : vaux-le-vicomte.com confirme que le 26 septembre est la dernière
  de la saison, sur un thème guinguette. Cette précision n'existait que dans les deux fiches
  masquées, donc elle a été reportée dans la description de la fiche conservée plutôt que perdue.

**Un effet de bord corrigé au passage.** La fusion du « panache des Lumières » gardait la page
d'accueil du château et jetait la page de l'exposition, parce que c'était la page d'accueil qui se
trouvait déjà vérifiée. `mergeInto()` adopte maintenant un chemin plus profond sur le **même
hôte** : même domaine, donc aucune décision de confiance nouvelle, et un chemin plus long est
strictement plus précis. Le lien repart en vérification au run suivant.

**Couverture, trouvée par un test.** Le test qui compare les communes publiées à celles du prompt
signalait La Rochette (12,6 km) et Saint-Fargeau-Ponthierry (18,4 km) : à l'intérieur du rayon,
remontées par les flux, mais jamais demandées au modèle. La couverture de ces deux communes
dépendait donc de la source qui trouvait l'événement. Elles sont ajoutées à `COMMUNES` (21 → 23).

### U. Four categories, one classifier (items 21 & 26b, September 23, 2026)

Item 21 asked two things: check that the three sources stay coherent, and decide whether
heritage visits deserve their own category.

**The coherence turned out to be a non-problem.** Scanning the 197 published events for titles
that clearly contradict their category found four borderline cases, all defensible: a night walk
in the forest filed under Nature rather than Sport, an exhibition about the forest filed under
Culture rather than Nature. Nothing to repair.

**The real defect was size.** "Culture & Ateliers" held 120 of 197 events — 61%. That is the
same failure the age filter had: an option that returns three events out of five is not a filter.
And inside it sat two things a visitor never chooses between — a concert or a play on one side,
an exhibition or a brocante on the other.

**A fourth category, not a rename.** `Scène & Spectacles` is added; the three existing values are
untouched. Renaming would have invalidated every stored record until the next scan re-reported
it. Result: 37% / 28% / 24% / 11% instead of 61% / 28% / 11%.

**One classifier, applied to every source.** `refineCategory()` runs over the whole merged set
after validation. Each source still proposes a category — DATAtourisme maps almost everything to
Culture because its ontology has no stage class, OpenAgenda guesses from keywords, Gemini is told
the enum — but one place decides. That is what "normaliser" means here: three mappers that each
guess independently will drift apart.

It only ever **promotes Culture to Scène**, never touches Sport or Nature: a source that says
"Sport" knows something a regular expression does not.

Two rules, both earned from the data:

- The vocabulary names a **performance**, not an atmosphere. "Soirée" is deliberately absent —
  "Soirée aux Chandelles" is a candlelit visit to Vaux-le-Vicomte, not a show.
- A title that **announces itself** as an exhibition, a visit or a workshop is never promoted,
  whatever its description mentions. Without that guard, "Exposition d'art contemporain Wawapod"
  moved to the stage category because its description named a festival.

The live `data.json` was migrated offline with the same function: 48 events reclassified, and a
test asserts the result is stable — a second pass moves nothing.

**Item 26b, in the same pass.** The view switcher was two plain buttons: a screen reader
announced "Carte & Liste, button" with no way to tell which view was showing, and the panels were
not tied to the buttons. It is now a proper `tablist` whose `aria-selected` follows the view —
the `.active` class only paints, it does not announce. The filter row is a named group, the
result list is an `aria-live="polite"` region so a change is spoken, and `:focus-visible` gives
every control a visible keyboard ring instead of only the two that had one.

### T. The sport gap: no missing feed, a drifted prompt (item 38, September 22, 2026)

Sport was 21 of 197 events (11%) against 120 for culture. The roadmap said to close it "through
the source registry, not by tuning the grounded prompt". Four sources were checked first, and
the note matters more than the conclusion — it is what stops the search being repeated:

| Candidate | Result |
|---|---|
| data.gouv.fr sport datasets | Nothing for Île-de-France or Seine-et-Marne |
| Grand Parquet (WordPress events API) | Works — 5 events, **all 5 already published** |
| Pays de Fontainebleau (same API) | Works — 16 events, all France Rénov advice sessions |
| ProTiming, athletics club sites | No feed, no API; Gemini already cites them |

So there is no feed to add. The gap is that **the prompt was asking for the wrong region**:

> `- Communes voisines (< 15 km) : Avon, Barbizon, Samois-sur-Seine, Thomery, Bois-le-Roi,
> Bourron-Marlotte, Moret-Loing-et-Orvanne, Nemours, Vaux-le-Vicomte, Blandy-les-Tours.`

The pipeline accepts 20 km and already publishes events in **eleven communes the prompt never
mentioned** — Melun, Larchant, Milly-la-Forêt, Maincy, Le Châtelet-en-Brie, Ury, Cesson… The
model was being told to search a smaller area than the one we keep, and paid scans were coming
back with less than they could. The scope is now built from `CONFIG.maxRadiusKm` and a `COMMUNES`
list, so it cannot drift from the radius again without a test failing.

The sport focus was also generic ("tournois et événements sportifs de clubs"). It now names the
disciplines this region actually produces — trails, cross, marche nordique, course d'orientation,
VTT, show jumping at the Grand Parquet, duathlon, Christmas races — and the local organisers.
The federation calendars (FFA 77, FFRandonnée, FFCT) joined the priority sources.

This is prompt work, which §9/38 warned against. The warning was about relying on prompt tuning
*instead of* adding sources; two sources have since been added (§3.I, §3.S). What is fixed here
is not a tuning preference but a factual error: the prompt described a perimeter the pipeline
stopped using.

### S. OpenAgenda, a third source (item 27, September 22, 2026)

The coverage gap the project lead identified is **local associations**: the manga festival at
Bois-le-Roi, the jazz nights at Lorrez-le-Bocage, the guided walk and drawing workshop at
Larchant. Gemini rarely surfaces them and DATAtourisme does not carry them — the associations
publish them on OpenAgenda, which Région Île-de-France republishes as open data.

**No key, no bulk download.** The portal exposes an Opendatasoft query API, so the bounding box
and the date window are applied server-side: one small request per run, against the 9 MB
DATAtourisme downloads every time.

**The filter that decides whether this source is usable at all.** The raw feed is 158 records in
this area and **111 of them are France Travail job-search workshops** — "Découvrez les métiers de
la logistique", "Capsule 15': faire matcher CV / offre". Public events, but not outings, and
shipping them would bury the actual content under employment services. They are excluded by
**origin agenda**, not by keyword: an agenda is a stable, declared publisher, where a title is
whatever someone typed that week.

**Measured 22 September: 158 raw → 47 kept → 51 records, and every one of them absent from
`data.json`.** They bring in eight communes the site had nothing from: Melun, Bois-le-Roi,
Nandy, Lieusaint, Sivry-Courtry, Le Châtelet-en-Brie, Villiers-en-Bière, Savigny-le-Temple.

**Occurrences.** `timings` lists every date, and the feed keeps historical ones — one record
carries dates from 2023 alongside this autumn's. Anything outside the window is dropped *before*
counting, so a dead series cannot be mistaken for a long run. A short series then becomes one
record per date (the §3.I rule); a long programme becomes a single span, because a card per day
for a two-month exhibition would bury everything else.

**Images.** 50 of the 51 records carry one, and the field is now kept in `data.json` through
`cleanUrl()` like any other third-party link. It is **not displayed yet**: 51 cards with a
picture among 220 without would look broken rather than richer. The field exists so the decision
can be made on real data instead of on a guess (item 67).

### R. The venue gazetteer and marker grouping (items 62 & 18, September 22, 2026)

Two problems that looked unrelated and were the same one: **the map was mostly fiction.**

**62 — why the positions were wrong.** The pipeline asks the BAN, which is an *address* base,
for "Théâtre municipal de Fontainebleau". That is a name, not an address, so nothing is found
and the record falls back to the commune centre or to whatever coordinates the model invented.
Measured: 136 of 171 events (80%) approximate.

But the same places come back scan after scan. **11 venues held 106 of the 171 events.**
`venues.json` resolves them once, by hand, and is consulted before the BAN. Matching is on
normalised words plus an exact city, which absorbs the spellings a model invents: "Théâtre
municipal de Fontainebleau", "Théâtre Municipal de Fontainebleau" and "Theatre municipal &
Ateliers" all land on one entry. Four entries currently match **70 events across 12 spellings**.

**Result: exact positions go from 20% to 60%.** Anything not already exact is re-resolved on
every run, so a venue added today fixes every stored event at that address tomorrow.

**Two venues are deliberately absent.** The forêt de Fontainebleau (17 events) is 25,000 ha —
any single point would be wrong, and publishing it as *verified* would be worse than admitting
it is approximate. The Espace Naturel Sensible du Carreau Franc (4 events) was found by neither
the BAN nor OpenStreetMap, and inventing a coordinate is not an option. A test asserts that
both still return no match, so nobody "helpfully" fills them in later.

**18 — and why fixing 62 alone would have made things worse.** Sharpening positions pushes more
events onto the *same* point. Measured before any change: 171 geolocated events sat on 71
distinct points, so **100 markers were hidden under another and 58% of events could not be
clicked at all.**

No clustering plugin was needed, because the problem is identical coordinates, not proximity.
Markers are grouped by coordinate (4 decimals, ~11 m); a point holding several events wears the
count, and its popup lists them, each row selecting its own card. A point of one category keeps
its colour, a mixed point goes neutral rather than picking a winner and misrepresenting the rest.

Selection became a *set*: one marker stands for up to 26 events, so clicking it highlights all
of them and brings the first into view. Popup rows are matched by one delegated listener on the
map container — popups are created and destroyed constantly, and rebinding on each render would
leak handlers.

### Q. Design tokens and the second theme pass (item 64, September 21, 2026)

The project lead pointed at fontyblog.fr, a neighbouring Fontainebleau site, and specifically at
its “Rejoignez la communauté sur Instagram” panel. Reading its stylesheet is more useful than
looking at it: the panel is not doing anything clever with colour, it is doing something ordinary
with a *system*.

Their tokens:

```
--fyblog-primary  #226D68   --fyblog-accent  #F9A826   --fyblog-ink   #1E1E1E
--fyblog-bg       #F5F7F6   --fyblog-line    #E5E9E7   --fyblog-r-lg  16px
```

What makes the panel read as modern: a **dark ground with white type**, **one vivid accent**
carrying the small uppercase kicker and the pill button, **pill radii** (`999px`), translucent
white surfaces (`rgb(255 255 255 / .08)`), and soft, layered shadows. None of that is expensive.

**Our system copies the shape, not the colours.** Being in the same family but duller was the
worst place to be, and the previous forest `#2d4a3e` was close enough to their teal to look like
a washed-out version of it:

```
--ink #16211c (near-black, forest cast)   --accent     #e2653c (terracotta, dark grounds only)
--brand #1f4d3d                           --accent-ink #b8451f (readable on paper, 5.37:1)
--bg  #faf7f2                             --line       #e6e2da
--r-sm/md/lg/pill, --shadow-sm/md/lg
```

The accent is deliberately split in two. `#e2653c` is 3.41:1 on white — below AA — so it exists
only for dark grounds, and `--accent-ink` is its readable twin. Two names make the rule impossible
to break by accident.

The old `--primary-color` / `--bg-color` names survive as aliases onto the new tokens, so the rest
of the stylesheet needed no rewrite and a third theme pass will be just as cheap. A test asserts
that no colour from an earlier pass is still hard-coded anywhere outside `:root` — which is how
the stale `theme-color` meta tag (still painting phone chrome in the previous green) was caught.

### O. English descriptions (item 52, September 21, 2026)

`scripts/translate.js` fills a `descriptionEn` field on every published event.

**Why the description and nothing else.** §3.L kept event data French so a visitor can match
what the site says against a poster or a ticket desk. That argument is about *identifiers* —
titles, venues, times, prices. It does not apply to the description, which nobody searches by
and which only answers "is this for me?" — a question that is useless in a language you cannot
read. So the description is translated and everything else stays put. The English footer says
exactly that.

**Cost control is the design.** The cache is keyed by a hash of the French text, like
`geocode-cache.json`. An unchanged description is never re-translated, so only genuinely new
events cost anything — a few dozen per scan against 198 in the catalogue. A description
corrected through `overrides.json` changes its hash and is re-translated automatically, so the
two can never drift apart. The cache is pruned to what is published, and **committed by the
workflow**: without that it would start empty on every CI run and re-translate everything.

**No grounding.** The call carries no `google_search` tool. It is cheaper, it makes structured
JSON output available (which collides with the search tool, §3.A — so no regex salvaging
here), and it puts this call outside the terms problem of §3.G entirely. It is the only Gemini
call in the project that is unambiguously fine.

**Never fatal.** A failed batch, a malformed answer, a missing key or `TRANSLATE=0` all leave
`descriptionEn` unset and the card falls back to French — what the site did before. It runs
last, on the set actually being published, so nothing is paid for on a record about to be
dropped as a duplicate, a dead link or a past event.

### P. Nested-title duplicates (item 51, September 21, 2026)

Three cards for one race, reported live: *"Course à pied La Thomeryonne"*, *"La Thomeryonne"*,
*"La Thomeryonne 2026"* — same day, same commune. Same story for the Trail du Mont Sarrazin
(*""*, *"(14e édition)"*, *"2026"*). The §3.J rule missed all of it, for two reasons:

1. It required **identical** word sets. `{thomeryonne}` and `{course, pied, thomeryonne}` are
   not identical, so nothing happened.
2. `2026` and `14e édition` counted as content words, so even the otherwise-identical titles
   fell into different buckets.

**Fix 1 — instance noise.** A year (`2026`), an ordinal (`1er`, `5e`, `14e`) and the word
`édition` name an *instance* of a recurring event, not the event. They are stripped like
connectors. That alone collapses the whole Sarrazin trio and two of the three Thomeryonne
cards, because their word sets then match exactly.

**Fix 2 — nesting.** A title whose words are a strict subset of another's, on the same date
**and in the same city**, is the same event named short and long. The danger is obvious and is
the one §3.J refused to go near: *"Meeting d'Automne TDA"* is also a subset of *"… Poneys"*
and *"… Équitation"*, which are two real, distinct competitions.

The discriminator is **how many** longer titles a short title sits inside, counting only the
minimal ones (a chain A ⊂ B ⊂ C is one nesting, not two):

| Supersets | Meaning | Action |
|---|---|---|
| exactly one | one event, named short and long | **merge** |
| two or more | an umbrella over distinct sub-events | **never merge**, report |

So *"La Thomeryonne"* (one superset) merges, and *"Meeting d'Automne TDA"* (four supersets)
does not — it is listed in the run report for a human, who can now hide the extras through
`overrides.json` (§3.K). The trap §3.J avoided by refusing to look at nesting at all is now
caught by structure instead.

**Which title survives.** The winning *record* is still chosen by the old tie-break (stored
over new, verified URL, legacy id) so the id — and therefore any override keyed to it —
survives. The *title* is judged separately: the one with more content words wins ("Course à
pied La Thomeryonne" over "La Thomeryonne", which matters most to a visitor reading the
English interface); between two titles saying the same thing, the shorter wins, which drops
the "(14e édition)" clutter. Rewriting titles means rewriting `eventKey()`, so the record map
is re-keyed at the end, exactly as in §3.K.

**Measured on the live data: 198 → 171 events, 27 merges.** Every merge was reviewed one by
one in simulation before the rule was written into the pipeline, and four umbrellas were
confirmed to survive. A second pass over the result removes nothing further (idempotent).

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
      "descriptionEn": "String ★ — machine translation of description; absent when translation failed or is off",
      "url": "String (http/https URL)",
      "urlStatus": "ok | unverified",
      "urlCheckedAt": "YYYY-MM-DD",
      "source": "datatourisme (absent for Gemini events)",
      "pageUrl": "/evenements/<slug>-<token>/ — derived from id + title on every write (§3.X)"
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
| 2026-09-21 | **Form responses are ingested automatically, but only "hide" is auto-applied** (§3.N) | Hiding is reversible and idempotent, and §5 says a missing event costs less than a wrong one. Writing a visitor-supplied date or title into `data.json` is the opposite of that rule |
| 2026-09-21 | A reported dead link clears the URL verification stamp instead of hiding the event | Lets the pipeline decide on its own evidence; a visitor mistaking a slow site for a dead one cannot delete an event |
| 2026-09-21 | A burst above 5 hide requests in one run applies **nothing** | Mass-hiding is the attack; applying the first five would still empty the site one run at a time |
| 2026-09-21 | No cursor file: the whole sheet is re-read every run | Hiding is idempotent. The review queue self-clears via `overrides.json` instead of needing state |
| 2026-09-21 | The sheet URL lives in a GitHub secret, not in the repository | Responses can carry the optional contact field and the repo is public |
| 2026-09-21 | Period filter defaults to **"dans les 2 semaines"**, not 3 months | 194 → 53 events on the live data: the default should answer "what is on soon", not dump the whole window |
| 2026-09-21 | Language switch uses inline SVG flags, not flag emoji | Windows has no flag glyphs: `🇫🇷 FR` renders as "FR FR" there, which is what made the first version look cluttered |
| 2026-09-21 | **Nested titles merge when a short title sits inside exactly ONE longer one** (§3.P) | Three cards for one race, reported live. Counting supersets is what separates "same event, named short and long" from an umbrella over real sub-events — the trap §3.J avoided by not looking at nesting at all |
| 2026-09-21 | Years and edition numbers are stripped as *instance noise*, like connectors | "Trail du Mont Sarrazin", "… 2026" and "… (14e édition)" are one race; treating those as content words is what split them |
| 2026-09-21 | Nested merges require the same city; identical word sets do not | Nesting is the looser rule, so it gets the stricter guard. Identical sets must keep crossing communes (Vaux-le-Vicomte / Maincy) |
| 2026-09-21 | A merge keeps the winner's **id** but may adopt the loser's **title** | The id anchors `overrides.json`; the title should be the most informative one, which matters most to a visitor reading the English interface |
| 2026-09-21 | **The description is translated into English; nothing else is** (§3.O) | §3.L's argument is about identifiers a visitor must match against the real world. A description is not an identifier — it only answers "is this for me?" |
| 2026-09-21 | Translation cache keyed by a hash of the French text, and committed by the workflow | Only new events cost tokens; a corrected description re-translates itself; an uncommitted cache would re-translate everything on every CI run |
| 2026-09-21 | The translation call is **not grounded** | Cheaper, gives structured JSON output, and sits outside the §3.G terms problem — the only Gemini call in the project that clearly does |
| 2026-09-21 | A rule change is applied to the live `data.json` **offline**, not by forcing a paid scan | `data.json` is generated: shipping the code changes nothing until a scan runs, and the cadence guard can hold that back for days. The offline pass runs the very same function, free |
| 2026-09-21 | An offline cleanup leaves `generatedAt` alone | No new data was collected, so the freshness banner must not claim otherwise — and bumping it would push the next scheduled scan 60 h further out |
| 2026-09-21 | **Analytics = GoatCounter, not Google Analytics** (item 17) | GA4 needs a consent banner in France, which suppresses much of the measurement it exists to collect, for ~50 kB of third-party JS. Cookieless, ~3 kB, no banner |
| 2026-09-21 | What is measured: outbound click per event, FR/EN, filters, map vs calendar — not page views | Page views answer nothing here. “Does the site actually send anyone anywhere” is the product question |
| 2026-09-21 | The chosen date is never sent, only whether a date filter was used | A date is the one filter value that could narrow down an individual |
| 2026-09-21 | **Palette « Forêt & Grès »** replaces the framework default; the old values are kept in a comment | The subject is the forest and the sandstone, not a generic dashboard. Every pair was checked against WCAG AA before shipping (the first ochre failed at 3.57:1 and was replaced) |
| 2026-09-21 | Categories are colour-coded on the card border, the badge **and the map marker** | Colour carries the category without a word being read; the marker becomes a `divIcon`, which also removes Leaflet’s pin image download |
| 2026-09-21 | **No third-party tile provider and no font CDN** (58c, 58d declined) | Keeps the CDN surface at what `CLAUDE.md` already allows |
| 2026-09-21 | **PWA, never a native app** (items 59, 60) | Installable, offline, no store, no yearly fee — and the prerequisite for iOS web push, the only thing native would do better |
| 2026-09-21 | The service worker is **network-first**, not cache-first | A cache-first shell would pin an old `index.html` or `data.json` on a visitor’s phone. This project already lost a session to exactly that class of confusion |
| 2026-09-21 | **Name and domain: Fontainebleau Live** (`fontainebleaulive.fr`) | Reads the same in French and English, says what it is, and claims no official status |
| 2026-09-21 | **Approximate positions are no longer marked on the map** | Measured: 136 of 171 events (80%) only have a city-centre or model coordinate. Fading four markers in five did not inform anyone, it washed the map out. The caveat stays on the card and in the popup, where there is room to explain it |
| 2026-09-21 | Category colours redone brighter, hues ~100° apart (186° / 90° / 291°) | The first triad was muted and two of its tones sat close together; separation matters most at 18 px on a map, and for colour blindness |
| 2026-09-21 | A selection can be cleared three ways: a **button on the map**, Escape, or clicking the map | Selecting an event left the map zoomed with no visible exit — the project lead resorted to resetting a filter, which is not what a filter is for. A shortcut alone is not an affordance |
| 2026-09-21 | Header rebuilt: gradient, left-aligned two-tone wordmark, treeline edge; the old one kept in a comment | The solid centred block was the “too classic” one. Every colour still comes from `:root`, so the theme remains revertible in one paste |
| 2026-09-21 | `og-image.png` is generated by a hand-written PNG encoder (Node’s `zlib`, no dependency) | A placeholder had to exist for link previews to work at all; drawing type without a font library would have looked worse than no type, and the preview card supplies the title as real text anyway |
| 2026-09-21 | **A token system replaces ad-hoc colours**: ink scale, brand family, one accent, line, radii, shadows | Read off the nearby fontyblog.fr, whose panels the project lead pointed at. What makes those look modern is the *system* — named tokens, pill shapes, soft shadows, one vivid accent on a dark ground — more than the hues themselves |
| 2026-09-21 | **Deliberately not fontyblog's colours.** They are mid-teal `#226D68` + saffron `#F9A826`; we are near-black forest ink `#16211c` + terracotta `#e2653c` | Sitting in the same family but duller was the worst available position. The old forest green `#2d4a3e` was close enough to theirs to read as a washed-out copy |
| 2026-09-21 | The vivid accent is for dark grounds only; `--accent-ink` is its readable twin on paper | `#e2653c` is 3.41:1 on white, below AA. Splitting the token makes the rule impossible to break by accident |
| 2026-09-21 | The treeline silhouette is replaced by a single shallow curve | It read as spikes, not as a forest. A plain shape cannot fail to look like the thing it is not trying to be |
| 2026-09-21 | `15 km` dropped from the tagline | Vaux-le-Vicomte is further out, so the figure was simply wrong |
| 2026-09-21 | A failed `data.json` load shows a message and a retry, and the coverage figure goes **blank** rather than reading zero | A blank page is the worst failure because nobody can tell it happened; "0 événements répertoriés" would read as a claim about the region rather than about the network |
| 2026-09-21 | SRI digests are verified by re-downloading each file in a test | A wrong digest does not degrade the page, it blocks the asset entirely — the map or the calendar simply disappears |
| 2026-09-23 | **The response sheet keeps its contact column** (item 48c closed) | Project lead's call, risk accepted knowingly: the URL lives in a GitHub secret, is not in the public repo and is not guessable, the column was verified empty, and an e-mail address alone is not much of an exposure today. Reopen if the form starts collecting more than an e-mail, or if the URL circulates |
| 2026-09-23 | **The brand palette replaces the invented one** (§3.V) | The terracotta was picked when no brand existed. The logo carries its own warm colour — the château sandstone — and two accents would have argued with each other. Values measured from the PNG files, not eyeballed |
| 2026-09-23 | Lime stays `--accent` (dark grounds), sandstone becomes `--accent-ink` (paper) | Lime is 1.53:1 on white: it can never carry text there. The token split makes the rule impossible to break by accident |
| 2026-09-23 | The banner uses the **app icon**, the footer the **lockup with type** | The lockup is transparent with dark lettering — right on the cream footer, invisible on the dark banner |
| 2026-09-23 | The link preview is **flattened onto cream**, never left transparent | Each platform composites a transparent PNG on a background of its choosing; dark artwork disappears on a dark card |
| 2026-09-23 | **A fourth category, `Scène & Spectacles`** (§3.U) | "Culture & Ateliers" held 61% of events — the same failure the age filter had. Splitting brings the biggest block to 37%, and a concert and an exhibition are not things a visitor chooses between |
| 2026-09-23 | Added, **not renamed** | Renaming a value would have invalidated every stored record until a source re-reported it |
| 2026-09-23 | **One classifier decides for all three sources** | DATAtourisme has no stage class in its ontology, OpenAgenda guesses from keywords, Gemini is told the enum. Three mappers guessing independently drift apart; `refineCategory()` runs last over the whole set |
| 2026-09-23 | It only promotes Culture → Scène, never touches Sport or Nature | A source that says "Sport" knows something a regular expression does not. The audit found only four borderline cases in 197, all defensible |
| 2026-09-23 | A title that announces itself as an exhibition or a visit is never promoted | Without the guard, "Exposition d'art contemporain Wawapod" moved to the stage category because its description named a festival |
| 2026-09-23 | **`aria-selected` drives the tab state, not the CSS class** (item 26b) | `.active` paints; it says nothing to a screen reader. The result list also became an `aria-live` region, so a filter change is spoken |
| 2026-09-23 | **The « Public cible » filter is removed** | Measured on the published data: « Ados » kept 89% of events, « Adultes » 90%, « Enfants » 73%, and 147 of 197 records are 0–99. A control that returns almost everything whatever you pick is not a filter. The age label stays on the card, where it is information rather than a promise |
| 2026-09-23 | An age the feed does not give falls back to the default, not to zero | `Number(null)` is 0 and passes `isFinite`, so the guard in `openagenda.js` never fired: 18 published cards read « Jusqu’à 0 ans ». Fixed in the mapper and repaired offline in `data.json` |
| 2026-09-23 | **`lastSeen` reports, never deletes** (item 28) | The rule of 19 September stands: prune by date only, never by absence. What is new is that the report separates two cases — a deterministic feed that loaded fine and dropped an event is a real signal; the model not mentioning something is not |
| 2026-09-23 | Records stored before `lastSeen` existed are dated on first sight | Otherwise all 197 would be flagged stale on the first run after deployment |
| 2026-09-23 | **No usable sport-event source exists for this area** (item 38b, closed) | Five candidates checked and written down: the RNA and the Recherche d'entreprises API are directories of *associations*, with no event dates (verified by query); HelloAsso's API needs an account; its public pages and the federation calendars would need scraping, which the project lead excluded |
| 2026-09-23 | Naming real local clubs in the prompt was **also rejected** | The directory returns 336 active sports structures in the 21 communes, mostly school associations that organise nothing public. Quoting an arbitrary handful would bias the search more than help it |
| 2026-09-23 | **The DATAtourisme coverage probe is deleted** | It was the observation-mode probe from before the source joined the pipeline (§3.I). Verified in production since 21 September; it was downloading 9 MB a week for a report nobody reads. The shared library stays — `feedback.js` reuses its CSV parser |
| 2026-09-22 | **The sport gap is a prompt defect, not a missing source** (§3.T) | Four candidate feeds were checked; the two that work return only events already published, or administrative sessions. Meanwhile the prompt asked for "< 15 km" and ten communes while the pipeline kept 20 km and twenty-one |
| 2026-09-22 | The prompt's geographic scope is now **built from `CONFIG.maxRadiusKm`** | It had silently drifted from the acceptance rule. A test fails if the two disagree again |
| 2026-09-22 | **A 20 km radius replaces the bounding box as the acceptance rule** | The box is a rectangle: it reached 30 km into Sénart and Corbeil to the north-west while cutting closer elsewhere. 20 km keeps Blandy-les-Tours (19.3 km) and Vaux-le-Vicomte (18.4 km), and drops the 25 events the project lead flagged as too far. `MAX_RADIUS_KM` makes it one value to change |
| 2026-09-22 | The radius is applied **after** geocoding | An event is judged on where it turns out to be, not on the coordinates a source claimed before we resolved them |
| 2026-09-22 | Coordinates declared by a structured feed get their own `geoSource: "feed"` and count as exact | 45 DATAtourisme and OpenAgenda events were filed as `model` — the label for a coordinate the LLM invented. A declared place record is not a guess |
| 2026-09-22 | **Recurring events: dropped, not implemented** | The frontend carried a `dateType: 'recurring'` branch since v1 and nothing ever produced it (197 records, 197 `event`). Dead code removed rather than a feature built for it |
| 2026-09-22 | **Event images: not displayed** | Only 21 of 197 records carry one (11%), all from OpenAgenda. A picture on one card in nine reads as broken. The field stays stored so the question can be re-decided on real data |
| 2026-09-22 | An override that matches nothing is no longer reported as « à supprimer » | Once a `hidden` override has taken effect the event is gone from the published set, so it matches nothing — and deleting the entry would let the event return on the next scan. The report was advising the exact move that undoes the fix |
| 2026-09-22 | §9 rewritten to list **only what is open** | It had reached 86 entries, 66 ticked, each with its own history. The history belongs in §7 and §3; a roadmap that has to be searched is not a roadmap |
| 2026-09-22 | **OpenAgenda added as a third source**, via the Île-de-France open data portal (§3.S) | The missing events are local associations, which publish there. No API key, server-side filtering, 51 records all absent from `data.json`, eight new communes |
| 2026-09-22 | Employment agendas are excluded **by publisher, not by keyword** | 111 of the 158 records in this area are France Travail workshops. An agenda is declared and stable; a title is free text that changes weekly |
| 2026-09-22 | OpenAgenda records are merged **last**, with the fuzzy guard | An event already reported by Gemini or DATAtourisme keeps its verified URL; only the newcomer pays the comparison |
| 2026-09-22 | An `image` field is now stored but **not displayed** | 51 cards with a picture among 220 without would read as broken. Storing it costs nothing and lets the display decision be made on real data (item 67) |
| 2026-09-22 | **`venues.json`, a hand-written gazetteer consulted before the BAN** (§3.R) | The BAN is an address base; the pipeline was feeding it venue *names*. 11 venues held 106 of 171 events, so resolving them once fixes the map for good. Exact positions: 20% → 60% |
| 2026-09-22 | The forêt de Fontainebleau and the Carreau Franc are **deliberately left out** of the gazetteer | A single point for a 25,000 ha massif would be wrong, and publishing it as verified is worse than approximate. The Carreau Franc was in neither source, and inventing a coordinate is out of the question. A test keeps both absent |
| 2026-09-22 | A gazetteer entry outside the project bounding box is **dropped at load** | A typo here would be published as an exact position — the one thing this file must never do |
| 2026-09-22 | **Markers grouped by identical coordinate, with the count on the dot** (§3.R) | 100 of 171 markers were hidden under another: 58% of events were unreachable. Sharpening the positions (item 62) would have made that worse. Grouping by coordinate solves all of it — no clustering plugin, no new CDN |
| 2026-09-22 | A mixed-category stack is drawn neutral | Picking the dominant category would state something false about the rest |
| 2026-09-22 | **A one-click “Traduire les descriptions” workflow** | Translating needs a real Gemini call, so shipping code changes nothing. Three sessions were lost to that confusion. A button in the Actions tab removes the need for a terminal and an API key on the desk |
| 2026-09-22 | The freshness banner shows the **date only**, no time | The collection runs every ~3 days: the hour carried no information a visitor could use |
| 2026-09-22 | `robots.txt`, `sitemap.xml` and `hreflang` added | Nothing appears in Google because the domain is a day old and was never submitted, not because of the page. These are the three files a crawler looks for |
| 2026-09-22 | Item 53 settled by hand: 11 cards hidden across 4 umbrella groups | Each group verified individually (same date, same venue, same site). The two TDA sub-events are marked "à vérifier" in the file: they may be real divisions, but a visitor at the Grand Parquet that weekend finds both from one card |
| 2026-09-21 | A failed run opens **one** GitHub issue and comments on it thereafter | The pipeline is unattended; a default e-mail is easy to miss and impossible to track. Ten identical issues would be as useless as none |
| 2026-09-21 | **The footer states how many events are listed for the next three months** | Taken from fontyblog, which shows its own total — and that is exactly how the project lead spotted what was missing from it. The number is a coverage claim, so it deliberately ignores the active filters: a result count would say nothing about coverage |
| 2026-09-21 | **English version = interface only. Event data stays French** (§3.L) | A translated title cannot be matched back to the real event on a poster, a ticket desk or the organiser's own site. Also keeps the recurring translation cost at zero |
| 2026-09-21 | Category **values** stay French; only the displayed label is translated | The values are the data enum and the `<option value>` the filter matches on — translating them breaks every filter silently |
| 2026-09-21 | Language resolution: `?lang=` → stored choice → browser language → French | Makes a link shareable in a chosen language, and an INSEAD visitor lands in English without hunting for a switch |
| 2026-09-21 | Period filter defaults to "3 mois", and a specific date overrides it instead of intersecting | The default reproduces the previous behaviour exactly; intersecting would let an empty result look like a bug |
| 2026-09-21 | Helioso logo + link in the footer, AVIF with a PNG fallback | The PNG is 483 KB and is only fetched by a browser without AVIF support |
| 2026-09-23 | Le pluriel est neutralisé au-delà de cinq lettres ; en deçà, jamais | « Soirées » = « Soirée », mais « bus » ne doit pas devenir « bu » |
| 2026-09-23 | Deux périodes qui se chevauchent fusionnent ; deux jours isolés, jamais | Une exposition redécrite à un jour près est la même ; un concert le 14 et le 15 sont deux concerts, et fusionner en supprimerait un |
| 2026-09-23 | **La fusion automatique s'arrête aux titres « frères »** (chacun un mot propre) : ils sont signalés avec leur identifiant, pas fusionnés | « Clôture de saison » / « Clôture festive » et « TDA Poneys » / « TDA Équitation » ont la même forme et des sens opposés. Aucun seuil de similarité ne les sépare ; trancher à la main via `overrides.json` coûte moins cher qu'un événement supprimé à tort (§3.W) |
| 2026-09-23 | Une fusion adopte un chemin plus profond sur le même hôte, même si l'URL en place est déjà vérifiée | Le lien vers la page de l'exposition vaut mieux que le lien vers l'accueil du château ; même domaine = aucune décision de confiance nouvelle |
| 2026-09-23 | `COMMUNES` passe de 21 à 23 (La Rochette, Saint-Fargeau-Ponthierry) | Dans le rayon et déjà publiées par les flux, mais jamais demandées au modèle : leur couverture dépendait de la source |
| 2026-09-24 | **`/favicon.ico` (16/32/48) à la racine + icône 192 déclarée**, le service worker ne précharge plus `fav.png` (Helioso) | Google affichait encore le soleil Helioso dans ses résultats : il avait indexé l'ancien `fav.png`, et le nouveau favicon 32×32 n'est pas un multiple de 48 px comme il le demande. Le `.ico` est aussi ce que les robots demandent sans lire la page. Remplacement côté Google : au prochain passage du robot, accéléré par « Demander une indexation » dans la Search Console |
| 2026-09-24 | **Pages statiques indexables par événement et par commune** (item 68, §3.X) | Le site n'est qu'une page qui charge ses données en JavaScript : aucun événement n'est visible pour un moteur de recherche. Le trafic de recherche est le préalable à toute monétisation |
| 2026-09-24 | **Le risque grounding est élargi, en connaissance de cause** : les fiches sont publiées pour toutes les sources, Gemini compris (78 % des événements) | Décision du chef de projet (option 2 sur 3). La décision du 20/09 acceptait le risque pour un projet **sans revenu** et demandait de le réévaluer avant toute hausse de visibilité : les deux conditions changent ici. Écartées : fiches limitées à DATAtourisme/OpenAgenda (47 événements), ou attendre de réduire la dépendance à Gemini |
| 2026-09-24 | Le script de pages **n'écrit jamais `data.json`** ; `pageUrl` est calculé par le pipeline avec la même fonction | Le premier jet réécrivait `data.json` en tableau v1 (perte de `schemaVersion`, `windowEnd`) — et plantait avant, sur l'objet v2. Un seul écrivain |
| 2026-09-24 | Adresse = texte lisible + **jeton de l'id** ; ancien dossier → redirection `noindex` | Un slug titre-date change à chaque correction de titre et casse une URL déjà indexée. L'id, lui, est conservé toute la vie de la fiche |
| 2026-09-24 | Balisage schema.org `Event` seulement si le lien est vérifié ; `Offer` seulement pour un prix non ambigu | Un encart Google avec une date ou un prix faux coûte plus cher que pas d'encart (§5) |
| 2026-09-24 | Fiches d'événements passés **supprimées**, `404.html` écrit à la main | Aucun état à tenir ; le visiteur qui arrive d'un vieux résultat trouve un chemin vers ce qui est à venir |
| 2026-09-24 | **Filtre « Ville »** à côté de la période, options tirées des données | Contrairement au filtre d'âge retiré le 23/09, il discrimine vraiment : Fontainebleau 142 événements sur 214, chaque autre ville 1 à 11. Seules les villes ayant un événement à venir sont proposées |
| 2026-09-24 | **Abonnement agenda (`.ics`)** : un flux général, un par catégorie, un par commune (§3.Y) | Le programme va dans le téléphone sans compte, sans envoi, sans serveur |
| 2026-09-24 | Événements de plus de 7 jours **exclus des flux** | Une exposition de quatre mois en « journée entière » occuperait le haut de l'agenda chaque jour jusqu'en janvier. Ils restent sur le site |
| 2026-09-24 | Entrées « journée entière » uniquement | `schedule` est du texte libre : une heure devinée serait une heure fausse dans le téléphone de quelqu'un |
| 2026-09-24 | Bouton « Ajouter à mon agenda » **sous** la carte et la liste, icône dessinée aux couleurs de la marque | Le visiteur regarde, choisit, puis s'abonne : l'action vient après le contenu, et le haut de page reste dégagé. La liste défile dans son propre cadre, donc « dessous » reste à portée. Un emoji prend la palette du système, pas celle de la marque |
| 2026-09-24 | Un flux publié n'est jamais supprimé (calendrier vide à la place) | Un abonnement qui répond 404 provoque une erreur ou une désinscription selon l'application |
| 2026-09-24 | **Widget partenaire gratuit** : `<iframe>` + lien en clair dans le code fourni, page `noindex`, aucune mesure d'audience | Le lien dans l'iframe ne compte pas pour Google, celui de la page du partenaire oui. On ne mesure pas les visiteurs d'un site tiers qui n'ont rien accepté |
| 2026-09-24 | **Réduire la dépendance au grounding par des sources légitimes, jamais en masquant l'origine** (item 72) | Proposé puis écarté : diluer la provenance ou faire transiter les données par un site « perso » non monétisé. Un site non monétisé n'est pas conforme pour autant (les conditions interdisent le stockage et la republication, revenu ou pas), et masquer l'origine transformerait un risque accepté en tromperie délibérée — indéfendable devant Google comme devant une mairie cliente |
| 2026-09-24 | **Critère de bascule : ≥ 90 % des événements publiés retrouvés par des sources légitimes**, mesuré en parallèle sans rien changer en production | La valeur du site est l'exhaustivité sur les événements clés : aucune bascule qui en perde. Le résidu (≤ 10 %) reste issu de Gemini, risque accepté et connu ; si la clé est coupée, il est perdu et recherché à la main ou par partenariat |
| 2026-09-24 | Mesuré : **7 sites d'organisateurs portent 110 des 167 événements Gemini (66 %), 15 en portent 139 (83 %)** | Gemini relit surtout une quinzaine de sites connus. La piste « lecture directe » (ancien item 37, écarté le 20/09 pour son coût) devient rentable. Sondés : tous ont une page agenda trouvable ; le Grand Parquet publie un `.ics` ; david-nature.com interdit les robots (`Disallow: /`) et sera respecté |
| 2026-09-24 | **Lecture directe : un lecteur par site, déterministe dès que le site le permet** (§3.Z) | Les sites clés n'ont pas tous le même format : `.ics` (Grand Parquet), liste Apidae (office de tourisme), HTML simple. Une date lue par une expression régulière testée est plus sûre qu'une date lue par un modèle. Gemini sans grounding seulement pour les pages sans structure |
| 2026-09-24 | `robots.txt` respecté, sites JavaScript laissés de côté | david-nature.com interdit les robots : jamais lu. Aucun contournement d'un site qui se protège ; les sites purement JavaScript attendent un meilleur moyen |
| 2026-09-24 | **Doublons « frères » : jugés par Gemini sans grounding, verdicts mémorisés** (§3.W2) — la règle de §3.W « jamais fusionner des frères » est levée pour les paires qu'un juge dit identiques | Aucune règle sur les mots ne sépare « TDA Poneys / TDA Équitation » de « TDA CREIF / TDA Tournée des As » : c'est une question de sens. ~15 vrais doublons en ligne et le chef de projet ne veut pas trier à la main. Garde-fous : dans le doute « non », masqués jamais fusionnés, `keepSeparate` pour défaire |
| 2026-09-24 | Une fusion garde la fiche déjà publiée et vérifiée, et lui ajoute la page plus précise et la position exacte de l'autre | L'id stable garde `overrides.json` attaché ; l'information la plus précise ne doit pas être perdue avec le doublon |
| 2026-09-24 | **Les sites des organisateurs deviennent une source publiée** (§3.Z2), le grounding reste en place | Demande du chef de projet : publier les nouveaux événements, prendre les infos plus précises, sans relecture manuelle. Ce sont des sources légitimes : aucune raison d'attendre le seuil de 90 %, qui ne concerne que l'arrêt du grounding |
| 2026-09-24 | Une confirmation par un site ne change **jamais les dates** (`enrichFrom()`) | Une séance datée lue sur le site ne doit pas raccourcir une fiche de plusieurs jours. Seuls le lien, l'adresse et les champs vides sont pris |
| 2026-09-24 | Une offre de plus de 14 jours lue sur un site confirme mais n'est jamais ajoutée | Même seuil que les « récurrents » DATAtourisme : le petit train du château n'est pas une sortie à annoncer |
| 2026-09-24 | fontainebleau.fr (HTTP 418 depuis GitHub) n'est pas contourné | Le site bloque les adresses cloud. Ses 27 événements restent sur Gemini en attendant mieux (partenariat, phase commerciale) |
| 2026-09-24 | Pas de démarchage (formulaire organisateurs, partenariats de données) avant la phase commerciale | Choix du chef de projet : rien ne doit demander d'effort aux mairies ou organisateurs à ce stade |
| 2026-09-24 | Pas de `git add -A` à la racine dans le workflow | Le bot publie sur `main` sans relecture : tout fichier parasite partirait en ligne |

---

## 8. Risks & Open Questions

| Risk / question | Mitigation / next step |
|---|---|
| LLM hallucination (dates, prices, venues, URLs) | Validation + URL checks + geocoding flags now; "report an error" link and source attribution planned; manual review of the first weeks of data before outreach |
| 🟠 **Google Search grounding terms** (§3.G): results may only be shown, with Search Suggestions, to the prompting end user; no caching, storing, syndicating or link collection. **Risk accepted knowingly on September 20** | Conditions: dedicated Google Cloud project, billing account and API key (done, item 43); key restricted to the Gemini API; budget alert; `data.json` versioned in git so the site survives a suspension. Exposure grows with visibility — **re-assess before contacting the City or INSEAD**, when DATAtourisme coverage will also be known. **Widened on September 24** (§7): Gemini-sourced events are now published as indexable pages and submitted to Google, with monetisation in view — both conditions of the September 20 acceptance no longer hold. Fallback if the key is suspended: DATAtourisme + OpenAgenda keep ~47 events and their pages. **Plan (Sept 24, item 72):** move to legitimate sources (organisers' own pages read directly, feeds) once they cover ≥ 90 % of published events, measured in shadow mode; the residue stays on Gemini as a known, accepted risk. Obscuring provenance was considered and rejected (§7). Same day: **calendar feeds and a free partner widget** (§3.Y) are two more syndication channels, free of charge. A paid widget would be syndication **for money**: a separate decision (item 71) |
| 🟢 Cost: estimated ≈ $7/month now, ≈ $14/month from January 2027 at a daily cadence (§3.G). **Divided by ~3 by the new cadence** → roughly $2–5/month | Still to be replaced by real run-summary numbers (item 39); budget alert on the dedicated project |
| DATAtourisme CSV schema may change | The probe validates the columns and **fails loudly**, listing the columns actually found, instead of producing an empty report |
| Legal / attribution: reuse of organizers' listings | Always link to the source; consider contacting large sources; prefer structured/open data where available |
| Scheduled workflows can be auto-disabled after 60 days of repository inactivity | Verify how bot commits count; add a keep-alive if needed |
| Model name / API changes (`gemini-3.6-flash`) | Model is configurable via `GEMINI_MODEL`; failure is loud (exit 1) |
| Recall of a single source family (web search only) | Source registry + open data (items 37, 27, 38) |
| Cancelled events stay listed until their end date | Future: stale/`lastSeen` detection, "report an error" feedback |

---

## 9. Roadmap & To-Do List

**Cette section ne liste que ce qui reste à faire.** Tout ce qui est livré est documenté là où
il se comprend : le journal des décisions (§7) dit *pourquoi*, les sections §3.A à §3.S disent
*comment*. Réécrite le 22 septembre : elle comptait 86 lignes dont 66 cochées, et les vingt
choses qui restaient étaient noyées dedans.

État au 22 septembre : **197 événements**, 3 sources (Gemini, DATAtourisme, OpenAgenda),
61 % de positions exactes, FR/EN, PWA, boucle de signalement fermée, 11 suites de tests.

---

### A. Pour le chef de projet — rien à coder

- [x] **61. Visuels de marque — posés le 23/09** (§3.V). Favicon, icônes PWA 192 et 512, icône
  iOS, marque du bandeau, signature du pied de page et image de partage. La palette du site est
  désormais celle du logo, relevée sur les fichiers.
- [ ] **61c. Favicon dans Google** : `/favicon.ico` en ligne depuis le 24/09. Demander une
  indexation de la page d'accueil dans la Search Console, puis vérifier sous quelques jours à
  quelques semaines que la feuille de chêne a remplacé le soleil Helioso dans les résultats.
- [ ] **68b. Après le premier déploiement des pages** (§3.X) : dans la Search Console, menu
  « Sitemaps », soumettre `https://fontainebleaulive.fr/sitemap.xml` ; tester une fiche dans
  l'outil « Test des résultats enrichis » de Google ; ouvrir une adresse inexistante pour voir
  la page 404. Puis suivre, sur quelques semaines, le nombre de pages indexées (rapport
  « Pages ») et les requêtes qui amènent des visites (rapport « Performances »).
- [ ] **61b. Ré-exporter les PNG sans entrelacement** et le lockup du pied de page à sa taille
  d'affichage. Gain estimé : quelques dizaines de Ko. Sans urgence.
- [ ] **Surveiller 3 à 5 runs automatiques.** Ce qu'il faut regarder dans le rapport : tokens et
  requêtes de recherche par scan (le coût réel, à comparer à l'estimation §3.G), motifs de rejet,
  liens morts, sources de géocodage, doublons signalés mais non fusionnés.


### B. Ce qui a le plus de valeur maintenant

- [x] **38. Couverture sport — première passe faite le 22/09** (§3.T). Aucune source à ajouter :
  les quatre pistes vérifiées ne donnent rien de neuf. En revanche le prompt décrivait un
  périmètre de 15 km et dix communes alors que le pipeline en accepte 20 et en publie vingt et
  une, et le focus sport était générique. Corrigé. **À mesurer sur le prochain scan : si le
  compte sport ne bouge pas, c'est que la région produit vraiment peu d'événements sportifs,
  et la question se ferme.**
- [x] **38b. Fermé le 23/09 : il n'existe pas de source d'événements sportifs exploitable ici.**
  Vérifié une par une, pour que la recherche ne soit pas refaite :
  | Piste | Ce qu'elle contient |
  |---|---|
  | RNA (Répertoire national des associations) | Un annuaire d'**associations**. Aucune date d'événement |
  | API Recherche d'entreprises | Testée : renvoie bien les associations sportives (NAF 93.12Z), mais les seules dates sont création, fermeture et mise à jour |
  | Pages publiques des campagnes HelloAsso | Du scraping — exclu par le chef de projet |
  | API HelloAsso v5 | Authentification OAuth obligatoire (`/v5/organizations` → 401), donc un compte à créer. Écarté |
  | FFA `bases.athle.fr`, FFRandonnée | HTML uniquement, donc du scraping. Écarté |

  **Sous-produit également écarté.** L'API Recherche d'entreprises donne la liste réelle des clubs
  sportifs des 21 communes — 336 structures actives. L'idée d'en nommer quelques-uns dans le
  prompt a été abandonnée : la majorité sont des associations sportives scolaires qui
  n'organisent rien de public, et en citer une poignée d'arbitraires biaiserait la recherche plus
  qu'elle ne l'aiderait.

  **Ce qui reste à mesurer, et c'est gratuit :** la correction du périmètre du 22/09 (§3.T) n'a
  pas encore été éprouvée par un scan. Le prompt cherchait dans 15 km et dix communes alors que
  le pipeline en accepte 20 et vingt et une. Si le compte sport ne bouge pas après ce scan, la
  conclusion honnête est que la région produit peu d'événements sportifs sur trois mois. Mesuré le 22/09 : **21 événements
  « Sport & Outdoor » sur 197 (11 %)**, contre 120 en Culture. C'est l'écart que le chef de
  projet signale depuis le début, et les trois sources actuelles ne le comblent pas. Pistes :
  calendriers de clubs et de fédérations, HelloAsso, agendas des offices municipaux des sports.
- [x] **22. Axe famille — tranché le 23/09 par la simplification.** Le filtre « Public cible »
  est retiré : 147 événements sur 197 sont tout public, donc chaque option en renvoyait 73 à
  90 %. Un marqueur `family` déduit du contenu reste possible si le besoin revient, mais il
  faudrait des données qui le portent. Ancien libellé : 129 événements sur 197 sont « tout public » (0–99 ans), ce qui ne
  dit rien à un parent. La tranche d'âge seule est un mauvais signal : il faut un marqueur
  `family` déduit du contenu, et un filtre qui s'appuie dessus.
- [x] **28. Détection des événements silencieux — fait le 23/09.** Champ `lastSeen`, seuil de
  10 jours (trois scans), rapport en deux niveaux : disparition d’un flux qui a bien répondu
  (sérieux) vs absence de mention par le modèle (information). Rien n’est supprimé. Ancien
  libellé : jamais par absence seule
  — la recall du modèle varie d'un jour à l'autre. La boucle de signalement (§3.N) couvre déjà
  le cas signalé par un visiteur ; il manque le cas silencieux.
- [x] **39. Alertes de budget posées par le chef de projet (23/09).** Reste ouvert, plus tard :
  journaliser le coût estimé par run et réévaluer le modèle (`gemini-3.6-flash` est une
  génération précédente, les prix montent au 1er janvier 2027). Ancien libellé : journaliser le coût estimé par run, poser
  une alerte de budget sur le projet Google Cloud, et réévaluer le modèle : `gemini-3.6-flash`
  est désormais une génération précédente et les prix montent au 1er janvier 2027.

### B2. Audience et monétisation — idées du 24/09, rien de commencé

- [x] **69. Abonnement agenda (`.ics`) — fait le 24/09** (§3.Y). Tranché : événements de plus de 7 jours exclus, entrées « journée entière », flux jamais supprimés. **Reste : tester l'abonnement en vrai** dans Google Agenda, Apple Calendrier et Outlook, et vérifier une mise à jour le lendemain. Idée d'origine : `generate-pages.js` écrit `agenda.ics`, plus un fichier
  par catégorie et par commune (« Sport autour de Fontainebleau »). Un bouton « Ajouter à mon
  agenda » propose un lien `webcal://` (Apple Calendrier) et un lien d'abonnement Google Agenda.
  Les événements arrivent dans l'agenda du téléphone et se mettent à jour seuls : aucun coût,
  aucun envoi, entièrement automatique. **Points à trancher avant de coder :**
  - **Les expositions longues.** « Le panache des Lumières » dure quatre mois : en événement
    « journée entière », elle occuperait le haut de l'agenda tous les jours jusqu'en janvier.
    Pistes : exclure les événements de plus de 7 jours du flux général, ou ne publier que le
    premier jour.
  - **Le format est pointilleux** (RFC 5545) : fins de ligne CRLF, lignes coupées à 75 octets,
    virgules et points-virgules échappés, `DTEND` exclusif (lendemain du dernier jour), `UID`
    stable, qui sera l'id de l'événement. Un flux invalide est ignoré sans message par
    l'agenda. À tester dans Google, Apple et Outlook avant d'annoncer quoi que ce soit.
  - **Google Agenda rafraîchit lentement** un agenda abonné, parfois plus de 24 h. Le promettre
    « à jour chaque jour », pas « en temps réel ».
  - Un événement annulé doit disparaître du flux : c'est déjà le cas, puisque le fichier est
    régénéré en entier à chaque run.
  - **Risque grounding (§8)** : un flux d'agenda est de la syndication au sens strict. C'est
    couvert par la décision du 24/09, mais c'est un canal de plus à citer dans §8.
- [ ] **70. Groupes Facebook des communes** (« Tu sais que tu viens de Fontainebleau », groupes
  de parents, de clubs). Un post soigné par mois dans deux ou trois groupes, avec le lien vers une
  page commune ou une fiche. **Lire les règles de chaque groupe d'abord** : beaucoup interdisent
  l'auto-promotion, et demander à l'administrateur avant le premier post vaut mieux qu'un
  bannissement. **Automatisable : non, pas la publication.** Meta a retiré en 2024 l'API qui
  permettait de publier dans les groupes, et publier par un robot dans un groupe dont on n'est
  pas administrateur enfreint les conditions de Facebook : risque de bannir le compte, qui est
  le canal lui-même. **Ce qui s'automatise :** le brouillon. Le générateur peut écrire chaque
  mois un texte prêt à coller par commune (« Ce mois-ci à Avon : … », 5 événements, lien vers la
  page commune), à relire puis poster à la main. Coût : environ 5 minutes par groupe et par mois.
- [ ] **71. Widget partenaire — le gratuit est fait le 24/09** (§3.Y, `/widget/integrer/`). **Reste le premium**, et la décision grounding qui le précède. Idée d'origine : Un encart à intégrer sur le site d'une
  mairie, d'un office de tourisme, d'un hôtel ou d'un club, qui affiche les prochains
  événements, par exemple ceux de sa commune ou d'une catégorie.
  - **Gratuit** : `<iframe>` servi depuis le site (une page `/widget/?ville=…` générée ou
    filtrée en JavaScript), avec la mention et le lien « Fontainebleau Live ». Ce lien est en
    soi un gain : un lien entrant depuis le site d'une mairie pèse lourd pour Google.
  - **Premium** : à définir avec les premiers partenaires, avant de coder. Pistes : sans la
    mention, aux couleurs du partenaire, événements du partenaire mis en avant, statistiques
    d'affichage.
  - **Contrainte d'architecture** : le site est statique, sans serveur ni comptes. Un premium
    demande au minimum un paiement (lien de paiement Stripe, facturation à la main au début) et
    une clé par partenaire. Sans serveur, cette clé ne se vérifie pas vraiment : une première
    version peut reposer sur la confiance et le contrat. Pas de dépendance à ajouter pour ça.
  - **Préalable** : c'est de la **syndication vers des tiers, contre paiement**, avec des
    données issues à 78 % de Gemini. C'est le cas le plus exposé au regard des conditions de
    Google (§3.G, §8), au-delà de ce qu'a tranché la décision du 24/09 sur les pages. À
    trancher explicitement avant le premier widget premium. Le passage « Outreach gate » des
    Milestones s'applique aussi : on contacte une mairie ou un office de tourisme.

### B3. Sortir du grounding sans rien perdre — décidé le 24/09

- [x] **72, étape 2 — les sites sont une source publiée, le 24/09** (§3.Z2). **À regarder au
  prochain scan** : la ligne « 🏛️ Sites des organisateurs » du rapport (fiches lues, confirmées,
  offres permanentes écartées, rejets) et les nouveaux événements sur le site.
- [ ] **72. Comparatif en parallèle — construit le 24/09** (§3.Z). Premier run local sans les
  sources lues par Gemini : **43 %**. **À faire : lancer le workflow « Comparatif des sources »**
  (onglet Actions, bouton *Run workflow*) pour le premier chiffre complet, puis relire les
  « manqués » et les « probables » du rapport. Ensuite, par ordre de rendement : ANVL (22
  événements, calendrier AJAX du plugin de réservation), Amis de la Forêt (8), Vaux (3), Melun (3).
  Idée d'origine : Rien ne
  change en production tant que le critère n'est pas atteint.
  - **Registre `sources.json`** (édité à la main) des ~15 sites qui portent 83 % des événements
    Gemini : un `.ics` quand le site en publie un (Grand Parquet), sinon la page agenda lue
    directement et extraite par Gemini **sans grounding** (même appel que la traduction). Tout
    automatique, aucun contact avec les sites. `robots.txt` respecté (david-nature.com exclu).
  - **Rapport à chaque run** : part des événements publiés retrouvés par (sources directes +
    DATAtourisme + OpenAgenda), liste des événements manqués pour juger s'ils sont « clés »,
    rendement par source — une source à 0 signale un site refait.
  - **Critère : ≥ 90 %** des événements publiés, sur plusieurs runs consécutifs. Alors seulement
    le grounding passe en observation (il signale des sites à ajouter au registre, rien de ce
    qu'il renvoie n'est publié) sauf pour le résidu accepté.
- [x] **51c. Doublons « frères » — fait le 24/09** (§3.W2) : paires candidates repérées
  mécaniquement, jugées par Gemini sans grounding, verdicts mémorisés. **À regarder au premier
  scan** : la liste des fusions dans le rapport de run ; une fusion à défaire tient en une ligne
  `keepSeparate` dans `overrides.json`.
- [ ] **72b. API de recherche avec droit de stockage** pour le résidu, à évaluer dans le même
  comparatif si les sources directes plafonnent sous 90 %. Relevé le 24/09 : Brave 5 $/1 000
  requêtes (5 $ offerts par mois ; **le stockage exige un plan qui l'accorde explicitement**,
  vraisemblablement sur devis), Exa 7 $/1 000, Tavily 0,008 $/crédit. Aucun n'a l'index de
  Google sur la longue traîne locale française : à mesurer, pas à supposer. Conditions de
  stockage à lire avant tout usage.
- [ ] **72c. Plus tard, phase commerciale** : formulaire « Ajouter mon événement » et partenariats
  de données (office de tourisme, mairies), idéalement sans effort pour eux (lecture de leur flux).

### C. Finitions

- [x] **21. Catégories — fait le 23/09** (§3.U). L'audit ne trouve que quatre cas limites sur 197,
  tous défendables : la cohérence n'était pas le problème. Le problème était la taille —
  « Culture & Ateliers » pesait 61 %. Une quatrième catégorie « Scène & Spectacles » et un
  classificateur unique pour les trois sources ramènent le plus gros bloc à 37 %. Ancien libellé :
  Trois sources les déduisent désormais chacune à sa façon
  (§3.I, §3.S). Vérifier que l'ensemble reste cohérent, et décider si les visites de patrimoine
  méritent leur propre catégorie plutôt que de gonfler « Culture & Ateliers » (120 sur 197).
- [x] **26b. Accessibilité — fait le 23/09** (§3.U) : onglets en `tablist` avec `aria-selected`
  qui suit la vue, panneaux reliés à leur onglet, filtres en groupe nommé, liste de résultats en
  région `aria-live`, anneau de focus visible sur tous les contrôles.
- [x] **51b. Doublons, deuxième passe — faite le 23/09** (§3.W). Trois groupes signalés en
  direct. Deux assouplissements mesurés puis posés : pluriel neutralisé au-delà de cinq lettres,
  et périodes pluri-journalières qui se chevauchent. Rendement honnête : **2 fusions** sur les
  222 fiches, parce que §3.P avait déjà fait le gros. Les deux groupes restants (Chandelles,
  #ForêtBelle) ont exactement la forme du piège TDA — chaque titre porte un mot que l'autre n'a
  pas — donc ils ne seront **jamais** fusionnés automatiquement : quatre fiches masquées à la
  main dans `overrides.json`, après vérification sur les sites des organisateurs. Le rapport de
  run donne désormais l'identifiant de chaque paire douteuse, pour que trancher tienne en une
  ligne collée.
- [ ] **58c. Fond de carte plus sobre** (CARTO Positron/Voyager). Le plus gros changement visuel
  par ligne modifiée, mais il ajoute un fournisseur de tuiles : refusé pour l'instant, gardé ici
  parce que la question se reposera.
- [ ] **31. Cache des URL mortes**, pour ne pas revérifier à chaque scan un lien que le modèle
  re-propose. Gain : quelques dizaines de secondes par run. Aucune conséquence visible.
- [ ] **32. Branche `data` dédiée**, pour sortir les commits du bot de l'historique de `main`.
  16 commits du bot sur 68 au 22/09 : pas encore gênant, à reconsidérer vers 100. **Plus pressant
  depuis le 24/09** : les pages statiques (§3.X) ajoutent ~240 fichiers générés au dépôt, et le
  bot committe désormais aussi les jours sans scan quand une fiche expire.

### D. Tranché — ne pas rouvrir sans raison nouvelle

- **23. Événements récurrents : abandonné (22/09).** Le frontend portait un traitement
  `dateType: "recurring"` depuis la v1 ; rien ne l'a jamais produit (197 fiches, 197 `event`).
  Les branches mortes ont été retirées. Les marchés hebdomadaires restent hors périmètre.
- **67. Affichage des images : non (22/09).** Seuls 21 événements sur 197 en portent (11 %),
  tous venus d'OpenAgenda. Afficher une photo sur une carte sur neuf donnerait un site qui a
  l'air cassé. Le champ `image` reste stocké : la question se retranchera si la proportion monte.
- **60. Application native : non.** Usage à faible fréquence, 99 €/an + 25 €, deux revues de
  store par sortie, pour lire le même `data.json`. La PWA (§3) couvre le besoin, et c'est aussi
  le prérequis des notifications push sur iOS. À rouvrir seulement si les analytics montrent des
  visites répétées.
- **37. Bascule vers l'extraction directe : abandonné (20/09).** Plus de travail que le pipeline
  actuel, fragile aux changements de sites, couverture de départ plus faible. À rouvrir si Google
  suspend la clé.
- **48c. Filtrage des colonnes du tableau de réponses : non (23/09).** Décision du chef de
  projet, risque accepté en connaissance de cause. Constaté ce jour-là : la colonne « Votre
  contact (facultatif) » est bien publiée, mais vide — personne ne l'avait renseignée. L'URL vit
  dans un secret GitHub, elle n'est pas dans le dépôt public et n'est pas devinable. Le motif
  invoqué : une adresse e-mail seule n'expose plus à grand-chose aujourd'hui. **Exposition
  résiduelle, pour mémoire** : si un visiteur laisse son adresse un jour, elle sera lisible par
  qui détient l'URL. Rouvrir si le formulaire se met à collecter davantage qu'un e-mail, ou si
  l'URL circule.
- **30. Keep-alive du workflow : sans objet.** La règle d'inactivité de 60 jours ne peut pas se
  déclencher avec un cron quotidien.

### E. Ménage — fait le 23/09

- [x] **`.github/workflows/datatourisme-coverage.yml` et `scripts/datatourisme-coverage.js` supprimés.** C'était la sonde en
  mode observation, avant que DATAtourisme n'entre dans le pipeline (§3.I). La source est
  vérifiée en production depuis le 21/09 — 26 événements publiés. Le workflow télécharge 9 Mo par
  semaine pour un rapport que plus personne ne lit. La bibliothèque partagée `datatourisme.js`
  reste : `feedback.js` réutilise son parseur CSV. L’historique git conserve les fichiers.

### Milestones

**Beta gate (friends & family):** Step 0 + P0 (1–6) + P1 (7–12) + items 14–17 and 34–35 (item 15 needs the Google Form link), with at least one week of clean automated runs. **Only as a small private test** while items 37/27 are under way (decision 40).
**Outreach gate (city, clubs, INSEAD…):** **re-assess the grounding risk (§8) with the DATAtourisme coverage figures in hand (items 44, 45)** · item 39 · beta feedback processed · items 16, 24 · manual review of a few weeks of published data. The decision of September 20 accepts the risk for a private beta; institutional outreach is a deliberate increase in visibility and must be decided separately.





link data form to get feedback:
https://docs.google.com/forms/d/e/1FAIpQLScRjLM5_R4K_d-0UUJk7lT1hvP8UBKyBMtniKskJviaG8ZRgw/viewform?usp=publish-editor

