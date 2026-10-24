// Page logic: routing, players page, matches + scores (basic).
import { CHARACTERS, BACKGROUNDS } from './character-list.js';

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
const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };

if (!window.Americano) {
  $('setupError').textContent = 'Could not load americano.js';
  throw new Error('americano.js not loaded');
}

// ---------- state ----------

let t;
try { t = Americano.Tournament.fromJSON(localStorage.getItem(STORE) || '{}'); } catch (e) { t = new Americano.Tournament(); }
if (!Array.isArray(t.players)) t = new Americano.Tournament();

// Screen state that also survives a refresh (kept apart from the tournament itself).
const ui = readJSON(UI_STORE) || {};
let viewRound = Number.isInteger(ui.viewRound) ? ui.viewRound : null; // null = follow current round
let drafts = ui.drafts && typeof ui.drafts === 'object' ? ui.drafts : {}; // typed, unsaved scores: { "round-court": [a, b] }
let shownRound = 0; // round currently displayed
let sim = null; // { round, court } while a simulation is running

// Character and backdrop per player, keyed by lower-cased name.
let chars = readJSON(CHAR_STORE) || {};
let bgs = readJSON(BG_STORE) || {};

// Detect browsers/views where storage is blocked, so we can warn instead of silently losing data.
let canSave = true;
try { localStorage.setItem('americano-test', '1'); localStorage.removeItem('americano-test'); } catch (e) { canSave = false; }
const showStorageWarning = () => $('storageWarn').classList.toggle('hidden', canSave);

const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(t));
    localStorage.setItem(CHAR_STORE, JSON.stringify(chars));
    localStorage.setItem(BG_STORE, JSON.stringify(bgs));
  } catch (e) { canSave = false; showStorageWarning(); }
};
const saveUi = () => {
  try {
    localStorage.setItem(UI_STORE, JSON.stringify({ viewRound, drafts, name: $('name').value, simRunning: !!sim }));
  } catch (e) {}
};

// ---------- characters ----------

let gfx = null; // the 3D module, once loaded
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
      ? `<div class="spin" style="background-image:url(${img});animation-delay:-${(i * 0.9).toFixed(1)}s"></div>`
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
  // empty slots: enough to reach the minimum, plus one more if needed so the last grid row is never a black hole
  let missing = Math.max(0, Americano.MIN_PLAYERS - t.playerCount);
  if (!locked && (t.playerCount + missing) % 2 === 1 && t.playerCount + missing < Americano.MAX_PLAYERS) missing++;
  for (let i = 0; i < missing; i++) {
    cards.push(`
      <div class="player vacant">
        <div class="portrait"><span class="no">${t.playerCount + i + 1}</span></div>
        <div class="info">
          <div class="name">Player</div>
        </div>
      </div>`);
  }
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
  $('lockedNote').classList.toggle('hidden', !locked);
  $('startBtn').classList.toggle('hidden', locked);
  $('toMatchesBtn').classList.toggle('hidden', !locked);
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
    $('plan').textContent = `Add at least ${Americano.MIN_PLAYERS - n} more player${Americano.MIN_PLAYERS - n === 1 ? '' : 's'} to start.`;
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
    t.start(); viewRound = null; drafts = {}; $('setupError').textContent = ''; save(); render();
    go('matches');
  } catch (err) { $('setupError').textContent = err.message; }
};
$('toMatchesBtn').onclick = () => go('matches');
$('name').oninput = saveUi;

// ---------- page 2: matches (basic) ----------

// A typed-but-unsaved score for this court, if any; otherwise the saved score.
const draft = (r, c, side, saved) => {
  const d = drafts[`${r}-${c}`];
  return d ? d[side] : saved;
};

function renderPlay() {
  saveUi();
  $('matchesEmpty').classList.toggle('hidden', t.started);
  $('playRow').classList.toggle('hidden', !t.started);
  if (!t.started) return;
  const cur = t.currentRoundIndex;
  const total = t.rounds.length;
  if (viewRound != null && !(viewRound >= 0 && viewRound < total)) viewRound = null;
  $('simBtn').classList.toggle('hidden', t.finished);
  $('simBtn').textContent = sim ? 'Stop simulation' : 'Run simulation';
  $('simStatus').textContent = t.finished ? 'All games played.'
    : sim && sim.round >= 0 ? `Simulating round ${sim.round + 1}, court ${sim.court + 1}…` : '';
  $('roundTitle').textContent = t.finished
    ? `Tournament complete (${total} rounds)`
    : `Now playing: Round ${cur + 1} of ${total}`;
  const r = viewRound == null ? (cur === -1 ? total - 1 : cur) : viewRound;
  shownRound = r;
  $('roundChips').innerHTML = t.rounds.map((round, i) => {
    const state = round.matches.every((m) => m.over) ? 'done' : i === cur ? 'playing' : 'upcoming';
    const label = { done: 'Done', playing: 'Playing', upcoming: 'Upcoming' }[state];
    return `<button class="chip ${state}${i === r ? ' selected' : ''}" data-round="${i}">Round ${i + 1} <small>${label}</small></button>`;
  }).join('');
  const v = t.roundView(r);
  $('byes').textContent = v.byes.length ? `Sitting out: ${v.byes.join(', ')}` : '';
  const locked = cur !== -1 && r > cur;
  $('courtsBox').innerHTML = v.matches.map((m, c) => `
    <div class="court">
      <b>Court ${m.court}:</b> ${esc(m.teamA.join(' & '))} <i>vs</i> ${esc(m.teamB.join(' & '))}<br>
      <input type="number" min="0" id="a${c}" value="${esc(draft(r, c, 0, m.scoreA))}" ${locked ? 'disabled' : ''}> -
      <input type="number" min="0" id="b${c}" value="${esc(draft(r, c, 1, m.scoreB))}" ${locked ? 'disabled' : ''}>
      <button data-save="${c}" ${locked ? 'disabled' : ''}>Save score</button>
      <span class="${m.over ? 'over' : 'live'}">${sim && sim.round === r && sim.court === c ? 'Simulating…' : m.status}${m.winner ? ` — ${esc(m.winner.join(' & '))} win` : ''}</span>
    </div>`).join('');
}

