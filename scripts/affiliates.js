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
 *     One exception, per offer (07/10, Vaux-le-Vicomte): `officialHosts`. A Gemini record whose
 *     link is an event page (not the home page) on the venue's own site, checked alive, carries
 *     the venue's word for its dates. A home page never counts: the fiche would also say
 *     « Dates à confirmer » (79b), and a « Réserver » button next to it would contradict it.
 *   - An offer must match the venue AND the price wording: an entrance ticket is offered on an
 *     exhibition "inclus dans le billet d'entrée", never on a concert sold separately.
 *   - Places (item 83c) are the other kind: a monument's entrance ticket, shown in a "Visiter"
 *     block that depends on no event, so no source rule applies. What keeps them true is the
 *     season (`from`/`to`) and the exceptional closures (`closed`), checked on the official site.
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

// Same rule as isHome() in fetch-events.js and isHomeUrl() in generate-pages.js (79b).
const isHome = (u) => { try { return ['', '/'].includes(new URL(u).pathname.replace(/\/(fr|en)\/?$/, '/')); } catch { return false; } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

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
      officialHosts: (Array.isArray(o.officialHosts) ? o.officialHosts : []).map((h) => String(h).replace(/^www\./, '').toLowerCase()).filter(Boolean),
    });
  }
  return out;
}

let cached = null;
const offers = () => (cached ??= loadOffers());

const isIso = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Every well-formed place (item 83c), active or not. Same rule: malformed is skipped. */
function loadPlaces(file = AFFILIATES_PATH) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`affiliates.json unreadable: ${err.message}`);
  }
  const out = [];
  for (const p of Array.isArray(raw?.places) ? raw.places : []) {
    const url = httpUrl(p.url);
    if (!url || !p.id || !p.name || !p.city || !p.label) continue;
    out.push({
      id: String(p.id),
      provider: String(p.provider || ''),
      name: String(p.name),
      city: String(p.city),
      blurb: p.blurb ? String(p.blurb) : '',
      blurbEn: p.blurbEn ? String(p.blurbEn) : '',
      label: String(p.label),
      labelEn: p.labelEn ? String(p.labelEn) : '',
      // Shown only next to « même prix », i.e. when someone checked it.
      price: p.samePrice === true && p.price ? String(p.price) : '',
      url,
      // Open season, inclusive; either end may be left out (open all year).
      from: isIso(p.from) ? p.from : '',
      to: isIso(p.to) ? p.to : '',
      closed: (Array.isArray(p.closed) ? p.closed : []).filter(isIso).sort(),
      closedNote: p.closedNote ? String(p.closedNote) : '',
      closedNoteEn: p.closedNoteEn ? String(p.closedNoteEn) : '',
      active: p.active === true,
      samePrice: p.samePrice === true,
    });
  }
  return out;
}

/**
 * Active places open on at least one day of [from, to] (ISO, inclusive), optionally in one town.
 * Each carries `closedIn`: its exceptional closures within the period, for the page to say so.
 * A place closed on every day of the period is left out.
 */
function placesOpen(list, from, to, city = null) {
  const days = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)) days.push(d);
  return list
    .filter((p) => p.active && (!city || norm(p.city) === norm(city)))
    .map((p) => ({ ...p, closedIn: p.closed.filter((d) => d >= from && d <= to) }))
    .filter((p) => days.some((d) => (!p.from || d >= p.from) && (!p.to || d <= p.to) && !p.closed.includes(d)));
}

/** The offer an event qualifies for, active or not (preview), or null. */
function matchOffer(e, list = offers()) {
  const confirmed = CONFIRMED_SOURCES.has(e.source);
  const official = (o) => o.officialHosts.includes(hostOf(e.url)) && !isHome(e.url) && e.urlStatus === 'ok';
  const city = norm(e.city);
  const venue = norm(e.locationName);
  const price = norm(e.price);
  return list.find((o) => (confirmed || official(o))
    && o.city === city
    && o.match.every((w) => venue.includes(w))
    && o.price.every((w) => price.includes(w))) || null;
}

/** The `booking` field for data.json, or undefined. Only active offers are ever published. */
function bookingFor(e, list = offers()) {
  const o = matchOffer(e, list.filter((x) => x.active));
  if (!o) return undefined;
  return { url: o.url, label: o.label, labelEn: o.labelEn, provider: o.provider, samePrice: o.samePrice || undefined, offer: o.id };
}

module.exports = { loadOffers, matchOffer, bookingFor, loadPlaces, placesOpen, CONFIRMED_SOURCES };

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
  // Places live on the generated pages only: generate-pages.js reads them, data.json never does.
  for (const p of loadPlaces()) {
    const season = p.from || p.to ? `ouvert ${p.from ? `du ${p.from} ` : ''}${p.to ? `au ${p.to}` : ''}`.trim() : 'toute l’année';
    console.log(`${p.active ? '✅' : '⏸️ '} ${p.id} (${p.provider}) → bloc « Visiter » · ${p.name}, ${p.city} · ${season}${p.closed.length ? ` · fermé ${p.closed.join(', ')}` : ''}${p.active ? '' : ' — inactif'}`);
  }

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
