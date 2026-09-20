# Technical & Architecture Design Document

**Project:** Autonomous Local Event Aggregator (Fontainebleau Region)
**Date:** September 20, 2026
**Version:** 2.2 (3-month window, age labels, terms & cost review)
**Status:** v2.1 deployed and working in production (confirmed September 20) · **v2.2 code prepared and tested offline, pending deployment** · ⚠️ **the terms review (§3.G) found that the current Google-Search-grounded approach does not fit Google's terms — see decision needed in §9**

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
| Workflow | `.github/workflows/daily-check.yml` |
| Frontend | `index.html` |
| Event data (generated) | `data.json` |
| Geocoding cache (generated) | `geocode-cache.json` |

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

**Recommendation:** B + C (open data as the backbone, direct extraction for what open data misses — clubs, associations, châteaux), and treat "widen sports and associations coverage" as work on the **source registry**, not on the grounded prompt.

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
      "urlCheckedAt": "YYYY-MM-DD"
    }
  ]
}
```

★ `geoSource`, `geoApprox`, `urlStatus`, `urlCheckedAt`.

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
| All scans fail, or no valid event returned | Run **fails** (exit 1); `data.json` untouched; GitHub notifies |
| `data.json` corrupted / not an array | Run fails; file never overwritten |
| Output truncated at token limit | Complete objects are salvaged; flagged in the report |
| Record invalid (date, category, URL, location, weekday…) | Dropped, counted by reason (`invalid_start_date`, `invalid_url`, `dead_url`, `weekday_mismatch`, …) |
| Nothing changed | No write, no commit (except the once-a-day `generatedAt` refresh) |
| `main` moved during the run | `git pull --rebase` + up to 3 push attempts |

**Migration note (first v2 run):** stored events go through the same validation. Legacy events with an invalid category or URL, and past events, are removed (git history is the backup); legacy coordinates are re-geocoded once and then cached.

---

## 6. Operations Runbook

- **Secrets:** `GEMINI_API_KEY` (GitHub → Settings → Secrets and variables → Actions).
- **Manual run:** Actions → *Check Quotidien & Mise à jour Data Gemini* → *Run workflow*.
- **Run report:** open the run → *Summary* (scans, tokens, search queries, added/refreshed/pruned, dead URLs, geocoding sources, rejection reasons).
- **Local dry run** (writes nothing): `GEMINI_API_KEY=… DRY_RUN=1 node scripts/fetch-events.js`
- **Environment variables:** `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS` (16384), `MAX_EVENTS_PER_SCAN` (20), `WINDOW_MONTHS` (3), `DATA_PATH`, `GEOCODE_CACHE_PATH`, `WEEKDAY_CHECK` (set `0` to disable), `DRY_RUN`.
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

---

## 8. Risks & Open Questions

| Risk / question | Mitigation / next step |
|---|---|
| LLM hallucination (dates, prices, venues, URLs) | Validation + URL checks + geocoding flags now; "report an error" link and source attribution planned; manual review of the first weeks of data before outreach |
| 🔴 **Google Search grounding terms** (§3.G): results may only be shown, with Search Suggestions, to the prompting end user; no caching, storing, syndicating or link collection | Move to direct-source extraction (items 37, 27); until then keep the audience limited and do no institutional outreach on grounded data |
| 🟠 Cost: estimated ≈ $7/month now, ≈ $14/month from January 2027 for 4 scans (§3.G) — more scans, more cost | Verify with real run-summary numbers; budget alert on the Google Cloud project; direct extraction removes the per-search fee (items 37, 39) |
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
- [ ] Deploy v2.2 (`scripts/fetch-events.js`, `index.html`; the workflow is unchanged): 3-month window (`windowEnd`), age labels, Google Form placeholder fix
- [ ] Create the Google Form and paste its pre-filled link in the `FEEDBACK.formUrl` field of `index.html`
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
- [ ] 40. **Decision (owner: project lead):** what to do during the transition — keep the daily grounded runs for a small private beta only, or pause them; no institutional outreach on grounded data
- [ ] 37. **Compliance pivot:** replace Google Search grounding with direct-source extraction — source registry (`sources.json`: URL/feed, type, commune, category hint), own fetcher (robots.txt, rate limit, conditional requests), LLM extraction from fetched text without the search tool, source URL kept per event; then remove `google_search` from the pipeline
- [ ] 27. Open/structured sources first (moved up from P3): DATAtourisme (verify coverage of the Fontainebleau area; daily CSV export on data.gouv.fr), OpenAgenda, city and tourism-office iCal/RSS feeds
- [ ] 38. Widen sports & associations coverage **through the source registry** (club and federation calendars, association agendas, HelloAsso pages, châteaux programmes) — not by tuning the grounded prompt
- [ ] 39. Cost guardrails & model review: log estimated cost per run, budget alert on the Google Cloud project, re-evaluate the model (3.6 Flash is now "previous generation"; prices rise on January 1, 2027; a lighter model may be enough for pure extraction)

### P2 — Beta readiness & product/UX

*Item numbers are stable identifiers, not ranks; the order within each list is the priority.*

**Beta gates (needed to collect useful feedback):**
- [~] 14. "Last updated" timestamp in the UI (`data.json` → `{ generatedAt, events }`, stale warning after 3 days)
- [~] 15. "Report an error" link on each card and in the footer (channel = Google Form; **needs the form link in `FEEDBACK.formUrl`**)
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
- [ ] 33. **English version** of the app: UI strings dictionary + language toggle (keep `LOCALE` and date formatting parameterised, already in place), translated category labels (data enum stays French), English event descriptions (translate at extraction or on demand; DATAtourisme advertises machine translation of its data, to be checked), `lang` attribute, English footer/disclaimer, shareable language URL parameter
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
**Outreach gate (city, clubs, INSEAD…):** **items 37 and 27 done (no grounded data in the published dataset)** · item 39 · beta feedback processed · items 16, 24 · manual review of a few weeks of published data.