# Pickle on Sat

A tracker for pickleball **Americano** tournaments. Add the players, play the rounds, enter the scores and watch the standings (and a 3D podium) update. It's a static site, so there's no build step and no server-side code. It runs on GitHub Pages.

## The format

- Rotating-partner doubles: partners change every round.
- Each match is played to a fixed target (6, 8 or 11). First to the target wins, with no win-by-two.
- Every player earns the points their team scored, win or lose.
- 4 to 24 players, one court per four players. Extra players sit out, with byes spread evenly.
- Rounds: n-1 for an even number of players, n for an odd number.
- Standings: total points, then head-to-head points against tied players, then point differential, then fewest byes. A full deadlock shares the rank.

## Using it

The app has three tabs:

- **Setup**: add players, pick a character for each, choose the number of courts and the target score.
- **Play**: the current round's matches. The serving team's first server is marked with the pixel ball, and live matches show a ball rallying across the court.
- **Rank**: the standings table, and a podium with the top three players' characters (1st wears a crown).

Tournaments are saved in the browser's local storage. Open the site with `?demo` (for example `index.html?demo#/scores`) to load an in-memory sample tournament that saves nothing.

## Running locally

Needs Node.js. There are no dependencies to install.

```bash
node serve.js
```

Then open <http://localhost:8123>. Set `PORT` to use another port.

## Tests

```bash
node americano.test.js
```

The tests cover the tournament engine: scheduling, scoring and tiebreaks.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | All the markup and CSS |
| `app.js` | UI logic (ES module) |
| `americano.js` | The tournament engine. Works in the browser and in Node |
| `americano.test.js` | Engine tests |
| `characters.js` | three.js rendering for the character picker and the podium scene |
| `character-list.js` | The list of characters |
| `Characters/`, `Assets/` | 3D models: characters, podium, crown and the stadium backdrop |
| `tools/stamp.js` | Cache-busting: rewrites the `?v=` on script imports |
| `serve.js` | Tiny local static server |

three.js (0.160) is loaded from a CDN through an import map in `index.html`.

## Deploying

Before pushing, run the stamp script so browsers pick up the new JavaScript:

```bash
node tools/stamp.js
```

Then push to the branch GitHub Pages serves.

## Design

Minimal, flat, dark UI with sharp corners. Fonts are Geist, Geist Mono and Geist Pixel. Riviera blue (`#1F84F2`) marks things you can act on, and yellow (`#F7F05F`) is the accent.

## Credits

The 3D characters, podium, crown and stadium in `Characters/` and `Assets/` come from [The Models Resource](https://models.spriters-resource.com/). They are third-party models, so check their terms before reusing or redistributing them.
