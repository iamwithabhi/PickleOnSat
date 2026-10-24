// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Tournament, generateSchedule, evaluateScore, simulateGame, mulberry32, defaultRounds, maxCourts,
  equalSitOutRounds, sitOutStep, sitOutSpread,
} = require('./americano.js');

const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function stats(n, sched) {
  const partner = {}, opp = {}, byes = new Array(n).fill(0), played = new Array(n).fill(0);
  for (const r of sched) {
    for (const p of r.byes) byes[p]++;
    for (const m of r.matches) {
      for (const t of [m.teamA, m.teamB]) partner[key(...t)] = (partner[key(...t)] || 0) + 1;
      for (const x of m.teamA) for (const y of m.teamB) opp[key(x, y)] = (opp[key(x, y)] || 0) + 1;
      for (const p of [...m.teamA, ...m.teamB]) played[p]++;
    }
  }
  return { partner, opp, byes, played };
}

function makeTournament(n, settings) {
  const t = new Tournament();
  for (let i = 1; i <= n; i++) t.addPlayer(`P${i}`);
  t.configure(Object.assign({ seed: 42 }, settings));
  t.start();
  return t;
}

// Plays the current round with team A winning target-to-x.
function finishRound(t, loserScore = 5) {
  const r = t.currentRoundIndex;
  t.rounds[r].matches.forEach((_, c) => t.recordScore(r, c, t.settings.target, loserScore));
}

// ---------------- schedule ----------------

test('defaults match the guide table (rounds, courts)', () => {
  const table = { 4: [1, 3], 5: [1, 5], 8: [2, 7], 9: [2, 9], 12: [3, 11], 16: [4, 15], 20: [5, 19], 24: [6, 23] };
  for (const [n, [courts, rounds]] of Object.entries(table)) {
    assert.equal(maxCourts(+n), courts, `courts for ${n}`);
    assert.equal(defaultRounds(+n), rounds, `rounds for ${n}`);
    const s = generateSchedule(+n);
    assert.equal(s.length, rounds);
    s.forEach((r) => assert.equal(r.matches.length, courts));
  }
});

test('every round is structurally valid for all player/court counts', () => {
  for (let n = 4; n <= 24; n++) {
    for (let c = 1; c <= maxCourts(n); c++) {
      for (const seed of [1, 7]) {
        const s = generateSchedule(n, { courts: c, seed, attempts: 5 });
        for (const r of s) {
          const everyone = [...r.byes];
          assert.equal(r.matches.length, c);
          for (const m of r.matches) {
            assert.equal(m.teamA.length, 2);
            assert.equal(m.teamB.length, 2);
            everyone.push(...m.teamA, ...m.teamB);
          }
          assert.equal(r.byes.length, n - 4 * c, `byes n=${n} c=${c}`);
          assert.equal(new Set(everyone).size, n, `each player exactly once n=${n} c=${c}`);
          everyone.forEach((p) => assert.ok(p >= 0 && p < n));
        }
      }
    }
  }
});

test('byes are spread evenly (max - min <= 1) for all counts', () => {
  for (let n = 4; n <= 24; n++) {
    for (let c = 1; c <= maxCourts(n); c++) {
      const s = generateSchedule(n, { courts: c, seed: 3, attempts: 5 });
      // check after every prefix of rounds, not just the end
      const byes = new Array(n).fill(0);
      for (const r of s) {
        r.byes.forEach((p) => byes[p]++);
        assert.ok(Math.max(...byes) - Math.min(...byes) <= 1, `n=${n} c=${c} byes=${byes}`);
      }
    }
  }
});

test('perfect counts: every pair partners exactly once', () => {
  for (const n of [4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24]) {
    for (const seed of [1, 2, 3]) {
      const s = generateSchedule(n, { seed });
      const { partner, byes } = stats(n, s);
      assert.equal(Object.keys(partner).length, (n * (n - 1)) / 2, `all pairs covered n=${n}`);
      Object.values(partner).forEach((v) => assert.equal(v, 1));
      if (n % 2 === 1) byes.forEach((b) => assert.equal(b, 1, `one bye each n=${n}`));
    }
  }
});

