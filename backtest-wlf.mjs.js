import { readFileSync } from 'fs';

const DATA_FILE = 'winforlife_draws.json';
const POSITIONS = 10;
const NUM_COUNT = 20;

// Copia qui le tue funzioni di scoring (hotScores, delayScores, halfScores,
// clusterScores, volatilityScores, coldHScores, compositeScores, rankedCandidates)
// (Le hai già nell'app; le riporto per completezza nell'esempio ma nel file
// definitivo le includerò interamente.)

function computeRank(history, position, actualNumber) {
  const scores = compositeScores(history, position, { wV:2, wH:1, wDelay:1, wCluster:1 });
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const idx = sorted.findIndex(([n]) => n === actualNumber);
  return idx >= 0 ? idx + 1 : sorted.length + 1;
}

const draws = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
draws.sort((a, b) => a.datetime.localeCompare(b.datetime));

const minHistory = 200;
const ranks = Array.from({ length: POSITIONS }, () => []);

for (let t = minHistory; t < draws.length; t++) {
  const history = draws.slice(0, t);
  const current = draws[t];
  for (let p = 0; p < POSITIONS; p++) {
    const rank = computeRank(history, p, current.numbers[p]);
    ranks[p].push(rank);
  }
}

console.log('=== BACKTEST RISULTATI ===');
for (let p = 0; p < POSITIONS; p++) {
  const r = ranks[p].sort((a, b) => a - b);
  const median = r[Math.floor(r.length / 2)];
  const p25 = r[Math.floor(r.length * 0.25)];
  const p75 = r[Math.floor(r.length * 0.75)];
  console.log(`P${p + 1}: mediana=${median}, 25°=${p25}, 75°=${p75}`);
}