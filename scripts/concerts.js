'use strict';
/**
 * Which concerts the agenda shows (decision of 24/11, project lead). Fontainebleau has far more
 * live music than a visitor needs: the agenda keeps the ones worth not missing, never a bar's
 * weekly night. Three levels:
 *
 *   1. Halls and great venues — theatre, château, churches, conservatoire, large stages: always.
 *   2. Bars and small venues: a one-off concert, dated, announced by a source we read (city,
 *      tourist office, OpenAgenda, ticketing, the organiser's site). Gemini alone is not enough.
 *   3. Never: the same title at the same place three times or more within 30 days, spread over
 *      two weeks or more (a weekly jam, a swing night) outside a level-1 venue; karaoke, blind
 *      test, open stage, an unnamed DJ night; a concert whose only link is a social network.
 *
 * Candlelight (Fever's touring candle-lit concerts): only when the tourist office announces it.
 *
 * Pure functions, no I/O: fetch-events.js calls drops() at its last step, after geocoding, and
 * lists what was set aside in the run report. Standard library only.
 */

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** A music night, by its title. Matched on the normalised (accent-free, lower-case) title. */
const MUSIC_RE = /\b(concerts?|jam|live|recital|apero concert|boeuf|soiree (swing|jazz|rock|blues|dj|musicale)|karaoke|blind test|scene ouverte|open mic|dj)\b/;

/** Level 3, whatever the source: formats, not concerts. */
const NEVER_RE = /\b(karaoke|blind test|scene ouverte|open mic)\b/;
/** « Soirée DJ » with no one named. « Soirée DJ avec X » names someone and is judged as a concert. */
const UNNAMED_DJ_RE = /\bsoiree dj\b(?! (avec|de|by) )/;

/** Level 1: halls, churches, châteaux, conservatoires, the area's large stages. */
const GREAT_VENUE_RE = /\b(theatre|chateau|eglise|chapelle|cathedrale|abbaye|prieure|conservatoire|salle de spectacle|mediatheque|ermitage|escale|cartonnerie|grand parquet|auditorium|salle des fetes)\b/;

/** Level 2: a bar, a pub, a café (not a café-théâtre), a lounge, the town's known music bars. */
const BAR_RE = /\b(bar|pub|bistrot?|brasserie|lounge|tavern|taverne|guinguette|cafe(?! theatre)|the office|le swing|the swing)\b/;

const SOCIAL_RE = /(^|\.)(facebook\.com|fb\.me|instagram\.com|tiktok\.com|x\.com|twitter\.com)$/;
const OFFICE_HOST_RE = /(^|\.)fontainebleau-tourisme\.com$/;

const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const DAY = 86400000;

const isMusic = (e) => MUSIC_RE.test(norm(e.title));
const placeOf = (e) => norm(`${e.locationName || ''} ${e.organizer || ''}`);

/**
 * Weekly-style series: same title and place, ≥ 3 dates within 30 days, spread over ≥ 14 days.
 * A festival on three consecutive nights is not one; a jam every Thursday is.
 */
function recurringKeys(events) {
  const groups = new Map();
  for (const e of events) {
    if (!isMusic(e) || GREAT_VENUE_RE.test(placeOf(e))) continue;
    const k = `${norm(e.title)}|${norm(e.locationName || e.city)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(Date.parse(e.startDate));
  }
  const out = new Set();
  for (const [k, days] of groups) {
    const d = [...new Set(days)].filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 0; i + 2 < d.length; i++) {
      // The third date after d[i] within 30 days, the whole run spanning two weeks or more.
      let j = i + 2;
      while (j + 1 < d.length && d[j + 1] - d[i] <= 30 * DAY) j++;
      if (d[j] - d[i] <= 30 * DAY && d[j] - d[i] >= 14 * DAY) { out.add(k); break; }
    }
  }
  return out;
}

/**
 * Why a concert is set aside, or null to keep it.
 * @param e        the event
 * @param opts.recurring  keys from recurringKeys()
 * @param opts.office     true when the tourist office announced it in this run
 * @param opts.officeDown true when the office could not be read this run (nothing is judged on
 *                        its silence then)
 */
function reason(e, { recurring = new Set(), office = false, officeDown = false } = {}) {
  const title = norm(e.title);
  if (/\bcandlelight\b/.test(title)) {
    if (office || officeDown || OFFICE_HOST_RE.test(host(e.url))) return null;
    return 'candlelight_not_office';
  }
  if (!isMusic(e)) return null;
  if (NEVER_RE.test(title) || UNNAMED_DJ_RE.test(title)) return 'format';
  if (recurring.has(`${title}|${norm(e.locationName || e.city)}`)) return 'recurring';
  if (SOCIAL_RE.test(host(e.url)) && !e.source) return 'social_only';
  const place = placeOf(e);
  if (!GREAT_VENUE_RE.test(place) && BAR_RE.test(place) && !e.source) return 'bar_unconfirmed';
  return null;
}

const LABELS = {
  candlelight_not_office: 'Candlelight non annoncé par l’office',
  format: 'karaoké, blind test, scène ouverte ou soirée DJ sans nom',
  recurring: 'soirée récurrente (3 dates ou plus en 30 jours)',
  social_only: 'annoncé seulement sur un réseau social',
  bar_unconfirmed: 'concert de bar trouvé par Gemini seul',
};

/**
 * The records to set aside: Map(record → reason). `records` are the pipeline's { event } objects;
 * `officeSeen` is the set of records the tourist office announced or confirmed in this run.
 */
function drops(records, { officeSeen = new Set(), officeDown = false } = {}) {
  const recurring = recurringKeys(records.map((r) => r.event));
  const out = new Map();
  for (const r of records) {
    const why = reason(r.event, { recurring, office: officeSeen.has(r), officeDown });
    if (why) out.set(r, why);
  }
  return out;
}

module.exports = { drops, reason, recurringKeys, isMusic, LABELS, OFFICE_HOST_RE };
