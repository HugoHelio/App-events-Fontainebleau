'use strict';
// Group game of Fontainebleau Live Collection (item 116o, 23/11; GDD §12.2), without a server.
// The organiser gets a session code (FLC-GRP-…, from the Stripe payment or sent by hand after an
// e-mail booking) and sends the teams a link. Each team plays on one phone: the quest's steps in
// order, a stopwatch, points on the spot and for the answers, Invaders as a bonus. At the finish
// the team sends its result as a link (?resultat=…); opening it on the organiser's phone adds it
// to the ranking and the recap. Nothing is sent by the game itself: no server, no position.
//
// Injected into the page's client (scripts/live-collection-page.js) inside the same closure: it
// uses el, $, t, tr, S, SHOP, SHOP_OPEN, st, map, L, me, dist, nearEnough, startGeo, sheet, header,
// closeSheet, tab, toast, track, quest, ico, spotById, INVADERS, RADIUS, XP, gain, checkSets, draw,
// fmtDist, renderShop, renderQuests, LANG. Same rules: textContent only, links built from fixed parts.

const GROUP_STYLE = `
.gbar{background:var(--ink);color:#fff;justify-content:space-between}.gbar[hidden]{display:none}.gbar b{color:var(--accent)}.gbar span{font-variant-numeric:tabular-nums}
.gpin{width:36px;height:36px;border-radius:50%;background:var(--gold);color:#fff;font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 0 0 7px rgba(227,165,26,.35),0 2px 6px rgba(0,0,0,.4)}
.gstat{font-weight:700;color:var(--ink);background:#f3f6ee;border-radius:10px;padding:6px 10px;margin:10px 0 0;font-variant-numeric:tabular-nums}
.gplace{margin:2px 0 0;font-size:19px;color:var(--ink)}
.grules{margin:6px 0 12px;padding-left:1.2em;font-size:14px}
.gname{width:100%;font:inherit;padding:12px;border:1.5px solid var(--line);border-radius:12px;margin-bottom:10px;box-sizing:border-box}
.gscore{text-align:center;margin:14px 0}.gscore b{display:block;font-size:34px;color:var(--ink)}.gscore span{color:var(--muted);font-size:14px}
.grow{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.grank{width:28px;height:28px;border-radius:50%;background:#eef0ec;display:flex;align-items:center;justify-content:center;font-weight:800;flex:none}
.grank.r1{background:#e3a51a;color:#fff}.grank.r2{background:#b9bec4;color:#fff}.grank.r3{background:#c98a5a;color:#fff}
.gtx{flex:1;min-width:0}.gtx b{display:block}.gtx small{color:var(--muted);font-size:12px}.gpts{font-weight:800;color:var(--ink);white-space:nowrap}
.glims{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.gl{font:inherit;font-size:13px;border:1.5px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;cursor:pointer;color:var(--ink)}
.gl[aria-pressed="true"]{border-color:var(--ink);background:var(--ink);color:#fff}
.ghl{background:#f7f4ea;border-radius:10px;padding:8px 12px;font-size:14px;margin:6px 0}
.gpt.soon{font-style:italic;color:var(--muted)}
a.tier{text-decoration:none;color:inherit;border-color:var(--ink)}a.tier em{display:block;font-style:normal;font-weight:700;color:var(--ink);font-size:12px;margin-top:2px}
.gjoin{margin-top:8px}
.btn.wa{background:#1f7a4d}
`;