test('no repeat partners in any default-length schedule (all counts & courts)', () => {
  for (let n = 4; n <= 24; n++) {
    for (let c = 1; c <= maxCourts(n); c++) {
      const s = generateSchedule(n, { courts: c, seed: 11 });
      const { partner } = stats(n, s);
      const worst = Math.max(...Object.values(partner));
      assert.equal(worst, 1, `n=${n} c=${c} has a repeat partner`);
    }
  }
});

test('opponent spread stays reasonable', () => {
  for (let n = 4; n <= 24; n++) {
    const s = generateSchedule(n, { seed: 5 });
    const { opp } = stats(n, s);
    assert.ok(Math.max(...Object.values(opp)) <= 4, `n=${n}`);
  }
});

test('schedule is deterministic per seed and differs across seeds', () => {
  assert.deepEqual(generateSchedule(10, { seed: 9 }), generateSchedule(10, { seed: 9 }));
  assert.notDeepEqual(generateSchedule(10, { seed: 9 }), generateSchedule(10, { seed: 10 }));
});

test('custom round counts (fewer or more than default) stay valid', () => {
  const short = generateSchedule(8, { rounds: 3 });
  assert.equal(short.length, 3);
  const long = generateSchedule(8, { rounds: 14 });
  assert.equal(long.length, 14);
  const { played } = stats(8, long);
  played.forEach((p) => assert.equal(p, 14));
});

test('schedule rejects invalid inputs', () => {
  assert.throws(() => generateSchedule(3), /between 4 and 24/);
  assert.throws(() => generateSchedule(25), /between 4 and 24/);
  assert.throws(() => generateSchedule(8.5), /between 4 and 24/);
  assert.throws(() => generateSchedule(8, { courts: 3 }), /Courts/);
  assert.throws(() => generateSchedule(8, { courts: 0 }), /Courts/);
  assert.throws(() => generateSchedule(8, { rounds: 0 }), /Rounds/);
});

// ---------------- scoring ----------------

test('evaluateScore: first to target wins (no win-by-two)', () => {
  const ev = (a, b) => evaluateScore(a, b, 11);
  assert.deepEqual(ev(0, 0), { valid: true, over: false, winner: null, error: null });
  assert.equal(ev(10, 10).over, false);
  assert.equal(ev(11, 10).over, true);
  assert.equal(ev(11, 10).winner, 'A');
  assert.equal(ev(3, 11).winner, 'B');
  assert.equal(ev(11, 0).over, true);
  assert.equal(ev(12, 5).valid, false);
  assert.equal(ev(11, 11).valid, false);
  assert.equal(ev(-1, 3).valid, false);
  assert.equal(ev(2.5, 3).valid, false);
  assert.equal(ev('5', 3).valid, false);
  assert.equal(ev(NaN, 3).valid, false);
});

test('evaluateScore respects 6 and 8 targets', () => {
  assert.equal(evaluateScore(6, 5, 6).over, true);
  assert.equal(evaluateScore(5, 5, 6).over, false);
  assert.equal(evaluateScore(7, 2, 6).valid, false);
  assert.equal(evaluateScore(6, 6, 6).valid, false);
  assert.equal(evaluateScore(3, 8, 8).winner, 'B');
  assert.equal(evaluateScore(7, 7, 8).over, false);
  assert.equal(evaluateScore(9, 7, 8).valid, false);
});

// ---------------- equal sit-outs ----------------

test('equalSitOutRounds: known single-court examples', () => {
  assert.equal(equalSitOutRounds(6, 1), 6);   // default 5 -> 6 (2 sit-outs each)
  assert.equal(equalSitOutRounds(7, 1), 7);   // default already equal
  assert.equal(equalSitOutRounds(10, 1), 10); // step 5, default 9 -> 10
  assert.equal(equalSitOutRounds(8, 1), 8);   // step 2, 6 vs 8 tie -> more rounds
  assert.equal(equalSitOutRounds(12, 1), 12); // step 3, default 11 -> 12
  assert.equal(equalSitOutRounds(5, 1), 5);
  assert.equal(equalSitOutRounds(4, 1), 3);   // nobody sits out: keep default
  assert.equal(equalSitOutRounds(6, 1, 1), 3); // never returns 0 rounds
  assert.equal(equalSitOutRounds(6, 1, 8), 9);
});

