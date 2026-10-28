#!/usr/bin/env node
/**
 * The city's agenda feed, copied from the project lead's computer (item 101, October 28, 2026).
 *
 * fontainebleau.fr answers HTTP 418 to GitHub Actions and normally to a home connection. On 28/10
 * the project lead decided to read it from home until the city grants an exception (72c): 16 of
 * the 22 events missing against fontyblog.fr were in this feed (item 95).
 *
 * Run every day by a Windows scheduled task, it does nothing unless the copy is 14 days old or
 * more — so a computer that was off on the due day catches up the next time it is on. Then:
 *
 *   1. one GET of the feed (robots.txt honoured, the robot's own User-Agent, as in sources.js);
 *   2. the copy goes to city-feed-snapshot.json — { fetchedAt, url, items, xml } — in a clone of
 *      the repository kept for the robot alone, never the working copy someone is editing;
 *   3. commit and push. The pipeline's city-rss reader falls back on it while it is ≤ 35 days old.
 *
 * Nothing here publishes anything by itself: the next scan reads the copy like any other source.
 *
 *   node scripts/snapshot-city-feed.js            # due check, then copy + push
 *   node scripts/snapshot-city-feed.js --force    # copy now
 *   node scripts/snapshot-city-feed.js --dry-run  # fetch and check, write nothing
 *
 * Log: %LOCALAPPDATA%\FontainebleauLive\robot.log (or ROBOT_HOME).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const sources = require('./sources');

const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');
const HOME = process.env.ROBOT_HOME
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'FontainebleauLive');
const CLONE = path.join(HOME, 'robot-repo');
const LOG = path.join(HOME, 'robot.log');
const SNAPSHOT = 'city-feed-snapshot.json';
const DUE_DAYS = 14;
const REMOTE = process.env.ROBOT_REMOTE || 'https://github.com/HugoHelio/App-events-Fontainebleau.git';

fs.mkdirSync(HOME, { recursive: true });
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch { /* the console still has it */ }
};
const git = (...args) => execFileSync('git', args, { cwd: CLONE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function syncClone() {
  if (!fs.existsSync(path.join(CLONE, '.git'))) {
    log(`clone → ${CLONE}`);
    execFileSync('git', ['clone', '--quiet', REMOTE, CLONE], { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  // The clone belongs to the robot: whatever it holds is replaced by the published state.
  git('fetch', '--quiet', 'origin', 'main');
  git('checkout', '--quiet', 'main');
  git('reset', '--quiet', '--hard', 'origin/main');
}

function lastCopyDate() {
  try { return String(JSON.parse(fs.readFileSync(path.join(CLONE, SNAPSHOT), 'utf8')).fetchedAt || '').slice(0, 10); } catch { return ''; }
}

async function fetchFeed(url) {
  const u = new URL(url);
  const robots = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': sources.CONFIG.userAgent }, signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (robots && !sources.robotsAllows(sources.parseRobots(robots), u.pathname + u.search)) throw new Error(`robots.txt disallows ${u.pathname}`);
  const res = await fetch(url, {
    headers: { 'user-agent': sources.CONFIG.userAgent, accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const xml = await res.text();
  const items = (xml.match(/<item\b/g) || []).length;
  // A login page or an error page answered with 200 must not replace a good copy.
  if (!/<rss\b/.test(xml) || items < 10) throw new Error(`not the agenda feed (${items} item(s))`);
  return { xml, items };
}

async function main() {
  const src = sources.loadRegistry().find((s) => s.type === 'city-rss');
  if (!src) throw new Error('no city-rss source in sources.json');
  syncClone();

  const today = new Date().toISOString().slice(0, 10);
  const last = lastCopyDate();
  const age = last ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000) : Infinity;
  if (!FORCE && age < DUE_DAYS) { log(`copie du ${last} (${age} j) : rien à faire avant ${DUE_DAYS} j`); return; }

  const { xml, items } = await fetchFeed(src.url);
  log(`flux lu : ${items} événement(s), ${Math.round(xml.length / 1024)} Ko`);
  if (DRY) { log('--dry-run : rien écrit'); return; }

  const body = { fetchedAt: new Date().toISOString(), url: src.url, items, xml };
  fs.writeFileSync(path.join(CLONE, SNAPSHOT), JSON.stringify(body) + '\n');
  git('add', SNAPSHOT);
  git('-c', 'user.name=Fontainebleau Live (robot local)', '-c', 'user.email=robot@fontainebleaulive.fr',
    'commit', '--quiet', '-m', `🤖 Agenda de la Ville : copie du ${today} (${items} événements, item 101)`);
  // The GitHub bot pushes too: on a rejected push, rebase on its commit and try again.
  for (let attempt = 1; ; attempt++) {
    try { git('push', '--quiet', 'origin', 'main'); break; } catch (err) {
      if (attempt >= 3) throw err;
      log(`push refusé, nouvel essai (${attempt})`);
      git('pull', '--quiet', '--rebase', 'origin', 'main');
    }
  }
  log(`copie poussée (${items} événements)`);
}

main().catch((err) => {
  log(`❌ ${String(err && (err.stderr || err.message) || err).trim().slice(0, 400)}`);
  process.exitCode = 1;
});
