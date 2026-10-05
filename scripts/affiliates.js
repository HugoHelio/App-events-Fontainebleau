#!/usr/bin/env node
/**
 * Partner offers (affiliation, monetisation phase 1). Reads the hand-edited affiliates.json and
 * answers, for one event, the "Réserver" link to show next to the organiser's link — or nothing.
 *
 * Rules that are not obvious from the code:
 *   - `booking` is DERIVED, like pageUrl: recomputed by serializeEvent() on every write, never
 *     carried over from the previous data.json. Deactivating an offer removes it everywhere on
 *     the next write, with no stale link left behind.
 *   - The organiser's `url` is never touched. Provenance stays visible (§7, 24/09).
 *   - Never on an event only Gemini announces (no `source`): no revenue on a date nothing we
 *     read confirms. Same rule as the "À ne pas manquer" selection (item 77).
 *   - An offer must match the venue AND the price wording: an entrance ticket is offered on an
 *     exhibition "inclus dans le billet d'entrée", never on a concert sold separately.
 *
 * Zero dependencies.
 *   node scripts/affiliates.js           preview: which events each offer would reach (writes nothing)
 *   node scripts/affiliates.js --write   apply to data.json now, without a (paid) scan
 */
'use strict';

const fs = require('fs');
const path = require('path');

const AFFILIATES_PATH = path.resolve(process.env.AFFILIATES_PATH || 'affiliates.json');

// Sources we read ourselves. Gemini records carry no `source` at all.
const CONFIRMED_SOURCES = new Set(['site', 'datatourisme', 'openagenda']);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function httpUrl(value) {
  try {
    const u = new URL(String(value ?? '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

const words = (list) => (Array.isArray(list) ? list.map(norm).filter(Boolean) : []);

/** Every offer that is well-formed, active or not. A malformed one is skipped, never guessed at. */
function loadOffers(file = AFFILIATES_PATH) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`affiliates.json unreadable: ${err.message}`);
  }
  const out = [];
  for (const o of Array.isArray(raw?.offers) ? raw.offers : []) {
    const url = httpUrl(o.url);
    const match = words(o.match);
    // Without a venue rule an offer would land on every event of the town.
    if (!url || !o.id || !o.label || !o.city || !match.length) continue;
    out.push({
      id: String(o.id),
      provider: String(o.provider || ''),
      label: String(o.label),
      labelEn: o.labelEn ? String(o.labelEn) : undefined,
      city: norm(o.city),
      match,
      price: words(o.price),
      url,
      active: o.active === true,
      // Shown to visitors (« même prix ») only when someone checked it against the official price.
      samePrice: o.samePrice === true,
    });
  }
  return out;
}

let cached = null;
const offers = () => (cached ??= loadOffers());

/** The offer an event qualifies for, active or not (preview), or null. */
function matchOffer(e, list = offers()) {
  if (!CONFIRMED_SOURCES.has(e.source)) return null;
  const city = norm(e.city);
  const venue = norm(e.locationName);
  const price = norm(e.price);
  return list.find((o) => o.city === city
    && o.match.every((w) => venue.includes(w))
    && o.price.every((w) => price.includes(w))) || null;
}

/** The `booking` field for data.json, or undefined. Only active offers are ever published. */
function bookingFor(e, list = offers()) {
  const o = matchOffer(e, list.filter((x) => x.active));
  if (!o) return undefined;
  return { url: o.url, label: o.label, labelEn: o.labelEn, provider: o.provider, samePrice: o.samePrice || undefined, offer: o.id };
}

module.exports = { loadOffers, matchOffer, bookingFor, CONFIRMED_SOURCES };

if (require.main === module) {
  // Required here, not at the top: fetch-events requires this module.
  const { serializeEvent, CONFIG } = require('./fetch-events');
  const write = process.argv.includes('--write');
  const text = fs.readFileSync(CONFIG.dataPath, 'utf8');
  const data = JSON.parse(text);
  const events = Array.isArray(data) ? data : data.events;

  const list = offers();
  for (const o of list) {
    const hits = events.filter((e) => matchOffer(e, [o]));
    console.log(`${o.active ? '✅' : '⏸️ '} ${o.id} (${o.provider}) → ${hits.length} événement(s)${o.active ? '' : ' — inactive, rien de publié'}`);
    for (const e of hits) console.log(`   ${e.id} · ${e.startDate} · ${e.title.slice(0, 70)} · ${e.price}`);
  }
  if (!list.length) console.log('Aucune offre valide dans affiliates.json.');

  if (write) {
    // Same function as the pipeline, so an offline pass and a scan cannot disagree. generatedAt
    // is left alone: no data was collected (decision of 21/09).
    const next = events.map((e) => serializeEvent({ ...e, booking: undefined }));
    let output = JSON.stringify(Array.isArray(data) ? next : { ...data, events: next }, null, 2) + '\n';
    // Keep the checkout's line endings: a Windows clone holds data.json in CRLF.
    if (text.includes('\r\n')) output = output.replace(/\n/g, '\r\n');
    if (output === text) console.log('💾 data.json déjà à jour.');
    else { fs.writeFileSync(CONFIG.dataPath, output); console.log('💾 data.json mis à jour (generatedAt inchangé).'); }
  }
}
