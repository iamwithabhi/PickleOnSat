/*
 * Pickleball Americano tournament engine.
 *
 * Format (per https://getrnkd.app/guides/pickleball-americano-format):
 *  - Rotating-partner doubles; partners change every round.
 *  - Each match is played to a fixed target (6 / 8 / 11); first to the target wins (no win-by-two).
 *  - Every player earns the points their team scored, win or lose.
 *  - Standings: total points, then head-to-head points vs tied players,
 *    then point differential, then fewest byes. Full deadlock shares the rank.
 *  - 4..24 players, 1 court per 4 players, extra players sit out (byes spread evenly).
 *  - Rounds: n-1 for an even player count, n for an odd count.
 *
 * Works in the browser (window.Americano) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Americano = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 24;
  const ALLOWED_TARGETS = [6, 8, 11];

  // ---------- helpers ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function matrix(n) {
    return Array.from({ length: n }, () => new Array(n).fill(0));
  }

  function isInt(v) {
    return typeof v === 'number' && Number.isInteger(v);
  }

  function defaultRounds(n) {
    return n % 2 === 0 ? n - 1 : n;
  }

  function maxCourts(n) {
    return Math.floor(n / 4);
  }

  function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
  }

  /** Rounds must be a multiple of this for every player to sit out equally (1 when nobody sits out). */
  function sitOutStep(n, courts) {
    courts = courts == null ? maxCourts(n) : courts;
    const sitOut = n - courts * 4;
    return sitOut === 0 ? 1 : n / gcd(n, sitOut);
  }

  /**
   * Round count closest to `around` (default: the standard count) for which every
   * player sits out the same number of times. Ties prefer more rounds.
   */
  function equalSitOutRounds(n, courts, around) {
    courts = courts == null ? maxCourts(n) : courts;
    around = around == null ? defaultRounds(n) : around;
    const sitOut = n - courts * 4;
    if (sitOut === 0) return around;
    const step = sitOutStep(n, courts);
    const below = Math.floor(around / step) * step;
    const above = below === around ? around : below + step;
    if (below === 0) return above;
    return around - below < above - around ? below : above;
  }

  /** Smallest and largest per-player sit-out counts for a given setup. */
  function sitOutSpread(n, courts, rounds) {
    const total = rounds * (n - courts * 4);
    return { min: Math.floor(total / n), max: Math.ceil(total / n) };
  }

  // ---------- scheduling ----------

  // Circle-method 1-factorization: for m points (m even) returns m-1 rounds,
  // each a list of m/2 pairs, covering every pair exactly once.
  function circleRounds(m) {
    const rounds = [];
    const others = [];
    for (let i = 1; i < m; i++) others.push(i);
    for (let r = 0; r < m - 1; r++) {
      const ring = [0].concat(others);
      const pairs = [];
      for (let i = 0; i < m / 2; i++) pairs.push([ring[i], ring[m - 1 - i]]);
      rounds.push(pairs);
      others.unshift(others.pop());
    }
    return rounds;
  }

  // Pair up partnerships into matches minimising repeated opponents.
  // Exhaustive search with pruning (at most 12 pairs -> 10395 matchings).
  function pairTeams(teams, opp) {
    const cost = (t1, t2) =>
      opp[t1[0]][t2[0]] + opp[t1[0]][t2[1]] + opp[t1[1]][t2[0]] + opp[t1[1]][t2[1]];
    let best = null;
    let bestCost = Infinity;
    const used = new Array(teams.length).fill(false);
    const cur = [];
    (function rec(acc) {
      if (acc >= bestCost) return;
      let i = used.indexOf(false);
      if (i === -1) {
        bestCost = acc;
        best = cur.slice();
        return;
      }
      used[i] = true;
      for (let j = i + 1; j < teams.length; j++) {
        if (used[j]) continue;
        used[j] = true;
        cur.push([teams[i], teams[j]]);
        rec(acc + cost(teams[i], teams[j]));
        cur.pop();
        used[j] = false;
      }
      used[i] = false;
    })(0);
    return best;
  }

  // Greedy + local-search matching of active players into partnerships,
  // minimising repeated partners.
  function pickPartners(active, partner, rand) {
    let best = null;
    let bestCost = Infinity;
    for (let attempt = 0; attempt < 30 && bestCost > 0; attempt++) {
      const pool = shuffle(active, rand);
      const pairs = [];
      while (pool.length) {
        const a = pool.shift();
        let bi = 0;
        for (let k = 1; k < pool.length; k++) {
          if (partner[a][pool[k]] < partner[a][pool[bi]]) bi = k;
        }
        pairs.push([a, pool.splice(bi, 1)[0]]);
      }
      // 2-opt: swap members between pairs while it lowers cost
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < pairs.length; i++) {
          for (let j = i + 1; j < pairs.length; j++) {
            const [a, b] = pairs[i];
            const [c, d] = pairs[j];
            const now = partner[a][b] + partner[c][d];
            if (partner[a][c] + partner[b][d] < now) {
              pairs[i] = [a, c]; pairs[j] = [b, d]; improved = true;
            } else if (partner[a][d] + partner[b][c] < now) {
              pairs[i] = [a, d]; pairs[j] = [b, c]; improved = true;
            }
          }
        }
      }
      const c = pairs.reduce((s, [a, b]) => s + partner[a][b], 0);
      if (c < bestCost) { bestCost = c; best = pairs; }
    }
    return best;
  }

  /**
   * Build a schedule of player indices.
   * Returns [{ byes: [idx], matches: [{ teamA: [i,j], teamB: [k,l] }] }]
   */
  function generateSchedule(n, opts) {
    opts = opts || {};
    if (!isInt(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
      throw new Error(`Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
    }
    const courts = opts.courts == null ? maxCourts(n) : opts.courts;
    if (!isInt(courts) || courts < 1 || courts > maxCourts(n)) {
      throw new Error(`Courts must be between 1 and ${maxCourts(n)} for ${n} players`);
    }
    const rounds = opts.rounds == null ? defaultRounds(n) : opts.rounds;
    if (!isInt(rounds) || rounds < 1 || rounds > 100) {
      throw new Error('Rounds must be an integer between 1 and 100');
    }
    const rand = mulberry32(opts.seed == null ? 1 : opts.seed);
    const attempts = opts.attempts == null ? 40 : opts.attempts;

    // Each round is chosen greedily, so build several full schedules and keep the
    // fairest: fewest repeat partners first, then the most even opponent spread.
    let best = null;
    let bestCost = Infinity;
    for (let k = 0; k < attempts; k++) {
      const { schedule, partner, opp } = buildSchedule(n, courts, rounds, rand);
      let cost = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) cost += partner[i][j] * partner[i][j] * 1000 + opp[i][j] * opp[i][j];
      }
      if (cost < bestCost) { bestCost = cost; best = schedule; }
    }
    return best;
  }

  function buildSchedule(n, courts, rounds, rand) {
    const active = courts * 4;
    const sitOut = n - active;

    const partner = matrix(n);
    const opp = matrix(n);
    const byeCount = new Array(n).fill(0);
    const lastBye = new Array(n).fill(-1);

    // Perfect rotation available: every player plays each round (n % 4 == 0),
    // or exactly one sits out (n % 4 == 1) -> circle method on n or n+1 points.
    let circle = null;
    if (sitOut === 0 && n % 4 === 0) circle = { m: n, dummy: -1 };
    else if (sitOut === 1 && n % 4 === 1) circle = { m: n + 1, dummy: n };
    let circleSched = null;
    if (circle) {
      // relabel players randomly so seeds produce different (still perfect) draws
      const perm = shuffle([...Array(n).keys()], rand);
      circleSched = circleRounds(circle.m).map((pairs) =>
        pairs.map(([a, b]) => [a === circle.dummy ? -1 : perm[a], b === circle.dummy ? -1 : perm[b]])
      );
    }

    const out = [];
    for (let r = 0; r < rounds; r++) {
      let byes;
      let teams;
      if (circleSched) {
        const pairs = circleSched[r % circleSched.length];
        byes = [];
        teams = [];
        for (const [a, b] of pairs) {
          if (a === -1) byes.push(b);
          else if (b === -1) byes.push(a);
          else teams.push([a, b]);
        }
      } else {
        // Byes go to those with the fewest byes so far (keeps the spread ≤ 1). Within
        // that tier, try a few choices and keep the one allowing the fewest repeat
        // partners, avoiding back-to-back byes.
        const tries = sitOut === 0 ? 1 : 12;
        let bestCost = Infinity;
        for (let t = 0; t < tries; t++) {
          const order = shuffle([...Array(n).keys()], rand).sort((a, b) => byeCount[a] - byeCount[b]);
          const sit = order.slice(0, sitOut);
          const pairs = pickPartners(order.slice(sitOut), partner, rand);
          let cost = pairs.reduce((s, [a, b]) => s + partner[a][b], 0) * 10;
          cost += sit.filter((p) => r > 0 && lastBye[p] === r - 1).length;
          if (cost < bestCost) { bestCost = cost; byes = sit; teams = pairs; }
        }
      }
      const matches = pairTeams(teams, opp).map(([t1, t2]) => ({
        teamA: t1.slice(),
        teamB: t2.slice(),
      }));
      for (const p of byes) { byeCount[p]++; lastBye[p] = r; }
      for (const m of matches) {
        const [a, b] = m.teamA;
        const [c, d] = m.teamB;
        partner[a][b]++; partner[b][a]++;
        partner[c][d]++; partner[d][c]++;
        for (const x of m.teamA) for (const y of m.teamB) { opp[x][y]++; opp[y][x]++; }
      }
      out.push({ byes: byes.sort((a, b) => a - b), matches });
    }
    return { schedule: out, partner, opp };
  }

  // ---------- scoring rules ----------

  /**
   * Validate a score and say whether the game is over.
   * Returns { valid, over, winner: 'A'|'B'|null, error }
   */
  function evaluateScore(a, b, target) {
    if (!isInt(a) || !isInt(b) || a < 0 || b < 0) {
      return { valid: false, over: false, winner: null, error: 'Scores must be whole numbers ≥ 0' };
    }
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    const winner = a > b ? 'A' : b > a ? 'B' : null;
    if (hi > target) return { valid: false, over: false, winner: null, error: `Score cannot exceed ${target}` };
    if (hi === target && lo === target) return { valid: false, over: false, winner: null, error: 'Both teams cannot reach the target' };
    if (hi === target) return { valid: true, over: true, winner, error: null };
    return { valid: true, over: false, winner: null, error: null };
  }

  /**
   * Simulate the rest of a game rally by rally, starting from the current score.
   * Returns every intermediate score ([a, b], one point per step) up to game over;
   * empty if the game is already over.
   */
  function simulateGame(a, b, target, rand) {
    rand = rand || Math.random;
    const ev = evaluateScore(a, b, target);
    if (!ev.valid) throw new Error(ev.error);
    const steps = [];
    while (Math.max(a, b) < target) {
      if (rand() < 0.5) a++;
      else b++;
      steps.push([a, b]);
    }
    return steps;
  }

  // ---------- tournament ----------

  class Tournament {
    constructor(state) {
      this.players = [];
      this.settings = { target: 11, courts: null, rounds: null, seed: null };
      this.rounds = null; // null until started
      if (state) Object.assign(this, JSON.parse(JSON.stringify(state)));
    }

    static fromJSON(json) {
      const s = typeof json === 'string' ? JSON.parse(json) : json;
      return new Tournament(s);
    }

    toJSON() {
      return { players: this.players, settings: this.settings, rounds: this.rounds };
    }

    get started() {
      return this.rounds !== null;
    }

    get playerCount() {
      return this.players.length;
    }

    // ----- players -----

    addPlayer(name) {
      if (this.started) throw new Error('Cannot add players after the tournament has started');
      if (typeof name !== 'string') throw new Error('Name must be a string');
      const clean = name.trim().replace(/\s+/g, ' ');
      if (!clean) throw new Error('Name cannot be empty');
      if (clean.length > 40) throw new Error('Name is too long (max 40 characters)');
      if (this.players.some((p) => p.toLowerCase() === clean.toLowerCase())) {
        throw new Error(`"${clean}" is already added`);
      }
      if (this.players.length >= MAX_PLAYERS) throw new Error(`Maximum ${MAX_PLAYERS} players`);
      this.players.push(clean);
      return clean;
    }

    removePlayer(name) {
      if (this.started) throw new Error('Cannot remove players after the tournament has started');
      const i = this.players.findIndex((p) => p.toLowerCase() === String(name).trim().toLowerCase());
      if (i === -1) throw new Error(`No player named "${name}"`);
      this.players.splice(i, 1);
    }

    // ----- setup -----

    configure(opts) {
      if (this.started) throw new Error('Cannot change settings after the tournament has started');
      const s = Object.assign({}, this.settings, opts);
      if (!ALLOWED_TARGETS.includes(s.target)) {
        throw new Error(`Target must be one of ${ALLOWED_TARGETS.join(', ')}`);
      }
      this.settings = s;
    }

    start() {
      if (this.started) throw new Error('Tournament already started');
      const n = this.players.length;
      if (n < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players (have ${n})`);
      const seed = this.settings.seed == null ? Math.floor(Math.random() * 2 ** 31) : this.settings.seed;
      this.settings.seed = seed;
      const sched = generateSchedule(n, {
        courts: this.settings.courts,
        rounds: this.settings.rounds,
        seed,
      });
      this.settings.courts = sched[0].matches.length;
      this.settings.rounds = sched.length;
      this.rounds = sched.map((r) => ({
        byes: r.byes,
        matches: r.matches.map((m) => ({
          teamA: m.teamA, teamB: m.teamB, scoreA: 0, scoreB: 0, over: false, winner: null,
        })),
      }));
    }

    reset() {
      this.rounds = null;
      this.settings.seed = null;
    }

    // ----- play -----

    _match(roundIdx, courtIdx) {
      if (!this.started) throw new Error('Tournament has not started');
      const r = this.rounds[roundIdx];
      if (!r) throw new Error(`No round ${roundIdx + 1}`);
      const m = r.matches[courtIdx];
      if (!m) throw new Error(`No court ${courtIdx + 1} in round ${roundIdx + 1}`);
      return m;
    }

    /** Record (or correct) a score. Game-over is derived from the rules. */
    recordScore(roundIdx, courtIdx, scoreA, scoreB) {
      const m = this._match(roundIdx, courtIdx);
      const cur = this.currentRoundIndex;
      if (cur !== -1 && roundIdx > cur) {
        throw new Error(`Round ${roundIdx + 1} has not started yet (round ${cur + 1} is in play)`);
      }
      const ev = evaluateScore(scoreA, scoreB, this.settings.target);
      if (!ev.valid) throw new Error(ev.error);
      m.scoreA = scoreA;
      m.scoreB = scoreB;
      m.over = ev.over;
      m.winner = ev.winner;
      return { over: ev.over, winner: ev.winner };
    }

    isRoundComplete(roundIdx) {
      this._match(roundIdx, 0);
      return this.rounds[roundIdx].matches.every((m) => m.over);
    }

    /** Index of the round in play, or -1 when every round is finished (or not started). */
    get currentRoundIndex() {
      if (!this.started) return -1;
      return this.rounds.findIndex((r) => r.matches.some((m) => !m.over));
    }

    get finished() {
      return this.started && this.currentRoundIndex === -1;
    }

    /** Human-friendly view of a round with names. */
    roundView(roundIdx) {
      const r = this.rounds[roundIdx];
      if (!r) throw new Error(`No round ${roundIdx + 1}`);
      const nm = (i) => this.players[i];
      return {
        round: roundIdx + 1,
        complete: r.matches.every((m) => m.over),
        byes: r.byes.map(nm),
        matches: r.matches.map((m, c) => ({
          court: c + 1,
          teamA: m.teamA.map(nm),
          teamB: m.teamB.map(nm),
          scoreA: m.scoreA,
          scoreB: m.scoreB,
          over: m.over,
          status: m.over ? 'Game over' : 'In progress',
          winner: m.winner === 'A' ? m.teamA.map(nm) : m.winner === 'B' ? m.teamB.map(nm) : null,
        })),
      };
    }

    // ----- standings -----

    standings() {
      const st = this.players.map((name, i) => ({
        index: i, name, points: 0, conceded: 0, diff: 0, played: 0, wins: 0, byes: 0, byesTotal: 0,
      }));
      const done = []; // completed matches, for head-to-head
      if (this.started) {
        for (const r of this.rounds) {
          // byesTotal: fixed by the draw at start. byes: only those already served
          // (round complete) — this is what the tie-breaker uses.
          for (const p of r.byes) st[p].byesTotal++;
          if (r.matches.every((m) => m.over)) for (const p of r.byes) st[p].byes++;
          for (const m of r.matches) {
            if (!m.over) continue;
            done.push(m);
            const sides = [[m.teamA, m.scoreA, m.teamB, m.scoreB, 'A'], [m.teamB, m.scoreB, m.teamA, m.scoreA, 'B']];
            for (const [team, pts, other, against, side] of sides) {
              for (const p of team) {
                st[p].points += pts;
                st[p].conceded += against;
                st[p].played++;
                if (m.winner === side) st[p].wins++;
              }
            }
          }
        }
      }
      for (const s of st) s.diff = s.points - s.conceded;

      // group by points, break ties within the group
      st.sort((a, b) => b.points - a.points);
      const result = [];
      let i = 0;
      while (i < st.length) {
        let j = i;
        while (j < st.length && st[j].points === st[i].points) j++;
        const group = st.slice(i, j);
        // head-to-head: points scored in matches where another tied player was an opponent
        const ids = new Set(group.map((g) => g.index));
        for (const g of group) {
          g.h2h = 0;
          for (const m of done) {
            const onA = m.teamA.includes(g.index);
            const onB = m.teamB.includes(g.index);
            if (!onA && !onB) continue;
            const opponents = onA ? m.teamB : m.teamA;
            if (opponents.some((o) => ids.has(o))) g.h2h += onA ? m.scoreA : m.scoreB;
          }
        }
        group.sort((a, b) => b.h2h - a.h2h || b.diff - a.diff || a.byes - b.byes || a.name.localeCompare(b.name));
        result.push(...group);
        i = j;
      }
      // shared rank only on a full four-tier deadlock
      result.forEach((s, k) => {
        const prev = result[k - 1];
        const tied = prev && prev.points === s.points && prev.h2h === s.h2h && prev.diff === s.diff && prev.byes === s.byes;
        s.rank = tied ? prev.rank : k + 1;
      });
      return result.map(({ index, ...rest }) => rest);
    }
  }

  return {
    Tournament,
    generateSchedule,
    evaluateScore,
    simulateGame,
    mulberry32,
    defaultRounds,
    equalSitOutRounds,
    sitOutStep,
    sitOutSpread,
    maxCourts,
    MIN_PLAYERS,
    MAX_PLAYERS,
    ALLOWED_TARGETS,
  };
});