test('sitOutStep: rounds must be a multiple of it for equal sit-outs', () => {
  assert.equal(sitOutStep(4, 1), 1); // nobody sits out
  assert.equal(sitOutStep(5, 1), 5);
  assert.equal(sitOutStep(6, 1), 3);
  assert.equal(sitOutStep(7, 1), 7);
  assert.equal(sitOutStep(8, 1), 2);
  assert.equal(sitOutStep(8, 2), 1);
  for (let n = 4; n <= 24; n++) {
    for (let c = 1; c <= maxCourts(n); c++) {
      const step = sitOutStep(n, c);
      for (const k of [1, 2, 3]) {
        const { min, max } = sitOutSpread(n, c, step * k);
        assert.equal(min, max, `n=${n} c=${c} rounds=${step * k}`);
      }
      // stepping up or down from an equal count always lands on another equal count
      const eq = equalSitOutRounds(n, c);
      assert.equal(eq % step, 0, `n=${n} c=${c}`);
      assert.equal(equalSitOutRounds(n, c, eq + step), eq + step);
    }
  }
});

test('fewest rounds on one court: every player plays the same games and sits out the same', () => {
  const expected = { 4: 1, 5: 5, 6: 3, 7: 7, 8: 2, 9: 9, 10: 5, 11: 11, 12: 3, 16: 4, 20: 5, 24: 6 };
  for (const [n, rounds] of Object.entries(expected)) assert.equal(sitOutStep(+n, 1), rounds, `players ${n}`);
  for (let n = 4; n <= 24; n++) {
    const rounds = sitOutStep(n, 1);
    const t = makeTournament(n, { courts: 1, rounds });
    assert.equal(t.rounds.length, rounds);
    const st = t.standings();
    const sits = new Set(st.map((p) => p.byesTotal));
    assert.equal(sits.size, 1, `n=${n} uneven sit-outs`);
    const plays = new Array(n).fill(0);
    t.rounds.forEach((r) => r.matches.forEach((m) => [...m.teamA, ...m.teamB].forEach((p) => plays[p]++)));
    assert.equal(new Set(plays).size, 1, `n=${n} uneven games ${plays}`);
    assert.equal(plays[0] + [...sits][0], rounds);
    // no smaller round count works
    for (let r = 1; r < rounds; r++) {
      const spread = sitOutSpread(n, 1, r);
      const gamesEach = (4 * r) / n;
      assert.ok(spread.min !== spread.max || !Number.isInteger(gamesEach), `n=${n} r=${r} would also be even`);
    }
  }
});

test('app rule: standard Americano rounds, raised automatically to even out sit-outs (one court)', () => {
  // what the setup screen shows for n players
  const shown = (n) => equalSitOutRounds(n, 1, defaultRounds(n));
  const expected = { 4: 3, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 16: 16, 20: 20, 24: 24 };
  for (const [n, rounds] of Object.entries(expected)) assert.equal(shown(+n), rounds, `players ${n}`);
  for (let n = 4; n <= 24; n++) {
    const rounds = shown(n);
    assert.ok(rounds >= defaultRounds(n), `n=${n} must never go below the standard count`);
    const { min, max } = sitOutSpread(n, 1, rounds);
    assert.equal(min, max, `n=${n} sit-outs not even`);
    // and the schedule really is fair: nobody repeats a partner within a full rotation
    const sched = generateSchedule(n, { courts: 1, rounds, seed: 3 });
    const partner = {};
    for (const r of sched) for (const m of r.matches) for (const t of [m.teamA, m.teamB]) { const k = t.slice().sort().join('-'); partner[k] = (partner[k] || 0) + 1; }
    assert.equal(Math.max(...Object.values(partner)), 1, `n=${n} repeats a partnership`);
  }
});

