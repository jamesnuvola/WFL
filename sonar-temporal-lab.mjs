import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA = 'winforlife_draws.json';
const LOG = 'data/sonar-temporal-log.json';
const PICK = 10, N = 20, TEST_COUNT = 1200, MIN_BUCKET_TRAIN = 80;

function valid(d) {
  return d && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime || '') &&
    Array.isArray(d.numbers) && d.numbers.length === PICK &&
    d.numbers.every(n => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= N) &&
    new Set(d.numbers.map(Number)).size === PICK &&
    Number.isInteger(Number(d.numerone)) && Number(d.numerone) >= 1 && Number(d.numerone) <= N;
}
function top10(scores) {
  return scores.map((v, i) => ({ n: i + 1, v }))
    .sort((a, b) => b.v - a.v || a.n - b.n).slice(0, PICK).map(x => x.n);
}
function counts(ds) {
  const c = Array(N).fill(0);
  for (const d of ds) for (const n of d.numbers) c[n - 1]++;
  return c;
}
function hits(picks, actual) {
  const set = new Set(actual.numbers);
  return picks.reduce((s, n) => s + (set.has(n) ? 1 : 0), 0);
}
function summarize(values) {
  const n = values.length;
  if (!n) return { targets: 0, meanHits: null, expected: 5, delta: null, ci95: null };
  const mean = values.reduce((a,b)=>a+b,0)/n;
  const variance = values.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,n-1);
  const se = Math.sqrt(variance/n);
  return { targets:n, meanHits:+mean.toFixed(5), expected:5, delta:+(mean-5).toFixed(5),
    standardError:+se.toFixed(5), ci95:[+(mean-1.96*se).toFixed(5), +(mean+1.96*se).toFixed(5)] };
}
function hour(d) { return Number(d.datetime.slice(11,13)); }
function weekday(d) { return new Date(d.datetime + ':00').getUTCDay(); }
function month(d) { return d.datetime.slice(0,7); }
function day(d) { return d.datetime.slice(0,10); }
function epoch(d) { return Date.parse(d.datetime + ':00Z'); }
function bucketKey(d, kind) {
  if (kind === 'hour') return String(hour(d));
  if (kind === 'weekday') return String(weekday(d));
  if (kind === 'month') return month(d).slice(5,7);
  return day(d);
}
function overlap(a,b) {
  const set = new Set(a);
  return b.reduce((n,x)=>n+(set.has(x)?1:0),0);
}
function run() {
  const raw = JSON.parse(readFileSync(DATA,'utf8'));
  if (!Array.isArray(raw) || !raw.length || raw.some(d=>!valid(d))) throw new Error('Dataset vuoto o non valido; laboratorio temporale interrotto.');
  const ds = raw.map(d=>({...d, numbers:d.numbers.map(Number).sort((a,b)=>a-b), numerone:Number(d.numerone)}))
    .sort((a,b)=>a.datetime.localeCompare(b.datetime));
  for (let i=1;i<ds.length;i++) if (ds[i].datetime===ds[i-1].datetime) throw new Error('Timestamp duplicato; laboratorio temporale interrotto.');
  if (ds.length < 1500) throw new Error('Storico insufficiente per il laboratorio temporale.');

  const start = Math.max(1000, ds.length-TEST_COUNT);
  const methods = {};
  function add(id,label) { methods[id]={label,all:[],development:[],holdout:[]}; }
  add('global','Frequenza globale storica');
  for (const w of [3,5,10,20,50,100]) add('recent'+w, 'Frequenza ultime '+w+' estrazioni');
  for (const kind of ['hour','weekday','month']) add('calendar_'+kind, 'Frequenza storica condizionata: '+kind);
  for (const kind of ['hour','weekday','month']) add('calendar_recent_'+kind, 'Frequenza condizionata '+kind+' con priorità ai dati recenti');
  add('intraday3','Micro-trend: ultime 3 estrazioni della stessa giornata');
  add('intraday5','Micro-trend: ultime 5 estrazioni della stessa giornata');
  add('intraday10','Micro-trend: ultime 10 estrazioni della stessa giornata');
  for (const w of [6,24,72,168,720]) add('rolling'+w+'h','Frequenza mobile ultime '+w+' ore');
  add('analog_exact','Sequenza analoga: successore storico di estrazione precedente identica');
  add('analog_near8','Sequenza analoga: successore storico della precedente più simile (overlap >= 8/10)');

  const seqSamples = { exact:0, near8:0, near9:0, exactOccurrences:0, nearOccurrences:0 };
  const conditionalCounts = {};
  for (let t=start;t<ds.length;t++) {
    const past=ds.slice(0,t), actual=ds[t], split=t>=ds.length-500?'holdout':'development';
    const globalPick=top10(counts(past));
    const candidates = [];
    candidates.push(['global',globalPick]);
    for (const w of [3,5,10,20,50,100]) candidates.push(['recent'+w,top10(counts(past.slice(-w)))]);
    for (const kind of ['hour','weekday','month']) {
      const key=bucketKey(actual,kind);
      const same=past.filter(d=>bucketKey(d,kind)===key);
      conditionalCounts[kind] ??= {};
      conditionalCounts[kind][key] = same.length;
      if (same.length >= MIN_BUCKET_TRAIN) {
        candidates.push(['calendar_'+kind,top10(counts(same))]);
        const recent=same.slice(-Math.min(same.length,200));
        candidates.push(['calendar_recent_'+kind,top10(counts(recent))]);
      }
    }
    const sameDay=past.filter(d=>day(d)===day(actual));
    for (const w of [3,5,10]) if (sameDay.length>=w) candidates.push(['intraday'+w,top10(counts(sameDay.slice(-w)))]);
    const targetTime=epoch(actual);
    for (const w of [6,24,72,168,720]) {
      const recent=past.filter(d=>targetTime-epoch(d)<=w*60*60*1000);
      if (recent.length>=10) candidates.push(['rolling'+w+'h',top10(counts(recent))]);
    }
    // Analogue search: only prior occurrences whose successor is strictly before the target.
    const prev=ds[t-1];
    let exactJ=-1, bestJ=-1, bestOverlap=0, exactN=0, nearN=0;
    for (let j=0;j<t-1;j++) {
      const ov=overlap(prev.numbers,ds[j].numbers);
      if (ov===10) { exactN++; if(j>exactJ) exactJ=j; }
      if (ov>=8) { nearN++; if(ov>bestOverlap || (ov===bestOverlap && j>bestJ)){bestOverlap=ov;bestJ=j;} }
    }
    if (exactJ>=0) {
      candidates.push(['analog_exact',ds[exactJ+1].numbers]);
      seqSamples.exact++; seqSamples.exactOccurrences+=exactN;
    }
    if (bestJ>=0) {
      candidates.push(['analog_near8',ds[bestJ+1].numbers]);
      seqSamples.near8++; seqSamples.nearOccurrences+=nearN;
      if(bestOverlap>=9) seqSamples.near9++;
    }
    for (const [id,picks] of candidates) {
      if (!methods[id]) continue;
      const h=hits(picks,actual);
      methods[id].all.push(h); methods[id][split].push(h);
    }
  }
  const results={};
  for(const [id,m] of Object.entries(methods)) {
    results[id]={label:m.label,all:summarize(m.all),development:summarize(m.development),holdout:summarize(m.holdout)};
  }

  // Descriptive calendar frequencies: these are diagnostics, not predictive claims.
  const calendar={};
  for(const kind of ['hour','weekday','month']) {
    calendar[kind]={};
    const keys=[...new Set(ds.map(d=>bucketKey(d,kind)))].sort((a,b)=>Number(a)-Number(b));
    for(const key of keys) {
      const group=ds.filter(d=>bucketKey(d,kind)===key);
      const c=counts(group);
      calendar[kind][key]={draws:group.length,expectedNumberAppearancesPerNumber:group.length*PICK/N,
        topNumbers:top10(c),countsByNumber:c};
    }
  }
  const record={
    runAt:new Date().toISOString(),
    dataset:{count:ds.length,first:ds[0].datetime,last:ds.at(-1).datetime},
    protocol:{
      type:'chronological walk-forward temporal and analogue study',
      evaluationTargets:ds.length-start,developmentTargets:Math.max(0,ds.length-start-500),holdoutTargets:Math.min(500,ds.length-start),
      minBucketTraining:MIN_BUCKET_TRAIN,
      safeguards:[
        'Every prediction uses only records strictly before its target.',
        'Calendar-conditioned methods are skipped until at least 80 matching historical draws exist.',
        'Intraday methods only use earlier draws from the same calendar date.',
        'Analogue successors are strictly earlier than the target; the target itself is never used to form its forecast.',
        'Many exploratory comparisons create multiple-testing risk; confidence intervals are descriptive and do not prove advantage.',
        'No generator weights or production settings are changed by this job.'
      ]
    },
    calendarDescriptive:calendar,
    calendarTrainingCountsObserved:conditionalCounts,
    repeatedSequenceAnalogs:seqSamples,
    strategyResults:results,
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
