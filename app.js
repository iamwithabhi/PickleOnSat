// Page logic: routing, players page, matches + scores (basic).
import { CHARACTERS, BACKGROUNDS } from './character-list.js?v=202610261949';

const STORE = 'americano-v1';
const UI_STORE = 'americano-ui-v1';
const CHAR_STORE = 'americano-chars-v1';
const BG_STORE = 'americano-bgs-v1';
const COURTS = 1; // only 1 court offered for now
const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SUGGESTIONS =['Yoshi', 'Pratul', 'Kani', 'Sahil', 'Raj']; // regular players, offered as one-tap adds
const GAME_MS = 1000; // each simulated game takes ~1 second

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// Opening the page with ?demo (e.g. /?demo#/matches) shows a ready-made sample tournament that is never saved,
// and ignores whatever real tournament is stored, so layouts can be checked without touching real data.
const DEMO = new URLSearchParams(location.search).has('demo');
const readJSON = (key) => { if (DEMO) return null; try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };

if (!window.Americano) {
  $('setupError').textContent = 'Could not load americano.js';
  throw new Error('americano.js not loaded');
}

// ---------- state ----------

let t;
try { t = Americano.Tournament.fromJSON(DEMO ? '{}' : localStorage.getItem(STORE) || '{}'); } catch (e) { t = new Americano.Tournament(); }
if (!Array.isArray(t.players)) t = new Americano.Tournament();
if (DEMO) { // five players, game point 11, round 1 finished, round 2 under way
  t = new Americano.Tournament();
  ['Yoshi', 'Pratul', 'Kani', 'Sahil', 'Raj'].forEach((p) => t.addPlayer(p));
  t.configure({ courts: COURTS, seed: 7 });
  t.start();
  t.recordScore(0, 0, 11, 6);
  t.recordScore(1, 0, 7, 5);
  document.title += ' (demo)';
}

// Screen state that also survives a refresh (kept apart from the tournament itself).
const ui = readJSON(UI_STORE) || {};
let drafts = ui.drafts && typeof ui.drafts === 'object' ? ui.drafts : {}; // typed, unsaved scores: { "round-court": [a, b] }
// Which team serves first in each game, chosen at random once and kept across refreshes: { "round-court": 0 | 1 } (0 = first team listed)
let serves = ui.serves && typeof ui.serves === 'object' ? ui.serves : {};
let sim = null; // { round, court } while a simulation is running
let simAsk = false; // the Confirm button next to "Run Test Simulation" is showing

// Character and backdrop per player, keyed by lower-cased name.
let chars = readJSON(CHAR_STORE) || {};
let bgs = readJSON(BG_STORE) || {};

// Detect browsers/views where storage is blocked, so we can warn instead of silently losing data.
let canSave = true;
try { localStorage.setItem('americano-test', '1'); localStorage.removeItem('americano-test'); } catch (e) { canSave = false; }
const showStorageWarning = () => $('storageWarn').classList.toggle('hidden', canSave);

const save = () => {
  if (DEMO) return;
  try {
    localStorage.setItem(STORE, JSON.stringify(t));
    localStorage.setItem(CHAR_STORE, JSON.stringify(chars));
    localStorage.setItem(BG_STORE, JSON.stringify(bgs));
  } catch (e) { canSave = false; showStorageWarning(); }
};
const saveUi = () => {
  if (DEMO) return;
  try {
    localStorage.setItem(UI_STORE, JSON.stringify({ drafts, serves, name: $('name').value, simRunning: !!sim }));
  } catch (e) {}
};

// ---------- characters ----------

let gfx = null; // the 3D module, once loaded
let crown = null; // still image of the crown shown beside a winning team
const charKey = (name) => name.toLowerCase();
const charOf = (name) => CHARACTERS.find((c) => c.id === chars[charKey(name)]) || null;

const bgOf = (name) => (BACKGROUNDS.includes(bgs[charKey(name)]) ? bgs[charKey(name)] : null);

// Random pick among the least-used options, so repeats only start once all are taken.
function pickLeast(options, assigned, exclude) {
  const used = {};
  for (const p of t.players) { const v = assigned[charKey(p)]; if (v) used[v] = (used[v] || 0) + 1; }
  const pool = options.filter((o) => o !== exclude);
  const least = Math.min(...pool.map((o) => used[o] || 0));
  const best = pool.filter((o) => (used[o] || 0) === least);
  return best[Math.floor(Math.random() * best.length)];
}
const pickCharacter = (exclude) => pickLeast(CHARACTERS.map((c) => c.id), chars, exclude);
const pickBackground = (exclude) => pickLeast(BACKGROUNDS, bgs, exclude);