test('sitOutSpread', () => {
  assert.deepEqual(sitOutSpread(6, 1, 5), { min: 1, max: 2 });
  assert.deepEqual(sitOutSpread(6, 1, 6), { min: 2, max: 2 });
  assert.deepEqual(sitOutSpread(8, 2, 7), { min: 0, max: 0 });
});

test('equal-sit-out round counts really give every player the same sit-outs', () => {
  for (let n = 4; n <= 24; n++) {
    for (let c = 1; c <= maxCourts(n); c++) {
      const rounds = equalSitOutRounds(n, c);
      const { min, max } = sitOutSpread(n, c, rounds);
      assert.equal(min, max, `n=${n} c=${c} rounds=${rounds}`);
      const s = generateSchedule(n, { courts: c, rounds, seed: 2, attempts: 5 });
      const counts = new Array(n).fill(0);
      s.forEach((r) => r.byes.forEach((p) => counts[p]++));
      assert.ok(counts.every((x) => x === min), `n=${n} c=${c} counts=${counts}`);
    }
  }
});

test('6 players, 6 rounds: 2 sit-outs and 4 games each, no repeat partners', () => {
  const t = makeTournament(6, { courts: 1, rounds: 6 });
  t.standings().forEach((p) => assert.equal(p.byesTotal, 2));
  const { partner } = stats(6, t.rounds);
  assert.equal(Math.max(...Object.values(partner)), 1);
  while (!t.finished) finishRound(t);
  t.standings().forEach((p) => assert.equal(p.played, 4));
});

// ---------------- simulation ----------------

test('simulateGame: one point per step, ends exactly at game over', () => {
  for (const target of [6, 8, 11]) {
    for (let seed = 1; seed <= 200; seed++) {
      const steps = simulateGame(0, 0, target, mulberry32(seed));
      let [pa, pb] = [0, 0];
      steps.forEach(([a, b], i) => {
        assert.equal(a + b, pa + pb + 1, 'exactly one rally per step');
        assert.ok(a >= pa && b >= pb);
        const ev = evaluateScore(a, b, target);
        assert.ok(ev.valid);
        assert.equal(ev.over, i === steps.length - 1, 'only the last step is game over');
        [pa, pb] = [a, b];
      });
      assert.equal(Math.max(pa, pb), target);
      assert.ok(steps.length >= target && steps.length <= 2 * target - 1);
    }
  }
});

test('simulateGame continues from a partial score and is empty when over', () => {
  const steps = simulateGame(5, 3, 6, mulberry32(4));
  assert.ok(steps.length >= 1);
  assert.equal(steps[0][0] + steps[0][1], 9);
  assert.deepEqual(simulateGame(6, 2, 6), []);
  assert.throws(() => simulateGame(9, 2, 8), /exceed/);
});

test('simulateGame: both teams win sometimes', () => {
  const wins = { A: 0, B: 0 };
  for (let seed = 1; seed <= 400; seed++) {
    const s = simulateGame(0, 0, 11, mulberry32(seed));
    const [a, b] = s[s.length - 1];
    wins[a > b ? 'A' : 'B']++;
  }
  assert.ok(wins.A > 120 && wins.B > 120, JSON.stringify(wins));
});

test('a whole tournament can be simulated game by game through recordScore', () => {
  const t = makeTournament(7, { courts: 1, target: 6 });
  const rand = mulberry32(99);
  let games = 0;
  while (!t.finished) {
    const r = t.currentRoundIndex;
    const c = t.rounds[r].matches.findIndex((m) => !m.over);
    const m = t.rounds[r].matches[c];
    for (const [a, b] of simulateGame(m.scoreA, m.scoreB, 6, rand)) t.recordScore(r, c, a, b);
    games++;
  }
  assert.equal(games, defaultRounds(7));
  t.rounds.forEach((r) => r.matches.forEach((m) => assert.equal(Math.max(m.scoreA, m.scoreB), 6)));
  assert.equal(t.standings().reduce((s, p) => s + p.played, 0), games * 4);
});