$('roundChips').onclick = (e) => {
  const chip = e.target.closest('[data-round]');
  if (chip) { viewRound = +chip.dataset.round; renderPlay(); } // renderPlay also saves the choice
};
$('courtsBox').onclick = (e) => {
  const c = e.target.dataset.save;
  if (c == null) return;
  const r = shownRound;
  const a = $('a' + c).value === '' ? NaN : Number($('a' + c).value);
  const b = $('b' + c).value === '' ? NaN : Number($('b' + c).value);
  try {
    const before = t.currentRoundIndex;
    t.recordScore(r, +c, a, b);
    delete drafts[`${r}-${c}`];
    $('playError').textContent = '';
    if (t.currentRoundIndex !== before) viewRound = null; // jump to the new current round
    save(); render();
  } catch (err) { $('playError').textContent = `Court ${+c + 1}: ${err.message}`; }
};
$('courtsBox').oninput = (e) => {
  const m = /^[ab](\d+)$/.exec(e.target.id);
  if (!m) return;
  const c = m[1];
  drafts[`${shownRound}-${c}`] = [$('a' + c).value, $('b' + c).value];
  saveUi();
};

// Plays every remaining game one at a time, a rally per tick, ~GAME_MS per game.
async function runSimulation() {
  const me = (sim = { round: -1, court: -1 });
  while (sim === me && !t.finished) {
    const r = t.currentRoundIndex;
    const c = t.rounds[r].matches.findIndex((m) => !m.over);
    const m = t.rounds[r].matches[c];
    me.round = r; me.court = c; viewRound = null;
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

$('simBtn').onclick = () => {
  if (sim) { sim = null; render(); return; }
  $('playError').textContent = '';
  runSimulation();
};

// ---------- page 3: scores (basic) ----------

function renderStandings() {
  $('scoresEmpty').classList.toggle('hidden', t.started);
  $('standingsBox').classList.toggle('hidden', !t.started);
  if (!t.started) return;
  $('standings').innerHTML = t.standings().map((s) =>
    `<tr><td>${s.rank}</td><td>${esc(s.name)}</td><td>${s.points}</td><td>${s.diff}</td><td>${s.played}</td><td>${s.wins}</td><td>${s.byes} / ${s.byesTotal}</td></tr>`
  ).join('');
}

// In-page Yes/Cancel prompt (the browser's confirm() pop-up is blocked in some embedded views).
function askConfirm(box, message, yesLabel, onYes) {
  box.innerHTML = `<p>${message}</p><button class="btn yes">${yesLabel}</button> <button class="btn no">Cancel</button>`;
  box.querySelector('.yes').onclick = () => { box.innerHTML = ''; onYes(); };
  box.querySelector('.no').onclick = () => { box.innerHTML = ''; };
}

$('resetBtn').onclick = () => {
  const done = t.rounds.reduce((s, r) => s + r.matches.filter((m) => m.over).length, 0);
  askConfirm($('resetConfirm'),
    `Delete all scores (${done} finished game(s)) and go back to setup? Your ${t.playerCount} players are kept.`,
    'Yes, delete scores and start over', () => {
      sim = null;
      t.reset(); t.settings.courts = null; viewRound = null; drafts = {}; save(); render(); // keeps the players
      go('players');
    });
};

function render() { renderSetup(); renderPlay(); renderStandings(); }

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
    const mod = await import('./characters.js');
    mod.podiumImage().then((url) => {
      const logo = document.querySelector('.logo');
      logo.querySelector('img').src = url;
      logo.classList.add('has-img');
    }).catch((e) => console.warn('Podium logo unavailable.', e));
    await mod.preload();
    gfx = mod;
    renderRoster();
  } catch (e) {
    console.warn('3D characters unavailable, using initials instead.', e);
  }
}

ensureCharacters(); save();
if (typeof ui.name === 'string') $('name').value = ui.name;
showStorageWarning();
render();
showRoute();
loadCharacters();
if (ui.simRunning && t.started && !t.finished) runSimulation(); // pick up where it left off