function ensureCharacters() {
  for (const p of t.players) {
    if (!charOf(p)) chars[charKey(p)] = pickCharacter();
    if (!bgOf(p)) bgs[charKey(p)] = pickBackground();
  }
  const keep = new Set(t.players.map(charKey));
  for (const map of [chars, bgs]) for (const k of Object.keys(map)) if (!keep.has(k)) delete map[k];
}

// ---------- routing ----------

const ROUTES = ['players', 'matches', 'scores'];
function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : (t.started ? 'matches' : 'players');
}
function go(route) {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
  else showRoute();
}
function showRoute() {
  const route = currentRoute();
  for (const r of ROUTES) $(`page-${r}`).classList.toggle('hidden', r !== route);
  document.querySelectorAll('nav a').forEach((a) => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', () => { showRoute(); window.scrollTo(0, 0); });

// ---------- page 1: players ----------

let justAdded = null; // name of the card to animate in

function renderRoster() {
  const locked = t.started;
  const cards = t.players.map((p, i) => {
    const c = charOf(p);
    const img = c && gfx && gfx.portrait(c.id);
    const art = img
      ? `<img src="${img}" alt="">`
      : `<span class="initials">${esc(p.slice(0, 2).toUpperCase())}</span>`;
    const bg = bgOf(p);
    return `
      <div class="player${p === justAdded ? ' new' : ''}">
        <div class="portrait" data-show="${i}" ${bg ? `data-bg="${bg}"` : ''} title="${locked ? '' : 'Click for a different character'}">${art}
          <span class="no">${i + 1}</span>
          ${locked ? '' : `<button class="remove" data-rm="${i}" aria-label="Remove ${esc(p)}" title="Remove">${CLOSE_ICON}</button>`}
        </div>
        <div class="info">
          <div class="name" title="${esc(p)}">${esc(p)}</div>
        </div>
      </div>`;
  });
  $('roster').innerHTML = cards.join('');
  justAdded = null;
}

// One-tap names under the field; ones already on the roster are left out.
function renderSuggestions() {
  const taken = new Set(t.players.map(charKey));
  const left = SUGGESTIONS.filter((s) => !taken.has(charKey(s)));
  const show = !t.started && t.playerCount < Americano.MAX_PLAYERS && left.length > 0;
  $('suggest').classList.toggle('hidden', !show);
  $('suggest').innerHTML = left.map((s) => `<button type="button" class="suggest-chip" data-suggest="${esc(s)}">+ ${esc(s)}</button>`).join('');
}

// The read-only table: rounds, and what that means for each player.
function showRounds(rounds) {
  let games = '?', sit = '?';
  if (Number.isInteger(rounds)) {
    // rounds is always an even-up count, so everyone sits out the same number of times
    sit = Americano.sitOutSpread(t.playerCount, COURTS, rounds).min;
    games = rounds - sit;
  }
  $('rounds').innerHTML = `<tr><td>${rounds}</td><td>${games}</td><td>${sit}</td></tr>`;
}

function renderSetup() {
  const n = t.playerCount;
  const locked = t.started;
  $('addForm').classList.toggle('hidden', locked);
  $('startBtn').classList.toggle('hidden', locked);
  const resume = $('toMatchesBtn');
  resume.classList.toggle('hidden', !locked);
  if (locked) {
    resume.classList.toggle('done', t.finished);
    resume.href = t.finished ? '#/scores' : '#/matches';
    resume.querySelector('.what').textContent = t.finished ? 'Tournament complete' : `Round ${t.currentRoundIndex + 1} of ${t.rounds.length} in play`;
    resume.setAttribute('aria-label', t.finished ? 'View rank' : 'View play');
  }
  $('addBtn').disabled = n >= Americano.MAX_PLAYERS;
  renderSuggestions();

  document.querySelectorAll('#target button').forEach((b) => {
    b.setAttribute('aria-pressed', String(+b.dataset.target === t.settings.target));
    b.disabled = locked;
  });

  const enough = n >= Americano.MIN_PLAYERS;
  $('startBtn').disabled = !enough;
  if (!enough) {
    showRounds('?');
    $('plan').textContent = `Add ${Americano.MIN_PLAYERS} or more players to start`;
    renderRoster();
    return;
  }
  $('plan').textContent = '';

  // Rounds are not chosen. Same rule as main: start from the standard Americano count (everyone partners everyone
  // once), then move to the nearest count where every player sits out equally, applied automatically instead of
  // asking. Recomputed whenever the roster changes.
  let rounds = t.settings.rounds;
  if (!locked) {
    rounds = Americano.equalSitOutRounds(n, COURTS, Americano.defaultRounds(n));
    if (rounds !== t.settings.rounds) { t.configure({ rounds }); save(); }
  }
  showRounds(rounds);
  renderRoster();
}

// Adds a player, gives them a random character, and reports any problem under the field.
function addNamed(raw) {
  try {
    const name = t.addPlayer(raw);
    chars[charKey(name)] = pickCharacter();
    bgs[charKey(name)] = pickBackground();
    justAdded = name;
    $('setupError').textContent = '';
    save(); render();
    return true;
  } catch (err) { $('setupError').textContent = err.message; return false; }
}

$('addForm').onsubmit = (e) => {
  e.preventDefault();
  if (addNamed($('name').value)) $('name').value = '';
  saveUi();
  $('name').focus();
};
$('suggest').onclick = (e) => {
  const chip = e.target.closest('[data-suggest]');
  if (chip) addNamed(chip.dataset.suggest); // leaves whatever is typed in the field alone
};
$('roster').onclick = (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const name = t.players[+rm.dataset.rm];
    t.removePlayer(name); delete chars[charKey(name)]; delete bgs[charKey(name)];
    save(); render();
    return;
  }
  const stage = e.target.closest('[data-show]');
  if (stage && !t.started) {
    const name = t.players[+stage.dataset.show];
    chars[charKey(name)] = pickCharacter(chars[charKey(name)]);
    bgs[charKey(name)] = pickBackground(bgs[charKey(name)]);
    save(); renderRoster();
  }
};
$('target').onclick = (e) => {
  const b = e.target.closest('[data-target]');
  if (b && !b.disabled) { t.configure({ target: +b.dataset.target }); save(); renderSetup(); }
};
$('startBtn').onclick = () => {
  try {
    t.configure({ courts: COURTS, seed: null });
    t.start(); drafts = {}; serves = {}; $('setupError').textContent = ''; save(); render();
    go('matches');
  } catch (err) { $('setupError').textContent = err.message; }
};
$('name').oninput = saveUi;

// ---------- page 2: matches (basic) ----------

// A typed-but-unsaved score for this court, if any; otherwise the saved score.
const draft = (r, c, side, saved) => {
  const d = drafts[`${r}-${c}`];
  return d ? d[side] : saved;
};
// What a score box shows: the picked-but-unsaved number, else the saved score. An untouched 0-0 shows empty,
// so a score is only saved once both sides have been picked.
const shownScore = (r, c, side) => {
  const m = t.roundView(r).matches[c];
  const started = m.over || m.scoreA > 0 || m.scoreB > 0;
  return draft(r, c, side, started ? (side ? m.scoreB : m.scoreA) : '');
};

function renderPlay() {
  if (t.started) { // a coin toss for every game that doesn't have one yet (also covers a tournament saved before this existed)
    t.rounds.forEach((rd, r) => rd.matches.forEach((m, c) => { if (serves[`${r}-${c}`] === undefined) serves[`${r}-${c}`] = Math.random() < 0.5 ? 0 : 1; }));
  }
  saveUi();
  $('matchesEmpty').classList.toggle('hidden', t.started);
  $('playRow').classList.toggle('hidden', !t.started);
  if (!t.started) return;
  const cur = t.currentRoundIndex;
  const total = t.rounds.length;
  $('simBtn').classList.toggle('hidden', t.finished);
  $('simBtn').textContent = sim ? 'Stop Test Simulation' : 'Run Test Simulation';
  $('simConfirm').classList.toggle('hidden', !simAsk || !!sim || t.finished);
  $('doneLink').classList.toggle('hidden', !t.finished);
  $('simStatus').textContent = !t.finished && sim && sim.round >= 0 ? `Simulating round ${sim.round + 1}, court ${sim.court + 1}…` : '';
  $('roundTitle').textContent = t.finished
    ? `Tournament complete (${total} rounds)`
    : `Now playing: Round ${cur + 1} of ${total}`;
  // Every round, in order: status + round number on the left, the two teams in the middle, a score box on the right.
  $('courtsBox').innerHTML = t.rounds.map((round, r) => {
    const v = t.roundView(r);
    const done = round.matches.every((m) => m.over);
    const state = done ? 'done' : r === cur ? 'live' : r === cur + 1 ? 'next' : 'later';
    const locked = r > cur && cur !== -1;
    const teamRow = (m, c, side) => {
      const team = side ? m.teamB : m.teamA;
      const win = m.winner && m.winner.join() === team.join();
      const val = shownScore(r, c, side);
      const open = pick && pick.r === r && pick.c === c && pick.side === side;
      const numbers = (now) => {
        let nums = '';
        for (let n = 0; n <= t.settings.target; n++) nums += `<button type="button" class="num${String(n) === String(now) ? ' on' : ''}" data-v="${n}">${n}</button>`;
        return `<div class="nums">${nums}</div>`;
      };
      const serves1st = state === 'live' && !m.over && serves[`${r}-${c}`] === side; // a small pixel ball marks who serves first in the game being played
      return `<div class="team${win ? ' win' : ''}">
          <span class="names">${esc(team.join(' / '))}</span>${win && crown ? `<img class="crown" src="${crown}" alt="Winner" title="Winner">` : ''}
          ${serves1st ? '<svg class="serve" viewBox="0 0 7 7" role="img" aria-label="Serves first" shape-rendering="crispEdges"><title>Serves first</title><path fill="currentColor" fill-rule="evenodd" d="M2 0h3v1H2zM1 1h5v1H1zM0 2h7v3H0zM1 5h5v1H1zM2 6h3v1H2zM3 1h1v1H3zM1 3h1v1H1zM3 3h1v1H3zM5 3h1v1H5zM3 5h1v1H3z"/></svg>' : ''}
          <button type="button" class="score${val === '' ? ' empty' : ''}${open ? ' open' : ''}" data-r="${r}" data-c="${c}" data-side="${side}" aria-label="Score for ${esc(team.join(' and '))}: ${val === '' ? 'not set' : val}" ${locked ? 'disabled' : ''}>${val === '' ? '–' : esc(val)}</button>
        </div>${open ? numbers(val) : ''}`;
    };
    // once a game is decided the winning team moves to the top (the score boxes keep belonging to their own team)
    const blocks = v.matches.map((m, c) => {
      const key = `${r}-${c}`;
      if (m.winner && !settled.has(key)) settleLater(key);
      const order = m.winner && settled.has(key) && m.winner.join() === m.teamB.join() ? [1, 0] : [0, 1];
      return `
      <div class="match ${state}">
        <div class="side"><span class="no">${String(r + 1).padStart(2, '0')}</span></div>
        <div class="teams">${teamRow(m, c, order[0])}${teamRow(m, c, order[1])}</div>
      </div>${scoreError && scoreError.r === r && scoreError.c === c ? '<p class="score-error">Check the score again!</p>' : ''}`;
    }).join('');
    return blocks;
  }).join('');
}

// Tapping a score box opens a row of every possible score (0 up to the game point) just below that team, wrapping if needed.
let pick = null; // { r, c, side } while the numbers are open
let scoreError = null; // { r, c } of the game whose score was just rejected
// A decided game moves its winner to the top, but only a few seconds after the score goes in, so the list doesn't jump
// the instant a number is tapped. `settled` = games whose rows are already in final order; `pending` = waiting for it.
const SETTLE_MS = 4000;
const settled = new Set(), pending = new Set();
let settleGen = 0; // bumped on reset so timers from the old tournament do nothing
const settleAll = () => (t.rounds || []).forEach((rd, r) => rd.matches.forEach((m, c) => { if (m.over) settled.add(`${r}-${c}`); }));
const settleLater = (key) => {
  if (pending.has(key)) return;
  pending.add(key);
  const gen = settleGen;
  setTimeout(() => { if (gen !== settleGen) return; pending.delete(key); settled.add(key); renderPlay(); }, SETTLE_MS);
};
const closePicker = () => { pick = null; renderPlay(); };
function openPicker(r, c, side) {
  const same = pick && pick.r === r && pick.c === c && pick.side === side;
  pick = same ? null : { r, c, side }; // tapping the same box again closes it
  scoreError = null; // they're about to correct it
  renderPlay();
}
// A score is saved as soon as both sides of a match have a number.
function setScore(r, c, side, v) {
  const both = [shownScore(r, c, 0), shownScore(r, c, 1)];
  both[side] = String(v);
  drafts[`${r}-${c}`] = both;
  if (both[0] === '' || both[1] === '') { renderPlay(); return; } // wait for the other side; the pick is kept as a draft
  try {
    t.recordScore(r, c, Number(both[0]), Number(both[1]));
    delete drafts[`${r}-${c}`];
    $('playError').textContent = '';
    scoreError = null;
    settled.delete(`${r}-${c}`); // a changed score may change the winner: let it settle again before the rows swap
    save(); render();
  } catch (err) { scoreError = { r, c }; renderPlay(); } // the score doesn't add up (e.g. neither side reached the target): flag that game
}
$('courtsBox').onclick = (e) => {
  const b = e.target.closest('.score');
  if (b && !b.disabled) openPicker(+b.dataset.r, +b.dataset.c, +b.dataset.side);
};
$('courtsBox').addEventListener('click', (e) => {
  const n = e.target.closest('.num');
  if (!n || !pick) return;
  const { r, c, side } = pick;
  pick = null;
  setScore(r, c, side, +n.dataset.v);
});
// tap anywhere else to close (the tapped element may already be re-rendered away, so look at the original path)
document.addEventListener('click', (e) => { if (pick && !e.composedPath().includes($('courtsBox'))) closePicker(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pick) closePicker(); });

// Plays every remaining game one at a time, a rally per tick, ~GAME_MS per game.
async function runSimulation() {
  const me = (sim = { round: -1, court: -1 });
  while (sim === me && !t.finished) {
    const r = t.currentRoundIndex;
    const c = t.rounds[r].matches.findIndex((m) => !m.over);
    const m = t.rounds[r].matches[c];
    me.round = r; me.court = c;
    const steps = Americano.simulateGame(m.scoreA, m.scoreB, t.settings.target);
    render();
    for (const [a, b] of steps) {
      await sleep(GAME_MS / steps.length);
      if (sim !== me) return;
      try { t.recordScore(r, c, a, b); delete drafts[`${r}-${c}`]; }
      catch (err) { // e.g. the score was edited by hand mid-simulation
        sim = null; $('playError').textContent = `Simulation stopped: ${err.message}`; render(); return;
      }
      save(); render();
    }
  }
  if (sim === me) { sim = null; render(); }
}

// Starting a test simulation overwrites scores, so the first tap only brings up a small Confirm button beside it.
$('simBtn').onclick = () => {
  if (sim) { sim = null; render(); return; }
  simAsk = !simAsk; // tapping again dismisses it
  renderPlay();
};
$('simConfirm').onclick = () => {
  simAsk = false;
  $('playError').textContent = '';
  runSimulation();
};
document.addEventListener('click', (e) => { if (simAsk && !e.target.closest('#simBox')) { simAsk = false; renderPlay(); } });

// ---------- page 3: scores (basic) ----------

function renderStandings() {
  $('scoresEmpty').classList.toggle('hidden', t.started);
  $('standingsBox').classList.toggle('hidden', !t.started);
  $('resetBox').classList.toggle('hidden', !t.started);
  if (!t.started) { $('podiumBox').classList.add('hidden'); return; }
  const standings = t.standings();
  $('standings').innerHTML = standings.map((s) =>
    `<tr><td>${s.rank}</td><td>${esc(s.name)}</td><td>${s.points}</td><td>${s.diff}</td><td>${s.played}</td><td>${s.wins}</td><td>${s.byes} / ${s.byesTotal}</td></tr>`
  ).join('');
  renderPodium(standings);
}

// The top three on the podium, once at least one game has been played. The picture is drawn again only when
// the three players (or their characters) change.
let podiumKey = '', podiumTicket = 0;
async function renderPodium(standings) {
  const top = standings.slice(0, 3);
  const show = gfx && top.length === 3 && standings.some((s) => s.played > 0) && top.every((s) => charOf(s.name));
  $('podiumBox').classList.toggle('hidden', !show);
  if (!show) return;
  const ids = top.map((s) => charOf(s.name).id);
  const key = top.map((s, i) => `${s.name}:${ids[i]}`).join('|');
  if (key === podiumKey) return;
  podiumKey = key;
  const ticket = ++podiumTicket;
  try {
    const { url, centres } = await gfx.podiumScene(ids);
    if (ticket !== podiumTicket) return; // a newer ranking has already been asked for
    $('podiumImg').src = url;
    $('podiumImg').alt = `Podium: 1st ${top[0].name}, 2nd ${top[1].name}, 3rd ${top[2].name}`;
    [['pn2', 1, 0], ['pn1', 0, 1], ['pn3', 2, 2]].forEach(([id, who, step]) => {
      $(id).textContent = top[who].name;
      $(id).style.left = `${centres[step] * 100}%`;
    });
  } catch (e) { console.warn('Podium unavailable.', e); podiumKey = ''; }
}

// The ranking table scrolls sideways on small screens: mark it once it has moved so the pinned columns show their edge.
const rankWrap = $('standingsBox').querySelector('.table-wrap');
rankWrap.addEventListener('scroll', () => rankWrap.classList.toggle('scrolled', rankWrap.scrollLeft > 0));

// In-page Yes/Cancel prompt (the browser's confirm() pop-up is blocked in some embedded views).
// The pair appears in the place of the button that was tapped, which is hidden until the prompt is closed.
function askConfirm(trigger, box, yesLabel, onYes) {
  const close = () => { box.innerHTML = ''; trigger.classList.remove('hidden'); };
  trigger.classList.add('hidden');
  box.innerHTML = `<button class="btn yes">${yesLabel}</button><button class="btn icon no" aria-label="Cancel" title="Cancel">${CLOSE_ICON}</button>`;
  box.querySelector('.yes').onclick = () => { close(); onYes(); };
  box.querySelector('.no').onclick = close;
}

$('resetBtn').onclick = () => {
  askConfirm($('resetBtn'), $('resetConfirm'), 'Clear Scores', () => {
      sim = null;
      settleGen++; settled.clear(); pending.clear();
      t.reset(); t.settings.courts = null; drafts = {}; serves = {}; save(); render(); // keeps the players
      go('players');
    });
};

// Play and Rank have nothing to show until a tournament has started, so those tabs are switched off until then.
function updateNav() {
  document.querySelectorAll('nav a').forEach((a) => {
    const off = a.dataset.route !== 'players' && !t.started;
    if (off) { a.setAttribute('aria-disabled', 'true'); a.tabIndex = -1; } else { a.removeAttribute('aria-disabled'); a.removeAttribute('tabindex'); }
    a.classList.toggle('live', a.dataset.route === 'matches' && t.started && !t.finished); // the pulsing marker: a game is in play
  });
}

function render() { renderSetup(); renderPlay(); renderStandings(); updateNav(); }

// ---------- tap feedback ----------

// iOS Safari only applies :active (the "pressed in" look) when some touch listener exists on the page.
document.addEventListener('touchstart', () => {}, { passive: true });
// A tiny buzz on phones that support it, so a tap on a button is felt as well as seen.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn, .court button');
  if (b && !b.disabled && navigator.vibrate) navigator.vibrate(8);
});

// ---------- boot ----------

// The page works straight away (cards show initials); portraits swap in once the 3D models load.
async function loadCharacters() {
  try {
    const mod = await import('./characters.js?v=202610261949');
    mod.podiumImage().then((url) => {
      const logo = document.querySelector('.logo');
      logo.querySelector('img').src = url;
      logo.classList.add('has-img');
    }).catch((e) => console.warn('Podium logo unavailable.', e));
    mod.crownImage().then((url) => { crown = url; renderPlay(); }).catch((e) => console.warn('Crown unavailable.', e));
    await mod.preload();
    gfx = mod;
    renderRoster();
    renderStandings(); // the podium needs the 3D module
  } catch (e) {
    console.warn('3D characters unavailable, using initials instead.', e);
  }
}

settleAll(); // games already decided when the page opens are in their final order straight away
ensureCharacters(); save();
if (typeof ui.name === 'string') $('name').value = ui.name;
showStorageWarning();
render();
showRoute();
loadCharacters();
if (ui.simRunning && t.started && !t.finished) runSimulation(); // pick up where it left off