// ---------------- players ----------------

test('adding players: count, trimming, duplicates, limits', () => {
  const t = new Tournament();
  assert.equal(t.playerCount, 0);
  assert.equal(t.addPlayer('  Alice   Smith '), 'Alice Smith');
  t.addPlayer('Bob');
  assert.equal(t.playerCount, 2);
  assert.throws(() => t.addPlayer('bob'), /already added/);
  assert.throws(() => t.addPlayer('   '), /empty/);
  assert.throws(() => t.addPlayer(''), /empty/);
  assert.throws(() => t.addPlayer(null), /string/);
  assert.throws(() => t.addPlayer('x'.repeat(41)), /too long/);
  for (let i = 0; i < 22; i++) t.addPlayer(`P${i}`);
  assert.equal(t.playerCount, 24);
  assert.throws(() => t.addPlayer('One too many'), /Maximum 24/);
});

test('removing players', () => {
  const t = new Tournament();
  t.addPlayer('Alice');
  t.addPlayer('Bob');
  t.removePlayer('ALICE');
  assert.deepEqual(t.players, ['Bob']);
  assert.throws(() => t.removePlayer('Zed'), /No player/);
});

test('cannot start with fewer than 4 players; roster locks after start', () => {
  const t = new Tournament();
  ['A', 'B', 'C'].forEach((n) => t.addPlayer(n));
  assert.throws(() => t.start(), /at least 4/);
  t.addPlayer('D');
  t.start();
  assert.throws(() => t.addPlayer('E'), /after the tournament has started/);
  assert.throws(() => t.removePlayer('A'), /after the tournament has started/);
  assert.throws(() => t.configure({ target: 8 }), /after the tournament has started/);
  assert.throws(() => t.start(), /already started/);
});

test('configure validates target', () => {
  const t = new Tournament();
  assert.equal(t.settings.target, 11, 'defaults to 11');
  for (const bad of [12, 15, 21, 7, 0, '8', null]) {
    assert.throws(() => t.configure({ target: bad }), /Target/);
  }
  for (const ok of [6, 8, 11]) {
    t.configure({ target: ok });
    assert.equal(t.settings.target, ok);
  }
});

// ---------------- tournament flow ----------------

test('not-started tournament has no current round', () => {
  const t = new Tournament();
  assert.equal(t.started, false);
  assert.equal(t.currentRoundIndex, -1);
  assert.equal(t.finished, false);
  assert.throws(() => t.recordScore(0, 0, 1, 1), /not started/);
});

test('current round advances only when every game in it is over', () => {
  const t = makeTournament(8);
  assert.equal(t.currentRoundIndex, 0);
  t.recordScore(0, 0, 11, 4);
  assert.equal(t.currentRoundIndex, 0, 'court 2 still playing');
  assert.equal(t.roundView(0).complete, false);
  t.recordScore(0, 1, 6, 3); // in-progress update
  assert.equal(t.roundView(0).matches[1].status, 'In progress');
  assert.equal(t.currentRoundIndex, 0);
  t.recordScore(0, 1, 8, 11);
  assert.equal(t.roundView(0).matches[1].status, 'Game over');
  assert.equal(t.isRoundComplete(0), true);
  assert.equal(t.currentRoundIndex, 1);
});

test('cannot score a future round; can correct a past round', () => {
  const t = makeTournament(4);
  assert.throws(() => t.recordScore(1, 0, 11, 2), /not started yet/);
  finishRound(t);
  assert.equal(t.currentRoundIndex, 1);
  t.recordScore(0, 0, 11, 9); // correction to a finished round
  assert.equal(t.rounds[0].matches[0].scoreB, 9);
  // reopening a past game makes it the current round again
  t.recordScore(0, 0, 10, 9);
  assert.equal(t.currentRoundIndex, 0);
});