const GROUP_CLIENT = String.raw`
  // ── Group game (116o, 23/11): serverless, see scripts/live-collection-group.js ──
  (function (o) { for (var k in o) S[k] = o[k]; })({
    gChip: ['Partie de groupe', 'Group game'], gCardH: ['Partie de groupe', 'Group game'],
    gCardTxt: ['Une quête en équipes, avec le code donné par l’organisateur.', 'A team quest, with the code from the organiser.'],
    gRules0: ['{0} étapes à trouver dans l’ordre, en équipe, un téléphone par équipe.', '{0} stops to find in order, as a team, one phone per team.'],
    gLim: [' Durée limite : {0}.', ' Time limit: {0}.'],
    gR1: ['Sur place (GPS) : +{0} pts', 'On the spot (GPS): +{0} pts'],
    gR2: ['Bonne réponse : +{0} pts, ou +{1} au 2ᵉ essai', 'Right answer: +{0} pts, or +{1} at the 2nd try'],
    gR3: ['Chaque mosaïque d’Invader trouvée en route : +{0} pts', 'Each Invader mosaic found on the way: +{0} pts'],
    gR4: ['À égalité de points, l’équipe la plus rapide gagne', 'On equal points, the fastest team wins'],
    gNamePh: ['Nom de votre équipe', 'Your team’s name'], gNameNeed: ['Donnez un nom à votre équipe', 'Give your team a name'],
    gGo: ['Départ !', 'Go!'], gStep: ['Étape {0} sur {1}', 'Stop {0} of {1}'], gAway: ['À {0}', '{0} away'],
    gHere: ['Nous y sommes', 'We are here'], gShow: ['Voir sur la carte', 'Show on the map'],
    gNoGps: ['Pas de GPS ? Répondre sans les points du lieu', 'No GPS? Answer without the on-the-spot points'],
    gSkip: ['Passer cette étape (0 pt)', 'Skip this stop (0 pt)'], gSkipQ: ['Passer cette étape sans points ?', 'Skip this stop with no points?'],
    gAgain: ['Raté. Encore un essai, pour {0} pts.', 'Wrong. One more try, for {0} pts.'], gAnswer: ['Raté. La réponse : {0}.', 'Wrong. The answer: {0}.'],
    gInvH: ['Bonus : les mosaïques d’Invader, +{0} pts chacune', 'Bonus: the Invader mosaics, +{0} pts each'],
    gStop: ['Terminer la partie maintenant', 'End the game now'], gStopQ: ['Terminer la partie ? Votre score sera figé.', 'End the game? Your score will be final.'],
    gEndDone: ['Bravo, toutes les étapes sont faites !', 'Well done, every stop is done!'], gEndTime: ['Temps écoulé : la partie est terminée.', 'Time is up: the game is over.'], gEndStop: ['Partie terminée.', 'Game over.'],
    gStepsN: ['{0}/{1} étapes', '{0}/{1} stops'],
    gSendTxt: ['Envoyez votre résultat à l’organisateur : il ouvre le lien, et votre équipe entre au classement.', 'Send your result to the organiser: they open the link, and your team joins the ranking.'],
    gSend: ['Envoyer le résultat à l’organisateur', 'Send the result to the organiser'], gShareRes: ['Résultat de l’équipe {0} : {1} pts', 'Team {0}: {1} pts'],
    gMine: ['Voir le classement sur ce téléphone', 'See the ranking on this phone'],
    gQuit: ['Quitter la partie', 'Leave the game'], gQuitQ: ['Quitter la partie ? Le résultat ne sera plus sur ce téléphone.', 'Leave the game? The result will no longer be on this phone.'],
    gReplace: ['Une partie est en cours sur ce téléphone. La remplacer ?', 'A game is running on this phone. Replace it?'],
    gBarEnd: ['Partie terminée : envoyez le résultat', 'Game over: send your result'], gBarReady: ['Partie de groupe : nommez votre équipe', 'Group game: name your team'],
    gBoardChip: ['Classement', 'Ranking'], gBoardH: ['Classement de la partie', 'Game ranking'], gMyH: ['Votre partie de groupe', 'Your group game'],
    gBoardEmpty: ['Aucun résultat reçu pour l’instant.', 'No result received yet.'],
    gInvN: ['Invaders : {0}', 'Invaders: {0}'], gTimeUp: ['temps écoulé', 'time up'], gStopped: ['arrêtée', 'stopped'],
    gFast: ['Étape la plus vite bouclée : {0}, par {1}, en {2}', 'Fastest stop: {0}, by {1}, in {2}'],
    gHard: ['Question la plus difficile : {0}, {1} équipe(s) sur {2} se sont trompées', 'Hardest question: {0}, {1} team(s) out of {2} got it wrong'],
    gMostInv: ['Le plus d’Invaders : {0} ({1})', 'Most Invaders: {0} ({1})'],
    gShareBoard: ['Partager le classement', 'Share the ranking'],
    gOrg1: ['1. Durée limite', '1. Time limit'], gNoLim: ['Sans limite', 'No limit'],
    gOrg2: ['2. Invitez les équipes', '2. Invite the teams'],
    gOrg2Txt: ['Un téléphone par équipe. Envoyez ce lien aux équipes (WhatsApp, SMS…) : il ouvre la partie.', 'One phone per team. Send this link to the teams (WhatsApp, text…): it opens the game.'],
    gInvite: ['Envoyer le lien aux équipes', 'Send the link to the teams'], gShareJoin: ['Rejoignez la partie « {0} » de Fontainebleau Live Collection', 'Join the “{0}” game of Fontainebleau Live Collection'],
    gCodeIs: ['Ou le code à saisir dans Quêtes : ', 'Or the code to type in Quests: '],
    gPlayToo: ['Jouer aussi avec une équipe sur ce téléphone', 'Play with a team on this phone too'],
    gOrg3: ['3. Les résultats', '3. The results'],
    gOrg3Txt: ['À la fin, chaque équipe vous envoie son résultat. Ouvrez chaque lien sur ce téléphone : le classement se remplit.', 'At the end, each team sends you its result. Open each link on this phone: the ranking fills up.'],
    gCopied: ['Lien copié', 'Link copied'], gSeeRes: ['Voir notre résultat', 'See our result'], gResume: ['Reprendre la partie', 'Back to the game'], gReady: ['Commencer la partie', 'Start the game'],
    gMyGame: ['Ma partie de groupe (organisateur)', 'My group game (organiser)'], gJoin: ['Rejoindre', 'Join'], gOrganise: ['Organiser une sortie de groupe', 'Organise a group outing'],
    gGot: ['Résultat reçu : {0}', 'Result received: {0}'], gBadRes: ['Ce lien de résultat n’est pas lisible.', 'This result link cannot be read.'],
    gSoon: ['Bientôt en partie de groupe', 'Group play coming soon'], gPay: ['Payer', 'Pay'],
    gWa: ['Envoyer sur WhatsApp', 'Send on WhatsApp'], gSms: ['Envoyer par SMS', 'Send by text message'], gOther: ['Autre application…', 'Another app…'],
    gToOrg: ['Le message est prêt, adressé à l’organisateur : il ne reste qu’à l’envoyer.', 'The message is ready, addressed to the organiser: just send it.'],
    gMsg: ['Fontainebleau Live Collection : l’équipe {0} finit avec {1} pts en {2}. Ouvrez ce lien pour l’ajouter au classement : {3}', 'Fontainebleau Live Collection: team {0} finishes with {1} pts in {2}. Open this link to add it to the ranking: {3}'],
    gTel: ['Votre numéro de téléphone (facultatif)', 'Your phone number (optional)'],
    gTelTxt: ['Avec lui, chaque équipe vous envoie son résultat sur WhatsApp ou par SMS en un geste. Il voyage seulement dans le lien que vous envoyez aux équipes.', 'With it, each team sends you its result on WhatsApp or by text in one tap. It only travels in the link you send to the teams.'],
    gTelOk: ['Numéro enregistré', 'Number saved'], gTelBad: ['Ce numéro n’est pas reconnu', 'This number is not recognised'], gTelSave: ['Enregistrer', 'Save']
  });
  var GKEY = 'fl-collection-groupe-v1', GCODE = /^FLC-GRP-[A-Z0-9]{8}$/;
  var GP = { first: 100, second: 50, arrive: 20, noQ: 100, inv: 30 };
  var LIMITS = [0, 90, 120, 150, 180];
  var G = (function () { try { var x = JSON.parse(localStorage.getItem(GKEY)); return x && typeof x === 'object' ? x : {}; } catch (e) { return {}; } })();
  if (!G.boards || typeof G.boards !== 'object') G.boards = {};
  function gsave() { try { localStorage.setItem(GKEY, JSON.stringify(G)); } catch (e) {} }
  function playable() { return SHOP.groups.filter(function (q) { return q.play && q.steps.length; }); }
  function gq(id) { return playable().filter(function (q) { return q.id === id; })[0]; }
  function team() { var T = G.team; return T && GCODE.test(T.code) && gq(T.q) && Array.isArray(T.done) ? T : null; }
  function running() { var T = team(); return T && T.start && !T.endAt ? T : null; }
  function points(T) { return T.done.reduce(function (s, x) { return s + x.p; }, 0) + Object.keys(T.inv || {}).length * GP.inv; }
  function secs(T) { return Math.max(0, Math.round(((T.endAt || Date.now()) - T.start) / 1000)); }
  function clock(s) { var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function clockMin(m) { return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) : ''); }
  function gstat(T) { return clock(secs(T)) + (T.lim ? ' / ' + clockMin(T.lim) : '') + ' · ' + points(T) + ' pts'; }
  function b64e(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { try { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } }
  function joinUrl(o) { return location.origin + '/jeu/?partie=' + o.code + '&q=' + o.q + (o.lim ? '&lim=' + o.lim : '') + (o.tel ? '&tel=' + o.tel : ''); }
  // A phone number in international digits (33612345678); a French 06… is accepted and converted
  function telOf(s) {
    var d = String(s || '').replace(/[\s.\-()]/g, '');
    if (/^0[1-9][0-9]{8}$/.test(d)) d = '33' + d.slice(1);
    d = d.replace(/^\+|^00/, '');
    return /^[1-9][0-9]{7,14}$/.test(d) ? d : '';
  }
  function copyText(s, okMsg) { try { navigator.clipboard.writeText(s).then(function () { toast(okMsg); }, function () { window.prompt('', s); }); } catch (e) { window.prompt('', s); } }
  function shareLink(url, text, ev) {
    track(ev);
    if (navigator.share) { navigator.share({ title: 'Fontainebleau Live Collection', text: text, url: url }).catch(function () {}); return; }
    copyText(url, t('gCopied'));
  }
  function gbtn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }

  // ── A team ──
  function gJoin(code, q, lim, tel) {
    var T = team();
    // The same invitation opened again (even after the finish) goes back to this team, never resets it
    if (T && T.code === code) { if (tel) { T.tel = telOf(tel); gsave(); } tab('map'); openTeam(); return; }
    if (running() && !window.confirm(t('gReplace'))) return;
    G.team = { code: code, q: q, lim: lim, tel: telOf(tel), name: '', id: Math.random().toString(36).slice(2, 10), start: 0, endAt: 0, why: '', done: [], inv: {}, cur: {} };
    gsave(); track('groupe/join'); tab('map'); groupBar(); renderQuests(); openTeam();
  }
  function openTeam() {
    var T = team(); if (!T) return;
    var Q = gq(T.q);
    sheet.textContent = '';
    sheet.appendChild(header(Q.color, Q.icon, t('gChip'), Q.color));
    var b = el('div', 'body'); sheet.appendChild(b);
    b.appendChild(el('h2', null, tr(Q.name)));
    if (!T.start) {
      b.appendChild(el('p', 'meta', t('gRules0', Q.steps.length) + (T.lim ? t('gLim', clockMin(T.lim)) : '')));
      var ul = el('ul', 'grules');
      [t('gR1', GP.arrive), t('gR2', GP.first, GP.second), t('gR3', GP.inv), t('gR4')].forEach(function (x) { ul.appendChild(el('li', null, x)); });
      b.appendChild(ul);
      var inp = el('input', 'gname'); inp.maxLength = 24; inp.placeholder = t('gNamePh'); inp.value = T.name || ''; b.appendChild(inp);
      b.appendChild(gbtn('btn wide', t('gGo'), function () {
        var n = inp.value.replace(/\s+/g, ' ').trim().slice(0, 24);
        if (!n) { toast(t('gNameNeed')); inp.focus(); return; }
        T.name = n; T.start = Date.now(); gsave(); track('groupe/start'); startGeo(); groupDraw(); groupBar(); renderQuests(); openTeam();
      }));
    } else if (!T.endAt) stepView(b, T, Q);
    else resultView(b, T, Q);
    sheet.classList.add('on'); sheet.scrollTop = 0;
  }
  function stepView(b, T, Q) {
    var i = T.done.length, p = spotById(Q.steps[i]), cur = T.cur || (T.cur = {});
    var hd = el('p', 'gstat', gstat(T)); hd.id = 'gstat'; b.appendChild(hd);
    b.appendChild(el('p', 'sh4', t('gStep', i + 1, Q.steps.length)));
    b.appendChild(el('h3', 'gplace', p.name));
    if (me) b.appendChild(el('p', 'meta', t('gAway', fmtDist(dist(me, p)))));
    var acts = el('div', 'acts'); b.appendChild(acts);
    if (!cur.g) {
      acts.appendChild(gbtn('btn', t('gHere'), function () {
        nearEnough(p, RADIUS.ville, function () {
          cur.g = 1; gsave(); toast('+' + GP.arrive + ' pts');
          // The same arrival collects the place in the solo game: the two games stay one
          if (!st.spots[p.id]) { st.spots[p.id] = 'gps'; save(); track('spot-unlock/' + p.id); gain(XP[p.rarity], p.name); checkSets(); draw(); }
          if (!p.q) finishStep(T, Q, GP.arrive + GP.noQ); else openTeam();
        });
      }));
      acts.appendChild(gbtn('btn soft', t('gShow'), function () { closeSheet(); map.setView([p.lat, p.lng], 17); }));
    }
    if (p.q && (cur.g || cur.free)) gQuestion(acts, T, Q, p);
    else if (p.q) acts.appendChild(gbtn('linkbtn', t('gNoGps'), function () { cur.free = 1; gsave(); openTeam(); }));
    else acts.appendChild(gbtn('linkbtn', t('gSkip'), function () { if (window.confirm(t('gSkipQ'))) finishStep(T, Q, 0); }));
    invBonus(b, T);
    b.appendChild(gbtn('linkbtn', t('gStop'), function () { if (window.confirm(t('gStopQ'))) endTeam(T, 'stop'); }));
  }
  // Two tries: the first right answer is worth GP.first, the second GP.second; then the answer is shown
  function gQuestion(root, T, Q, p) {
    var cur = T.cur, q = el('div', 'q'), ch = p.q.c[LANG] || p.q.c.fr, wrong = cur.w || [];
    q.appendChild(el('p', 'qtext', tr(p.q)));
    var msg = el('p', 'qmsg');
    function lock() { Array.prototype.forEach.call(q.querySelectorAll('button'), function (x) { x.onclick = null; }); }
    ch.forEach(function (c, i) {
      var cb = el('button', 'btn alt', c); cb.type = 'button';
      if (wrong.indexOf(i) >= 0) { cb.disabled = true; cb.classList.add('wrong'); cb.textContent = '✗ ' + c; }
      cb.onclick = function () {
        var base = cur.g ? GP.arrive : 0;
        if (i === p.q.a) {
          lock(); cb.classList.add('right'); cb.textContent = '✓ ' + c; msg.className = 'qmsg ok'; msg.textContent = t('right');
          setTimeout(function () { finishStep(T, Q, base + (cur.n ? GP.second : GP.first)); }, 700);
        } else {
          cur.n = (cur.n || 0) + 1; wrong.push(i); cur.w = wrong; gsave();
          cb.disabled = true; cb.classList.add('wrong'); cb.textContent = '✗ ' + c; msg.className = 'qmsg ko';
          if (cur.n >= 2) { lock(); msg.textContent = t('gAnswer', ch[p.q.a]); setTimeout(function () { finishStep(T, Q, base); }, 2000); }
          else msg.textContent = t('gAgain', GP.second);
        }
      };
      q.appendChild(cb);
    });
    q.appendChild(msg); root.appendChild(q);
  }
  function invBonus(b, T) {
    if (!INVADERS.length) return;
    T.inv = T.inv || {};
    b.appendChild(el('p', 'sh4', t('gInvH', GP.inv)));
    var list = el('div', 'fsteps');
    INVADERS.forEach(function (v) {
      var got = T.inv[v.id], r = el('button', 'fstep' + (got ? ' done' : '')); r.type = 'button';
      var c = el('span', 'fdot'); c.appendChild(ico(got ? 'check' : 'invader')); r.appendChild(c);
      var tx = el('span', 'ftx'); tx.appendChild(el('b', null, v.name)); tx.appendChild(el('small', null, got ? '+' + GP.inv + ' pts' : v.street)); r.appendChild(tx);
      if (!got) r.onclick = function () { nearEnough(v, RADIUS.invader, function () { T.inv[v.id] = 1; gsave(); track('groupe/invader'); toast('+' + GP.inv + ' pts · ' + v.name); groupBar(); openTeam(); }); };
      list.appendChild(r);
    });
    b.appendChild(list);
  }
  function finishStep(T, Q, pts) {
    if (T.endAt) return;
    var p = spotById(Q.steps[T.done.length]), cur = T.cur || {};
    T.done.push({ s: secs(T), p: pts, n: cur.n || 0, g: cur.g ? 1 : 0, q: p && p.q ? 1 : 0 });
    T.cur = {}; gsave(); track('groupe/step/' + T.done.length);
    if (T.done.length >= Q.steps.length) endTeam(T, 'done');
    else { groupDraw(); groupBar(); openTeam(); }
  }
  function endTeam(T, why, at) {
    if (T.endAt) return;
    T.endAt = at || Date.now(); T.why = why; gsave(); track('groupe/end/' + why);
    groupDraw(); groupBar(); renderQuests(); openTeam();
  }
  function result(T) {
    return { v: 1, c: T.code, q: T.q, k: T.id, n: T.name, p: points(T), s: secs(T), e: T.why, i: Object.keys(T.inv || {}).length,
      d: T.done.map(function (x) { return [x.s, x.p, x.n, x.g, x.q]; }) };
  }
  function resultView(b, T, Q) {
    var r = result(T);
    b.appendChild(el('div', 'got-banner', t(T.why === 'done' ? 'gEndDone' : T.why === 'time' ? 'gEndTime' : 'gEndStop')));
    var big = el('div', 'gscore'); big.appendChild(el('b', null, r.p + ' pts'));
    big.appendChild(el('span', null, T.name + ' · ' + clock(r.s) + ' · ' + t('gStepsN', T.done.length, Q.steps.length))); b.appendChild(big);
    // The message is written here, link included: WhatsApp or the SMS app opens with it, addressed to
    // the organiser when their number came with the invitation. Sending stays the team's own tap.
    var url = location.origin + '/jeu/?resultat=' + b64e(r), msg = t('gMsg', T.name, r.p, clock(r.s), url), tel = telOf(T.tel);
    b.appendChild(el('p', null, tel ? t('gToOrg') : t('gSendTxt')));
    var acts = el('div', 'acts'); b.appendChild(acts);
    var wa = link(t('gWa'), 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), 'btn wa'); wa.addEventListener('click', function () { track('groupe/send/whatsapp'); }); acts.appendChild(wa);
    var sms = el('a', 'btn alt', t('gSms')); sms.href = 'sms:' + (tel ? '+' + tel : '') + '?&body=' + encodeURIComponent(msg); sms.addEventListener('click', function () { track('groupe/send/sms'); }); acts.appendChild(sms);
    if (navigator.share) acts.appendChild(gbtn('linkbtn', t('gOther'), function () { track('groupe/send/share'); navigator.share({ text: msg }).catch(function () {}); }));
    acts.appendChild(gbtn('btn soft', t('gMine'), function () { addResult(r); openBoard(r.c); }));
    b.appendChild(gbtn('linkbtn', t('gQuit'), function () {
      if (!window.confirm(t('gQuitQ'))) return;
      G.team = null; gsave(); closeSheet(); groupDraw(); groupBar(); renderQuests();
    }));
  }

  // ── The organiser: invitations, results, ranking ──
  function okResult(r) {
    if (!r || r.v !== 1 || !GCODE.test(r.c) || !gq(r.q) || typeof r.n !== 'string' || !r.n.trim() || typeof r.k !== 'string' || !/^[a-z0-9]{1,12}$/.test(r.k)) return null;
    var Q = gq(r.q), d = Array.isArray(r.d) ? r.d.slice(0, Q.steps.length) : [];
    var num = function (y) { return typeof y === 'number' && isFinite(y) && y >= 0 && y <= 86400; };
    if (!d.every(function (x) { return Array.isArray(x) && x.length === 5 && x.every(num); })) return null;
    return { v: 1, c: r.c, q: r.q, k: r.k, n: r.n.replace(/\s+/g, ' ').trim().slice(0, 24), p: Math.min(Math.max(+r.p || 0, 0), 5000), s: Math.min(Math.max(+r.s || 0, 0), 86400),
      e: ['done', 'time', 'stop'].indexOf(r.e) >= 0 ? r.e : 'stop', i: Math.min(Math.max(+r.i || 0, 0), 50), d: d };
  }
  function addResult(r) { var B = G.boards[r.c] || (G.boards[r.c] = { q: r.q, res: {} }); B.res[r.k] = r; gsave(); }
  function setOrg(code) {
    if (!G.org || G.org.code !== code) G.org = { code: code, q: playable()[0].id, lim: 0 };
    if (!G.boards[code]) G.boards[code] = { q: G.org.q, res: {} };
    gsave();
  }
  function ranking(code) {
    var B = G.boards[code], list = B ? Object.keys(B.res).map(function (k) { return B.res[k]; }) : [];
    return list.sort(function (a, b) { return b.p - a.p || a.s - b.s; });
  }
  function highlights(list, Q) {
    var out = [], best = null, hard = null;
    list.forEach(function (r) { r.d.forEach(function (x, i) { if (!i) return; var dt = x[0] - r.d[i - 1][0]; if (!best || dt < best.dt) best = { dt: dt, i: i, n: r.n }; }); });
    if (best) out.push(t('gFast', spotById(Q.steps[best.i]).name, best.n, clock(best.dt)));
    Q.steps.forEach(function (id, i) {
      var tot = 0, ko = 0;
      list.forEach(function (r) { var x = r.d[i]; if (x && x[4]) { tot++; if (x[2] > 0) ko++; } });
      if (ko && (!hard || ko / tot > hard.ko / hard.tot)) hard = { i: i, ko: ko, tot: tot };
    });
    if (hard) out.push(t('gHard', spotById(Q.steps[hard.i]).name, hard.ko, hard.tot));
    var inv = list.slice().sort(function (a, b) { return b.i - a.i; })[0];
    if (inv && inv.i) out.push(t('gMostInv', inv.n, inv.i));
    return out;
  }
  function openBoard(code) {
    var B = G.boards[code], org = G.org && G.org.code === code ? G.org : null;
    var Q = gq((B && B.q) || (org && org.q)) || playable()[0];
    sheet.textContent = '';
    sheet.appendChild(header(Q.color, 'team', t('gBoardChip'), Q.color));
    var b = el('div', 'body'); sheet.appendChild(b);
    b.appendChild(el('h2', null, org ? t('gMyH') : t('gBoardH')));
    b.appendChild(el('p', 'meta', tr(Q.name) + ' · ' + code));
    if (org) {
      b.appendChild(el('p', 'sh4', t('gOrg1')));
      var lims = el('div', 'glims');
      LIMITS.forEach(function (m) { var x = gbtn('gl', m ? clockMin(m) : t('gNoLim'), function () { org.lim = m; gsave(); openBoard(code); }); x.setAttribute('aria-pressed', org.lim === m); lims.appendChild(x); });
      b.appendChild(lims);
      b.appendChild(el('p', 'sh4', t('gTel')));
      var ti = el('div', 'codein'), tin = el('input'); tin.type = 'tel'; tin.placeholder = '06 12 34 56 78'; tin.style.textTransform = 'none';
      if (org.tel) tin.value = '+' + org.tel;
      ti.appendChild(tin);
      ti.appendChild(gbtn('btn', t('gTelSave'), function () {
        var v = tin.value.trim(), d = telOf(v);
        if (v && !d) { toast(t('gTelBad')); return; }
        org.tel = d; gsave(); toast(t('gTelOk')); openBoard(code);
      }));
      b.appendChild(ti); b.appendChild(el('p', 'small', t('gTelTxt')));
      b.appendChild(el('p', 'sh4', t('gOrg2')));
      b.appendChild(el('p', 'small', t('gOrg2Txt')));
      var a1 = el('div', 'acts'); b.appendChild(a1);
      a1.appendChild(gbtn('btn', t('gInvite'), function () { shareLink(joinUrl(org), t('gShareJoin', tr(Q.name)), 'groupe/invite'); }));
      var cd = el('p', 'small', t('gCodeIs')); cd.appendChild(el('b', null, code)); a1.appendChild(cd);
      a1.appendChild(gbtn('btn soft', t('gPlayToo'), function () { gJoin(code, org.q, org.lim, org.tel); }));
      b.appendChild(el('p', 'sh4', t('gOrg3')));
      b.appendChild(el('p', 'small', t('gOrg3Txt')));
    }
    var list = ranking(code);
    if (!list.length) b.appendChild(el('p', 'meta', t('gBoardEmpty')));
    list.forEach(function (r, i) {
      var row = el('div', 'grow'), rk = el('span', 'grank' + (i < 3 ? ' r' + (i + 1) : ''), String(i + 1)); row.appendChild(rk);
      var tx = el('span', 'gtx'); tx.appendChild(el('b', null, r.n));
      tx.appendChild(el('small', null, clock(r.s) + ' · ' + t('gStepsN', r.d.length, Q.steps.length) + (r.i ? ' · ' + t('gInvN', r.i) : '') + (r.e === 'time' ? ' · ' + t('gTimeUp') : r.e === 'stop' ? ' · ' + t('gStopped') : '')));
      row.appendChild(tx); row.appendChild(el('span', 'gpts', r.p + ' pts')); b.appendChild(row);
    });
    var hl = list.length ? highlights(list, Q) : [];
    hl.forEach(function (x) { b.appendChild(el('p', 'ghl', x)); });
    if (list.length) {
      var a2 = el('div', 'acts'); b.appendChild(a2);
      a2.appendChild(gbtn('btn soft', t('gShareBoard'), function () {
        var txt = tr(Q.name) + String.fromCharCode(10) + list.map(function (r, i) { return (i + 1) + '. ' + r.n + ' : ' + r.p + ' pts (' + clock(r.s) + ')'; }).join(String.fromCharCode(10)) + (hl.length ? String.fromCharCode(10) + hl.join(String.fromCharCode(10)) : '');
        track('groupe/share-board');
        if (navigator.share) navigator.share({ title: t('gBoardH'), text: txt }).catch(function () {}); else copyText(txt, t('gCopied'));
      }));
    }
    sheet.classList.add('on'); sheet.scrollTop = 0;
  }

  // ── On the map and in Quests ──
  var GLAYER = L.layerGroup().addTo(map);
  function groupDraw() {
    GLAYER.clearLayers();
    var T = running(); if (!T) return;
    var p = spotById(gq(T.q).steps[T.done.length]); if (!p) return;
    var m = L.marker([p.lat, p.lng], { zIndexOffset: 3000, icon: L.divIcon({ html: '<div class="gpin">' + (T.done.length + 1) + '</div>', className: '', iconSize: [36, 36], iconAnchor: [18, 18] }) });
    m.on('click', openTeam); GLAYER.addLayer(m);
  }
  function groupBar() {
    var T = team(), gb = $('gbar');
    $('livebar').style.display = T ? 'none' : '';
    if (!T) { gb.hidden = true; return; }
    gb.hidden = false; gb.textContent = '';
    gb.appendChild(el('b', null, T.endAt ? t('gBarEnd') : !T.start ? t('gBarReady') : t('gStep', T.done.length + 1, gq(T.q).steps.length)));
    var s = el('span', null, T.start && !T.endAt ? gstat(T) : ''); s.id = 'gbart'; gb.appendChild(s);
  }
  $('gbar').onclick = function () { openTeam(); };
  function groupCard(root) {
    var T = team(), org = G.org && GCODE.test(G.org.code) ? G.org : null, box = el('div', 'acts');
    if (T) box.appendChild(gbtn('btn', T.endAt ? t('gSeeRes') : T.start ? t('gResume') : t('gReady'), function () { tab('map'); openTeam(); }));
    if (org) box.appendChild(gbtn('btn soft', t('gMyGame'), function () { tab('map'); openBoard(org.code); }));
    if (!T && playable().length) {
      var ci = el('div', 'codein gjoin'), inp = el('input'); inp.placeholder = 'FLC-GRP-XXXXXXXX'; inp.autocapitalize = 'characters'; ci.appendChild(inp);
      ci.appendChild(gbtn('btn', t('gJoin'), function () {
        var c = inp.value.trim().toUpperCase();
        if (!GCODE.test(c)) { toast(t('codeBad')); return; }
        var o = G.org && G.org.code === c ? G.org : { q: playable()[0].id, lim: 0 };
        gJoin(c, o.q, o.lim, o.tel);
      }));
      box.appendChild(ci);
    }
    box.appendChild(gbtn('linkbtn', t('gOrganise'), function () { SHOP_OPEN.group = true; renderShop(); tab('shop'); }));
    quest(root, ['team', '#4a5bb8'], t('gCardH'), [], t('gCardTxt'), 0, 0, box, !!running());
  }
  function groupActive() { return !!(team() || (G.org && GCODE.test(G.org.code))); }
  // Every second while a team plays: the stopwatch, and the time limit
  setInterval(function () {
    var T = running(); if (!T) return;
    if (T.lim && Date.now() - T.start >= T.lim * 60000) { toast(t('gEndTime')); endTeam(T, 'time', T.start + T.lim * 60000); return; }
    var a = $('gbart'), b = $('gstat'); if (a) a.textContent = gstat(T); if (b) b.textContent = gstat(T);
  }, 1000);
  // Links: ?partie= (a team joins), ?resultat= (the organiser receives), ?merci=groupe (paid session)
  function groupInit() {
    var q = new URLSearchParams(location.search), act = null;
    var pc = String(q.get('partie') || '').toUpperCase();
    if (GCODE.test(pc)) {
      var Q = gq(q.get('q')) || playable()[0], lim = +q.get('lim') || 0;
      if (LIMITS.indexOf(lim) < 0) lim = 0;
      var tel = telOf(q.get('tel'));
      if (Q) act = function () { gJoin(pc, Q.id, lim, tel); };
    }
    var rs = q.get('resultat');
    if (rs) {
      var r = okResult(b64d(rs));
      if (r) { addResult(r); act = function () { tab('map'); openBoard(r.c); toast(t('gGot', r.n)); }; }
      else act = function () { toast(t('gBadRes')); };
    }
    var sid = q.get('session_id') || '';
    if (q.get('merci') === 'groupe' && /^cs_(live|test)_[A-Za-z0-9]{10,}$/.test(sid) && playable().length) {
      var code = 'FLC-GRP-' + sid.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
      setOrg(code); track('shop/paid/groupe'); act = function () { tab('map'); openBoard(code); };
    }
    if (pc || rs || q.get('merci') === 'groupe') try { history.replaceState(null, '', location.pathname); } catch (e) {}
    // A game left running while the phone slept: the time limit may have passed
    var T = running(); if (T && T.lim && Date.now() - T.start >= T.lim * 60000) { T.endAt = T.start + T.lim * 60000; T.why = 'time'; gsave(); }
    return act;
  }
`;

module.exports = { GROUP_STYLE, GROUP_CLIENT };
