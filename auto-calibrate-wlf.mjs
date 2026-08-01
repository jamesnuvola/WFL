import { readFileSync, writeFileSync } from 'fs';

const DATA_FILE = 'winforlife_draws.json';
const VALIDATION_DAYS = 7;
const draws = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
draws.sort((a, b) => a.datetime.localeCompare(b.datetime));

// Configurazioni da provare
const configs = [
  { wV: 2, wH: 1, wDelay: 1, wCluster: 1 },
  { wV: 3, wH: 1, wDelay: 1, wCluster: 0.5 },
  { wV: 1, wH: 2, wDelay: 2, wCluster: 1 },
  { wV: 2, wH: 1, wDelay: 0.5, wCluster: 2 },
  // Aggiungine altre
];

let bestConfig = configs[0];
let bestScore = Infinity;

const lastValidationDraw = draws.length;
const firstValidationDraw = Math.max(0, lastValidationDraw - VALIDATION_DAYS * 17);

for (const cfg of configs) {
  let sumRank = 0;
  let count = 0;
  for (let t = firstValidationDraw; t < lastValidationDraw; t++) {
    const history = draws.slice(0, t);
    const current = draws[t];
    for (let p = 0; p < 10; p++) {
      const rank = computeRank(history, p, current.numbers[p], cfg);
      sumRank += rank;
      count++;
    }
  }
  const avgRank = sumRank / count;
  if (avgRank < bestScore) {
    bestScore = avgRank;
    bestConfig = cfg;
  }
}

writeFileSync('weights.json', JSON.stringify(bestConfig, null, 2));
console.log('Nuovi pesi:', bestConfig);
