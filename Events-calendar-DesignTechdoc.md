# Technical & Architecture Design Document
 
**Project:** Autonomous Local Event Aggregator (Fontainebleau Region)
**Date:** September 19, 2026
**Version:** 2.0 (hardening release)
**Status:** v1 operational in production (pipeline green) · **v2 code prepared and tested offline, pending deployment**
 
---
 
## 1. Project Overview & Objectives
 
The goal of this project is to maintain an autonomous, low-cost event tracking application for the Fontainebleau area (≈15 km radius including Avon, Samois-sur-Seine, Barbizon, Moret-Loing-et-Orvanne, Nemours, Thomery, Bois-le-Roi, Bourron-Marlotte, Vaux-le-Vicomte and Blandy-les-Tours).
 
The system automatically scans official agendas, local association publications and ticketing platforms, formats the extracted data into a standardized JSON structure, and updates the live web application **without manual intervention**. Events are shown on a **map** and on a **calendar** for the **next 4 months**, with a focus on **sports, cultural and family activities**.
 
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
│  6. Write data.json + geocode-cache.json + run report        │
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
**Solution:** a small prepaid balance on Google Cloud bypassed the barrier; operating cost is expected to stay very low.
*v2 update:* search grounding may be billed per search query (check current Google pricing), so **every run now reports tokens and number of search queries per scan** (job summary) to confirm the cost assumption with real numbers.
 
### C. Temporal filtering & GPS integrity (v1)
 
**Problem:** past events and missing coordinates broke the list and map.
**Solution (v1):** rolling 4-month window in the prompt, a guard clause on new events, fallback coordinates at Fontainebleau centre.
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
 
**Test status:** the pipeline was tested **offline with mocked Gemini, BAN and web responses** (unit tests + end-to-end: retries, truncation salvage, dead/blocked URLs, redirect resolution, geocoding fallbacks, idempotence, failure paths), the workflow's commit/rebase/push step against a local bare remote, and the frontend in a simulated DOM (XSS payloads, filters, calendar). **It has not yet run against the live Gemini/BAN/web services** — the first production runs are therefore part of the verification plan (Section 8).
 
---
 
## 4. Data Schema (`data.json`, v2)
 
Still a bare JSON array (frontend-compatible). Fields added in v2 are marked ★.
 
```json
[
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
    "schedule": "String",
    "price": "String",
    "organizer": "String",
    "description": "String",
    "url": "String (http/https URL)",
    "urlStatus": "ok | unverified",
    "urlCheckedAt": "YYYY-MM-DD"
  }
]
```
 
★ `geoSource`, `geoApprox`, `urlStatus`, `urlCheckedAt`.
 
**Rules**
 
- **Identity:** key = `normalise(title) | startDate | normalise(city)`; `id` = hash of the key. Existing IDs (e.g. `ACT_002`) are kept.
- **Geocoding order:** BAN venue match (score ≥ 0.6, inside bounding box) → model coordinates (inside bounding box) → BAN city centroid → Fontainebleau centre. Only `ban` is considered verified (`geoApprox: false`).
- **Bounding box:** lat 48.20–48.65, lng 2.45–3.00.
- **URLs:** 2xx/3xx → `ok`; 404/410/non-existent domain → event dropped; anything else (403, 429, 5xx, timeout) → `unverified`, kept. Google grounding redirect links are resolved to the real page or the event is dropped. Checks are repeated every 7 days.
- **Categories:** exactly three values; common variants (e.g. "Nature & Patrimoine") are mapped, anything else is rejected.
- **Re-sighting of a known event:** `endDate`, `schedule`, `price` are refreshed; text fields are kept (avoids daily LLM rewrites); a verified URL is kept stable.
- **Output:** sorted by `startDate`, then title; file rewritten only if content changed (no empty commits).
---
 
## 5. Pipeline Behaviour & Safety Nets
 
| Situation | Behaviour |
|---|---|
| One scan fails (after 3 attempts) | Other scans continue; run succeeds; failure shown in the report. Events are pruned **only by date**, never by absence, so a partial failure deletes nothing |
| All scans fail, or no valid event returned | Run **fails** (exit 1); `data.json` untouched; GitHub notifies |
| `data.json` corrupted / not an array | Run fails; file never overwritten |
| Output truncated at token limit | Complete objects are salvaged; flagged in the report |
| Record invalid (date, category, URL, location…) | Dropped, counted by reason (`invalid_start_date`, `invalid_url`, `dead_url`, …) |
| Nothing changed | No write, no commit |
| `main` moved during the run | `git pull --rebase` + up to 3 push attempts |
 
**Migration note (first v2 run):** stored events go through the same validation. Legacy events with an invalid category or URL, and past events, are removed (git history is the backup); legacy coordinates are re-geocoded once and then cached.
 
---
 
## 6. Operations Runbook
 
