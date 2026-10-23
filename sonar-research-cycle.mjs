// WFL SONAR: full-history walk-forward comparison rerun after 2026-10-23 archive refresh.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const DATA = 'winforlife_draws.json';
const LOG = 'data/sonar-research-log.json';
const N = 20, PICK = 10;
const MIN_TRAIN = 1000;
const TEST_COUNT = 1200;
const HOLDOUT_COUNT = 500;
const RANDOM_REPLICATES = 20;
const ENGINE_CONFIGS = [
  { window: 10, pool: 14, strategy: 'legacy' }, { window: 20, pool: 14, strategy: 'legacy' },
  { window: 50, pool: 12, strategy: 'legacy' }, { window: 50, pool: 14, strategy: 'legacy' },
  { window: 50, pool: 16, strategy: 'legacy' }, { window: 50, pool: 20, strategy: 'legacy' },
  { window: 100, pool: 14, strategy: 'legacy' }
];

function valid(d) {
  return d && Number.isInteger(Number(d.numero)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime || '') &&
    Array.isArray(d.numbers) && d.numbers.length === PICK &&
    d.numbers.every(n => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= N) &&
    new Set(d.numbers.map(Number)).size === PICK &&
    Number.isInteger(Number(d.numerone)) && Number(d.numerone) >= 1 && Number(d.numerone) <= N;
}
function top10(scores) {
  return scores.map((v, i) => ({ n: i + 1, v }))
    .sort((a, b) => b.v - a.v || a.n - b.n).slice(0, PICK).map(x => x.n);
}
function freq(ds, key, windowSize = Infinity) {
  const f = Array(N).fill(0), start = Math.max(0, ds.length - windowSize);
  for (let i = start; i < ds.length; i++) {
    const vals = key === 'numerone' ? [Number(ds[i].numerone)] : ds[i].numbers;
    for (const n of vals) f[Number(n) - 1]++;
  }
  return f;
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function randomPick(seed) {
  const values = Array.from({ length: N }, (_, i) => i + 1), rng = seeded(seed);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values.slice(0, PICK).sort((a, b) => a - b);
}
function hits(picks, actual) {
  const set = new Set(actual.numbers.map(Number));
  return picks.reduce((sum, n) => sum + (set.has(Number(n)) ? 1 : 0), 0);
}
function summarize(values, expected = 5) {
  const n = values.length;
  if (!n) return { targets: 0, meanHits: null, expected, delta: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const se = Math.sqrt(variance / n);
  const dist = Array(11).fill(0);
  values.forEach(v => { if (Number.isInteger(v) && v >= 0 && v <= 10) dist[v]++; });
  return {
    targets: n, meanHits: Number(mean.toFixed(5)), expected,
    delta: Number((mean - expected).toFixed(5)),
    sampleSD: Number(Math.sqrt(variance).toFixed(5)),
    standardError: Number(se.toFixed(5)),
    ci95: [Number((mean - 1.96 * se).toFixed(5)), Number((mean + 1.96 * se).toFixed(5))],
    zApprox: Number((se > 0 ? (mean - expected) / se : 0).toFixed(4)),
    hitDistribution: dist
  };
}
function summarizeNumerone(hitsCount, n) {
  const p = n ? hitsCount / n : 0;
  const z = 1.96, den = 1 + z*z/n;
  const center = (p + z*z/(2*n))/den;
  const margin = z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/den;
  return {
    targets: n, hits: hitsCount, rate: Number(p.toFixed(5)), expectedRate: 0.05,
    delta: Number((p - 0.05).toFixed(5)),
    ci95: [Number(Math.max(0,center-margin).toFixed(5)), Number(Math.min(1,center+margin).toFixed(5))]
  };
}
function run() {
  const raw = JSON.parse(readFileSync(DATA, 'utf8'));
  if (!Array.isArray(raw) || !raw.length || raw.some(d => !valid(d))) throw new Error('Dataset vuoto o non valido; registro non scritto.');
  const ds = raw.map(d => ({ ...d, numbers: d.numbers.map(Number).sort((a,b)=>a-b), numerone:Number(d.numerone), numero:Number(d.numero) }))
    .sort((a,b) => a.datetime.localeCompare(b.datetime));
  const unique = new Set(ds.map(d => `${d.datetime.slice(0,4)}:${d.numero}`));
  if (unique.size !== ds.length) throw new Error('ID concorso duplicati: test interrotto senza scrivere il registro.');
  if (ds.length < MIN_TRAIN + TEST_COUNT) throw new Error(`Storico insufficiente: servono almeno ${MIN_TRAIN + TEST_COUNT} record.`);

  // The browser engine is loaded unchanged, so these tests exercise the real generator.
  globalThis.window = globalThis;
  const require = createRequire(import.meta.url);
  require('./wfl-sonar-engine.js');
  const engine = globalThis.WFLSonarEngine;
  if (!engine || typeof engine.makeCombination !== 'function') throw new Error('Motore SONAR non caricabile in Node.');

  const start = ds.length - TEST_COUNT;
  const holdoutStart = ds.length - HOLDOUT_COUNT;
  const strategyValues = new Map();
  const randomValues = { all: [], development: [], holdout: [] };
  const randomNumerone = { dev: 0, holdout: 0, all: 0 };
  const strategies = [
    { id: 'global', label: 'Frequenza globale', predict: past => top10(freq(past, 'main')) },
    { id: 'recent20', label: 'Frequenza ultime 20', predict: past => top10(freq(past, 'main', 20)) },
    { id: 'recent50', label: 'Frequenza ultime 50', predict: past => top10(freq(past, 'main', 50)) },
    { id: 'recent100', label: 'Frequenza ultime 100', predict: past => top10(freq(past, 'main', 100)) },
    { id: 'global_recent', label: 'Globale + 0,5× recent50', predict: past => top10(freq(past, 'main').map((v,i)=>v+0.5*freq(past,'main',50)[i])) }
  ];
  strategies.push({
    id: 'engine_hourrecent', label: 'SONAR nuovo motore: frequenza recente dello stesso orario',
    config: { strategy: 'hourrecent', hourWindow: 200 },
    predict: past => engine.makeCombination(past, { strategy: 'hourrecent', hourWindow: 200 })
  });
  for (const cfg of ENGINE_CONFIGS) {
    strategies.push({
      id: `engine_w${cfg.window}_p${cfg.pool}`, label: `SONAR finestra ${cfg.window}, pool ${cfg.pool}`, config: cfg,
      predict: past => engine.makeCombination(past, cfg)
    });
  }
  for (const s of strategies) strategyValues.set(s.id, { meta: { id:s.id, label:s.label, config:s.config||null }, all:[], development:[], holdout:[], numerone:{all:0,development:0,holdout:0} });

  for (let t = start; t < ds.length; t++) {
    const past = ds.slice(0, t), actual = ds[t], isHoldout = t >= holdoutStart;
    const split = isHoldout ? 'holdout' : 'development';
    for (const s of strategies) {
      const pred = s.predict(past);
      const picks = Array.isArray(pred) ? pred : pred.numbers;
      if (!Array.isArray(picks) || picks.length !== PICK) throw new Error(`Strategia ${s.id} ha prodotto una previsione non valida al target ${t}.`);
      const h = hits(picks, actual);
      const r = strategyValues.get(s.id);
      r.all.push(h); r[split].push(h);
      const num = Array.isArray(pred) ? top10(freq(past,'numerone'))[0] : Number(pred.numerone);
      if (num === actual.numerone) { r.numerone.all++; r.numerone[split]++; }
    }
    const perTarget = [];
    for (let k = 0; k < RANDOM_REPLICATES; k++) {
      const h = hits(randomPick((t * 65537 + k * 104729 + 0x51f15e) >>> 0), actual);
      perTarget.push(h);
      if (actual.numerone === Math.floor(seeded((t * 13007 + k * 8191 + 23) >>> 0)() * N) + 1) randomNumerone.all++;
    }
    const randomSplit = isHoldout ? 'holdout' : 'development';
    randomValues.all.push(...perTarget);
    randomValues[randomSplit].push(...perTarget);
    if (isHoldout) {
      for (let k = 0; k < RANDOM_REPLICATES; k++) {
        if (actual.numerone === Math.floor(seeded((t * 13007 + k * 8191 + 23) >>> 0)() * N) + 1) randomNumerone.holdout++;
      }
    } else {
      for (let k = 0; k < RANDOM_REPLICATES; k++) {
        if (actual.numerone === Math.floor(seeded((t * 13007 + k * 8191 + 23) >>> 0)() * N) + 1) randomNumerone.dev++;
      }
    }
  }
  const results = {};
  for (const [id, r] of strategyValues) {
    results[id] = {
      ...r.meta,
      all: summarize(r.all),
      development: summarize(r.development),
      holdout: summarize(r.holdout),
      numerone: {
        all: summarizeNumerone(r.numerone.all, r.all.length),
        development: summarizeNumerone(r.numerone.development, r.development.length),
        holdout: summarizeNumerone(r.numerone.holdout, r.holdout.length)
      }
    };
  }
  const randomMain = {
    all: summarize(randomValues.all),
    development: summarize(randomValues.development),
    holdout: summarize(randomValues.holdout)
  };
  const numeroneRandom = {
    all: summarizeNumerone(randomNumerone.all, TEST_COUNT * RANDOM_REPLICATES),
    development: summarizeNumerone(randomNumerone.dev, (TEST_COUNT-HOLDOUT_COUNT)*RANDOM_REPLICATES),
    holdout: summarizeNumerone(randomNumerone.holdout, HOLDOUT_COUNT*RANDOM_REPLICATES)
  };
  const sorted = Object.values(results).sort((a,b)=>b.development.delta-a.development.delta);
  const record = {
    runAt: new Date().toISOString(),
    dataset: { count:ds.length, first:ds[0].datetime, last:ds.at(-1).datetime, uniqueConcorsi:unique.size },
    protocol: {
      type:'walk-forward with chronological development/holdout split',
      minTraining:MIN_TRAIN, testTargets:TEST_COUNT, developmentTargets:TEST_COUNT-HOLDOUT_COUNT,
      holdoutTargets:HOLDOUT_COUNT, randomReplicatesPerTarget:RANDOM_REPLICATES,
      selection:'All predictions use only records strictly preceding the target. The final 500 targets are reported as holdout; no weights are automatically promoted.',
      null:{ mainMeanHits:5, mainVariancePerDraw:10*0.5*0.5*(10/19), numeroneRate:0.05 },
      cautions:['Strategies and parameter variants are exploratory and multiple comparisons can create apparent winners by chance.',
        'The holdout is a single chronological period; it is not proof of future advantage.',
        'Random controls are seeded for reproducibility; theoretical expectation remains 5 main hits and 5% Numerone.',
        'No automatic generator weights are changed by this job.']
    },
    randomControl: { main:randomMain, targets:TEST_COUNT, replicatesPerTarget:RANDOM_REPLICATES, numerone:numeroneRandom },
    results,
    exploratoryRankingByDevelopmentDelta: sorted.map((r,i)=>({rank:i+1,id:r.id,developmentDelta:r.development.delta,holdoutDelta:r.holdout.delta})),
    decision:'EXPLORATORY_ONLY'
  };
  mkdirSync('data',{recursive:true});
  let log=[];
  if(existsSync(LOG)){try{log=JSON.parse(readFileSync(LOG,'utf8'));if(!Array.isArray(log))log=[];}catch{log=[];}}
  log.push(record);
  writeFileSync(LOG,JSON.stringify(log,null,2)+'\n');
  console.log(JSON.stringify(record,null,2));
}
run();