test('invalid scores are rejected and leave the match unchanged', () => {
  const t = makeTournament(4);
  t.recordScore(0, 0, 5, 5);
  assert.throws(() => t.recordScore(0, 0, 12, 3), /exceed/);
  assert.throws(() => t.recordScore(0, 0, -1, 3), /whole numbers/);
  assert.deepEqual([t.rounds[0].matches[0].scoreA, t.rounds[0].matches[0].scoreB], [5, 5]);
  assert.throws(() => t.recordScore(0, 5, 1, 1), /No court/);
  assert.throws(() => t.recordScore(99, 0, 1, 1), /No round/);
});

test('game to 6: 6-5 ends it, no win-by-two', () => {
  const t = makeTournament(4, { target: 6 });
  assert.deepEqual(t.recordScore(0, 0, 5, 5), { over: false, winner: null });
  assert.throws(() => t.recordScore(0, 0, 7, 5), /exceed 6/);
  assert.deepEqual(t.recordScore(0, 0, 5, 6), { over: true, winner: 'B' });
  assert.equal(t.currentRoundIndex, 1);
});

test('single court (UI setting): every player count plays to completion', () => {
  for (let n = 4; n <= 24; n++) {
    const t = makeTournament(n, { courts: 1, target: 8 });
    assert.equal(t.settings.courts, 1);
    assert.equal(t.settings.rounds, defaultRounds(n));
    let rounds = 0;
    while (!t.finished) { finishRound(t, 3); rounds++; }
    assert.equal(rounds, defaultRounds(n));
    const s = t.standings();
    const byes = s.map((p) => p.byes);
    assert.ok(Math.max(...byes) - Math.min(...byes) <= 1, `n=${n} byes ${byes}`);
    s.forEach((p) => {
      assert.equal(p.played + p.byes, rounds);
      assert.equal(p.points, p.wins * 8 + (p.played - p.wins) * 3);
    });
    assert.equal(s.reduce((a, p) => a + p.points, 0), rounds * 2 * (8 + 3));
  }
});

test('full 9-player tournament plays to completion', () => {
  const t = makeTournament(9, { target: 8 });
  assert.equal(t.settings.rounds, 9);
  assert.equal(t.settings.courts, 2);
  let guard = 0;
  while (!t.finished) {
    finishRound(t, 5);
    assert.ok(++guard <= 9);
  }
  assert.equal(guard, 9);
  assert.equal(t.currentRoundIndex, -1);
  const s = t.standings();
  assert.equal(s.length, 9);
  s.forEach((p) => {
    assert.equal(p.played, 8);
    assert.equal(p.byes, 1);
    assert.equal(p.points, p.wins * 8 + (8 - p.wins) * 5);
  });
  // total points = sum over matches of 4 player-credits
  const total = s.reduce((a, p) => a + p.points, 0);
  assert.equal(total, 9 * 2 * 2 * (8 + 5));
});

// ---------------- standings ----------------

test('each player earns their team score, win or lose', () => {
  const t = makeTournament(4);
  const m = t.rounds[0].matches[0];
  t.recordScore(0, 0, 15 - 4, 9); // 11-9
  const byName = Object.fromEntries(t.standings().map((p) => [p.name, p]));
  for (const i of m.teamA) {
    assert.equal(byName[t.players[i]].points, 11);
    assert.equal(byName[t.players[i]].wins, 1);
    assert.equal(byName[t.players[i]].diff, 2);
  }
  for (const i of m.teamB) {
    assert.equal(byName[t.players[i]].points, 9);
    assert.equal(byName[t.players[i]].wins, 0);
    assert.equal(byName[t.players[i]].diff, -2);
  }
});

test('in-progress games do not count toward standings', () => {
  const t = makeTournament(4);
  t.recordScore(0, 0, 9, 4);
  t.standings().forEach((p) => {
    assert.equal(p.points, 0);
    assert.equal(p.played, 0);
  });
});

test('byesTotal is known from the start and matches the schedule', () => {
  for (const n of [5, 6, 7, 10]) {
    const t = makeTournament(n, { courts: 1 });
    const s = t.standings();
    const totals = s.map((p) => p.byesTotal);
    assert.equal(totals.reduce((a, b) => a + b, 0), t.rounds.length * (n - 4));
    assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
    s.forEach((p) => assert.equal(p.byes, 0, 'none served yet'));
    while (!t.finished) finishRound(t);
    t.standings().forEach((p) => assert.equal(p.byes, p.byesTotal, 'all served at the end'));
  }
});