- **Secrets:** `GEMINI_API_KEY` (GitHub → Settings → Secrets and variables → Actions).
- **Manual run:** Actions → *Check Quotidien & Mise à jour Data Gemini* → *Run workflow*.
- **Run report:** open the run → *Summary* (scans, tokens, search queries, added/refreshed/pruned, dead URLs, geocoding sources, rejection reasons).
- **Local dry run** (writes nothing): `GEMINI_API_KEY=… DRY_RUN=1 node scripts/fetch-events.js`
- **Environment variables:** `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS` (16384), `MAX_EVENTS_PER_SCAN` (20), `DATA_PATH`, `GEOCODE_CACHE_PATH`, `DRY_RUN`.
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
 
---
 
## 8. Risks & Open Questions
 
| Risk / question | Mitigation / next step |
|---|---|
| LLM hallucination (dates, prices, venues, URLs) | Validation + URL checks + geocoding flags now; "report an error" link and source attribution planned; manual review of the first weeks of data before outreach |
| **Google grounding terms** for displaying grounded results to end users (search suggestions / attribution requirements) | Read the current Gemini API terms before public launch; adjust UI if required |
| Cost with search grounding (may be billed per search query — check current pricing) | Run report logs tokens and queries per scan; check after the first week |
| Legal / attribution: reuse of organizers' listings | Always link to the source; consider contacting large sources; prefer structured/open data where available |
| Scheduled workflows can be auto-disabled after 60 days of repository inactivity | Verify how bot commits count; add a keep-alive if needed |
| Model name / API changes (`gemini-3.6-flash`) | Model is configurable via `GEMINI_MODEL`; failure is loud (exit 1) |
| Recall of a single source family (web search only) | Add structured sources (OpenAgenda, DATAtourisme, tourism-office feeds) |
| Cancelled events stay listed until their end date | Future: stale/`lastSeen` detection, "report an error" feedback |
 
---
 
## 9. Roadmap & To-Do List (by priority)
 
**Legend:** `[x]` done and in production · `[~]` implemented in v2 code, **to be verified in production** · `[ ]` open
 
### Done (v1)
 
- [x] Set up Google Cloud billing and Gemini API key configuration
- [x] Configure GitHub Actions workflow for scheduled runs
- [x] Robust regex JSON extraction for `gemini-3.6-flash`
- [x] Rolling 4-month date window and GPS fallbacks
- [x] Clean historical database placeholders
- [x] `{ cache: 'no-cache' }` in the frontend `fetchData()`
### Step 0 — Deploy v2 and verify
 
- [ ] Deploy v2 (`scripts/fetch-events.js`, `.github/workflows/daily-check.yml`, `index.html`); run once manually with `DRY_RUN=1`, then via *Run workflow*
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
- [ ] 13. Cost & terms check: review Gemini grounding display terms; compare real per-run cost with the assumption (data available in the run report)
### P2 — Beta readiness & product/UX
 
**Beta gates (needed to collect useful feedback):**
- [ ] 14. "Last updated" timestamp shown in the UI (requires `data.json` → `{ generatedAt, events }`; update script and frontend together)
- [ ] 15. "Report an error" link on each card (pre-filled form or mailto with event ID)
- [ ] 16. Source attribution + "verify with the organizer" note
- [ ] 17. Privacy-friendly analytics (GoatCounter / Plausible / Umami)
**Other UX & product:**
- [ ] 18. Marker clustering / spiderfy; distinct style for approximate positions (`geoApprox`)
- [ ] 19. Card ↔ marker linking; sort cards by start date; show real dates prominently
- [ ] 20. Error state when `data.json` fails to load; reset-filters button; list view on mobile
- [ ] 21. Category badge normalization on the frontend (existing item); align category set with heritage/château visits
- [ ] 22. Family axis: `family: true` tag / audience filter (age range alone is weak)
- [ ] 23. Decide on recurring events (`dateType: "recurring"` is handled by the frontend but never produced by the extractor)
- [ ] 24. Manual overrides (`overrides.json` or `locked: true`) so hand corrections survive re-scans
- [ ] 25. SRI hashes for CDN scripts (Leaflet, FullCalendar)
- [ ] 26. Open Graph / sharing metadata; accessibility pass on tabs and filters
### P3 — Data sources & long-term robustness
 
- [ ] 27. Structured sources as backbone (OpenAgenda, DATAtourisme, tourism-office feeds/iCal); Gemini as gap-filler
- [ ] 28. Stale / cancelled event detection (`lastSeen`, feedback loop) — never by absence alone
- [ ] 29. Failure alerting beyond default GitHub emails (e.g. auto-opened issue)
- [ ] 30. Keep-alive for the scheduled workflow if the 60-day inactivity rule applies
- [ ] 31. Cache dead-URL results to avoid re-checking events re-suggested by the LLM each day
- [ ] 32. Consider a dedicated `data` branch to keep `main` history free of daily bot commits
### Milestones
 
**Beta gate (friends & family):** Step 0 + P0 (1–6) + P1 (7–12) + items 14–17, with at least one week of clean automated runs.
**Outreach gate (city, clubs, INSEAD…):** beta feedback processed · item 13 (terms & cost) · items 16, 24 · manual review of a few weeks of published data · at least one structured source (27).
 