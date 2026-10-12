#!/usr/bin/env node
/**
 * Manual check, run by hand from a home connection (item 89, every 15 days): the Gemini-only
 * events of Fontainebleau against the city's own agenda feed.
 *
 * Why by hand: fontainebleau.fr answers HTTP 418 to cloud addresses, GitHub Actions included, and
 * we do not work around it (§3.Z2). From a home connection the same feed answers normally. On
 * 12/10 this comparison found ten Théâtre municipal shows that Gemini had copied from the previous
 * season: none of them was in the 2026-27 season the city publishes.
 *
 * Read-only: one GET of the feed, nothing written. The verdicts are hints for a human — a château
 * or forest event is rarely in the city's feed, so « absent » alone proves nothing. What does:
 * a show at the Théâtre municipal that the city's full season does not list, or the same evening
 * announced with another title.
 *
 *   node scripts/check-city-feed.js            # every Gemini-only event in Fontainebleau
 *   node scripts/check-city-feed.js --all      # also the events another source confirmed
 */

'use strict';

const path = require('path');
const sources = require('./sources');

const FEED = 'https://www.fontainebleau.fr/bouger-et-sortir/agenda-133/flux-rss.xml';
const USER_AGENT = 'Mozilla/5.0 (compatible; FontainebleauEventsBot/2.0)';
const ALL = process.argv.includes('--all');

// « 4 211 km » and « 4211 KM » are one title: a space inside a number goes.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
// Kind-of-event and venue words: « Théâtre : Phèdre » and « PHÈDRE AU THÉÂTRE MUNICIPAL » meet on
// « phedre », not on « theatre ».
const STOP = new Set(('le la les de des du un une et au aux en sur pour par avec dans ou ' +
  'exposition expo concert theatre spectacle piece visite guidee municipal fontainebleau salle ' +
  'musical familial festival soiree danse magie sous chez lors autour ' +
  // Occasion words: the Saint-Sylvestre show of last year shares them with this year's.
  'saint sylvestre reveillon noel halloween').split(' '));
const singular = (w) => (w.length >= 5 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(singular));

function parseFeed(xml) {
  const items = [];
  for (const chunk of xml.split(/<item\b[^>]*>/).slice(1)) {
    const field = (name) => {
      const f = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(chunk);
      return f ? f[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (x, inner) => inner) : '';
    };
    const when = sources.parseCityDateLine((/Date\s*:\s*([^<]*)/.exec(field('description')) || [])[1] || '');
    if (!when) continue;
    items.push({
      title: sources.decodeEntities(field('title')).replace(/\s+/g, ' ').trim(),
      start: when.start,
      end: when.end,
      url: sources.decodeEntities(sources.decodeEntities(field('link'))).trim(),
    });
  }
  return items;
}

async function main() {
  const res = await fetch(FEED, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.error(`Flux de la Ville : HTTP ${res.status}. ${res.status === 418 ? 'Adresse refusée : lancer depuis une connexion domestique, pas depuis un serveur.' : ''}`);
    process.exit(1);
  }
  const items = parseFeed(await res.text());
  const lastInFeed = items.reduce((m, it) => (it.end > m ? it.end : m), '');

  const raw = require(path.join(__dirname, '..', 'data.json'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const events = (Array.isArray(raw) ? raw : raw.events)
    .filter((e) => norm(e.city) === 'fontainebleau' && (e.endDate || e.startDate) >= today && (ALL || !e.source))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const rows = { ok: [], other: [], slot: [], absent: [] };
  for (const e of events) {
    const we = words(e.title);
    const end = e.endDate || e.startDate;
    const line = `${e.startDate}${end !== e.startDate ? `→${end}` : ''} · ${e.id} · ${e.title}${e.locationName ? ` (${e.locationName})` : ''}`;
    const shares = (it) => [...we].filter((w) => words(it.title).has(w));

    // The Théâtre municipal apart: the city publishes its whole season, so only a theatre item of
    // the same dates can confirm — « L'épopée impériale » is not « Les Impériales de Fontainebleau ».
    const theatre = /theatre municipal/.test(norm(`${e.title} ${e.locationName}`)) && !/visite/.test(norm(e.title));
    if (theatre) {
      const near = items.filter((it) => /theatre/.test(norm(it.title)) && it.start <= end && e.startDate <= it.end);
      const match = near.find((it) => shares(it).length);
      const sameDay = near.find((it) => it.start === e.startDate);
      if (match) rows.ok.push(`${line}\n      Ville : ${match.start}${match.end !== match.start ? `→${match.end}` : ''} · ${match.title}`);
      else if (sameDay) rows.slot.push(`${line}\n      Ville, même soir : ${sameDay.title}`);
      else rows.absent.push(`${line}   ← Théâtre municipal, absent de la saison de la Ville : à masquer probablement`);
      continue;
    }

    let best = null, score = 0;
    for (const it of items) {
      const shared = shares(it);
      // One shared word only counts when it is a long one (« fantasmagloria », not « noel »).
      if (!shared.length || (shared.length < 2 && shared[0].length < 6 && !/^\d{3,}$/.test(shared[0]))) continue;
      const s = shared.length / Math.max(1, Math.min(we.size, words(it.title).size));
      if (s > score) { score = s; best = it; }
    }
    if (best && score >= 0.5) {
      const overlap = best.start <= end && e.startDate <= best.end;
      (overlap ? rows.ok : rows.other).push(`${line}\n      Ville : ${best.start}${best.end !== best.start ? `→${best.end}` : ''} · ${best.title}`);
      continue;
    }
    rows.absent.push(line);
  }

  console.log(`Flux de la Ville : ${items.length} événements, jusqu'au ${lastInFeed}. Fiches de Fontainebleau comparées : ${events.length}${ALL ? '' : ' (Gemini seul)'}.\n`);
  const section = (title, list) => { if (list.length) console.log(`${title} (${list.length})\n${list.map((l) => `  - ${l}`).join('\n')}\n`); };
  section('⚠️ Théâtre municipal : la Ville annonce un autre spectacle ce soir-là', rows.slot);
  section('⚠️ Même événement, autres dates (à lire : un rendez-vous mensuel tombe ici aussi)', rows.other);
  section('❓ Absentes du flux (rien de prouvé, sauf au Théâtre municipal)', rows.absent);
  section('✅ Confirmées par la Ville', rows.ok);
  console.log('Masquer : "EVT_…": { "note": "…", "hidden": true } dans overrides.json. Corriger : "fields": { "startDate": … }.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