test('byes in standings only count completed rounds', () => {
  const t = makeTournament(5);
  t.standings().forEach((p) => assert.equal(p.byes, 0));
  const sitter = t.players[t.rounds[0].byes[0]];
  t.recordScore(0, 0, 6, 2); // round 1 still in progress
  t.standings().forEach((p) => assert.equal(p.byes, 0));
  finishRound(t);
  t.standings().forEach((p) => assert.equal(p.byes, p.name === sitter ? 1 : 0));
});

test('before start everyone is tied at rank 1', () => {
  const t = new Tournament();
  ['A', 'B', 'C', 'D'].forEach((n) => t.addPlayer(n));
  t.standings().forEach((p) => assert.equal(p.rank, 1));
});

// Hand-built rounds so tie-breakers can be targeted precisely.
function handBuilt(players, rounds, settings) {
  return new Tournament({
    players,
    settings: Object.assign({ target: 11, courts: 1, rounds: rounds.length, seed: 1 }, settings),
    rounds: rounds.map((r) => ({
      byes: r.byes || [],
      matches: r.matches.map(([teamA, teamB, scoreA, scoreB]) => {
        const ev = evaluateScore(scoreA, scoreB, 11);
        return { teamA, teamB, scoreA, scoreB, over: ev.over, winner: ev.winner };
      }),
    })),
  });
}

test('tiebreak 2: head-to-head points between tied players', () => {
  // A(0) and B(1) both end on 20 points. In the match where they were opponents
  // A scored 11, B scored 9 -> A ranks above B even though B has the better diff.
  const t = handBuilt(['A', 'B', 'C', 'D', 'E'], [
    { byes: [4], matches: [[[0, 2], [1, 3], 11, 9]] },   // A 11, B 9
    { byes: [3], matches: [[[0, 4], [1, 2], 9, 11]] },   // A 9 (20), B 11 (20)
  ]);
  const s = t.standings();
  const a = s.find((p) => p.name === 'A');
  const b = s.find((p) => p.name === 'B');
  assert.equal(a.points, 20);
  assert.equal(b.points, 20);
  // they were opponents in BOTH matches: A h2h = 20, B h2h = 20 -> falls to diff (0 vs 0) -> byes
  assert.equal(a.h2h, 20);
  assert.equal(b.h2h, 20);
});

test('tiebreak 2: head-to-head decides when only one meeting', () => {
  // A and B tie on 22 points; met once (A 11 - B 7).
  const t = handBuilt(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], [
    { matches: [[[0, 2], [1, 3], 11, 7], [[4, 5], [6, 7], 11, 0]] },
    { matches: [[[0, 4], [2, 6], 11, 9], [[1, 5], [3, 7], 11, 2]] },
    { matches: [[[1, 6], [2, 7], 4, 11], [[0, 3], [4, 5], 0, 11]] },
  ]);
  const s = t.standings();
  const a = s.find((p) => p.name === 'A');
  const b = s.find((p) => p.name === 'B');
  assert.equal(a.points, 22);
  assert.equal(b.points, 22);
  assert.equal(a.h2h, 11);
  assert.equal(b.h2h, 7);
  assert.ok(a.rank < b.rank);
  // B actually has the better differential, proving h2h was applied first
  assert.ok(b.diff > a.diff);
});

test('tiebreak 3: point differential when tied players never met', () => {
  // A and B are never opponents; both score 11, A concedes less.
  const t = handBuilt(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], [
    { matches: [[[0, 2], [4, 5], 11, 3], [[1, 3], [6, 7], 11, 9]] },
  ]);
  const s = t.standings();
  const a = s.find((p) => p.name === 'A');
  const b = s.find((p) => p.name === 'B');
  assert.equal(a.h2h, 0);
  assert.equal(b.h2h, 0);
  assert.ok(a.rank < b.rank);
});

test('tiebreak 4: fewest byes, then a full deadlock shares the rank', () => {
  // A plays twice (11+0), E plays once (11) with one bye. Both 11 pts, diff:
  // A: 11-3 + 0-11 = -3; make E's diff equal by 11-14? impossible -> craft equal diffs instead.
  const t = handBuilt(['A', 'B', 'C', 'D', 'E'], [
    { byes: [4], matches: [[[0, 1], [2, 3], 11, 5]] },
    { byes: [0], matches: [[[4, 1], [2, 3], 11, 5]] },
  ]);
  // A: 11 pts, diff +6, 1 bye. E: 11 pts, diff +6, 1 bye -> full deadlock, shared rank.
  const s = t.standings();
  const a = s.find((p) => p.name === 'A');
  const e = s.find((p) => p.name === 'E');
  assert.equal(a.rank, e.rank);
  // B leads alone with 22
  assert.equal(s[0].name, 'B');
  assert.equal(s[0].rank, 1);
  assert.equal(a.rank, 2);
  // C and D (10 pts each, identical record) share rank 4
  const c = s.find((p) => p.name === 'C');
  const d = s.find((p) => p.name === 'D');
  assert.equal(c.rank, 4);
  assert.equal(d.rank, 4);
});

test('tiebreak 4 isolated: equal points, h2h and diff -> fewer byes ranks higher', () => {
  const P = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const [A, B, C, D, E, F, G, H, I] = P.keys();
  const t = handBuilt(P, [
    { byes: [E], matches: [[[A, B], [C, D], 11, 5], [[F, G], [H, I], 11, 0]] },
    // B sits out; A, C, D, F are simply not scheduled in this hand-built round.
    { byes: [B], matches: [[[E, G], [H, I], 11, 5]] },
  ]);
  const s = t.standings();
  const get = (n) => s.find((p) => p.name === n);
  // A, B, E: 11 pts, diff +6, never opponents of each other. A has 0 byes, B and E 1.
  for (const n of ['A', 'B', 'E']) {
    assert.equal(get(n).points, 11);
    assert.equal(get(n).diff, 6);
    assert.equal(get(n).h2h, 0);
  }
  assert.equal(get('A').byes, 0);
  assert.equal(get('G').rank, 1); // 22 pts
  assert.equal(get('F').rank, 2); // 11 pts, diff +11
  assert.equal(get('A').rank, 3);
  assert.equal(get('B').rank, 4);
  assert.equal(get('E').rank, 4); // full deadlock with B -> shared
});

// ---------------- persistence ----------------

test('toJSON/fromJSON round-trips mid-tournament state', () => {
  const t = makeTournament(6, { target: 11, courts: 1 });
  finishRound(t, 7);
  t.recordScore(1, 0, 9, 8);
  const json = JSON.stringify(t);
  const t2 = Tournament.fromJSON(json);
  assert.deepEqual(t2.toJSON(), t.toJSON());
  assert.equal(t2.currentRoundIndex, 1);
  assert.deepEqual(t2.standings(), t.standings());
  // the copy is independent
  t2.recordScore(1, 0, 11, 8);
  assert.equal(t.rounds[1].matches[0].scoreA, 9);
});

test('reset returns to setup and keeps players', () => {
  const t = makeTournament(5);
  t.reset();
  assert.equal(t.started, false);
  assert.equal(t.playerCount, 5);
  t.addPlayer('Late arrival');
  t.start();
  assert.equal(t.settings.rounds, defaultRounds(6));
});

test('roundView exposes names, byes and status', () => {
  const t = makeTournament(5);
  const v = t.roundView(0);
  assert.equal(v.round, 1);
  assert.equal(v.byes.length, 1);
  assert.equal(v.matches.length, 1);
  const names = [...v.byes, ...v.matches[0].teamA, ...v.matches[0].teamB];
  assert.deepEqual(names.sort(), ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.equal(v.matches[0].status, 'In progress');
  t.recordScore(0, 0, 4, 11);
  assert.deepEqual(t.roundView(0).matches[0].winner, v.matches[0].teamB);
});
