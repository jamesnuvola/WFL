/* WFL SONAR Engine v1 — standalone, game-specific, walk-forward safe.
 * Descriptive signals are hypotheses, not claims of predictive advantage.
 * Main draw: 10 distinct numbers from 1..20; Numerone is a separate 1..20 draw.
 */
(function (root) {
  "use strict";
  const N = 20;
  const WINDOWS = [10, 20, 50, 100];

  function validDraw(d) {
    return !!d && Array.isArray(d.numbers) && d.numbers.length === 10 &&
      d.numbers.every(n => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= N) &&
      new Set(d.numbers.map(Number)).size === 10 &&
      Number.isInteger(Number(d.numerone)) && Number(d.numerone) >= 1 && Number(d.numerone) <= N;
  }
  function cleanHistory(history) {
    return (Array.isArray(history) ? history : []).filter(validDraw).map(d => ({
      numbers: d.numbers.map(Number), numerone: Number(d.numerone),
      datetime: d.datetime || "", numero: d.numero == null ? null : Number(d.numero)
    }));
  }
  function counts(hist, key) {
    const out = Array(N).fill(0);
    hist.forEach(d => {
      const vals = key === "numerone" ? [d.numerone] : d.numbers;
      vals.forEach(n => out[n - 1]++);
    });
    return out;
  }
  function zScores(values) {
    const mean = values.reduce((a,b)=>a+b,0) / Math.max(1, values.length);
    const variance = values.reduce((a,v)=>a+(v-mean)*(v-mean),0) / Math.max(1, values.length);
    const sd = Math.sqrt(variance);
    return values.map(v => sd > 1e-9 ? (v-mean)/sd : 0);
  }
  function rankNumbers(hist, opts) {
    const cfg = Object.assign({window:10, recentWeight:0.35, delayWeight:0.15, transitionWeight:0.15, pairWeight:0.1}, opts || {});
    const recent = hist.slice(-Math.max(1, Math.min(100, cfg.window)));
    const medium = hist.slice(-Math.min(50, hist.length));
    const long = hist.slice(-Math.min(100, hist.length));
    const fR = counts(recent, "main"), fM = counts(medium, "main"), fL = counts(long, "main");
    const zR = zScores(fR), zM = zScores(fM), zL = zScores(fL);
    const lastSeen = Array(N).fill(-1);
    hist.forEach((d,i)=>d.numbers.forEach(n=>{lastSeen[n-1]=i;}));
    const delay = lastSeen.map(i=>i < 0 ? hist.length : hist.length-1-i);
    const delayZ = zScores(delay.map(x=>Math.min(x, 30)));
    const transition = Array(N).fill(0);
    if (hist.length >= 2) {
      const prev = new Set(hist[hist.length-1].numbers);
      const prev2 = hist.length >= 2 ? new Set(hist[hist.length-2].numbers) : new Set();
      for(let n=1;n<=N;n++) {
        let s=0;
        if(prev.has(n)) s += 1;
        if(prev2.has(n)) s += 0.5;
        transition[n-1]=s;
      }
    }
    const pair = Array(N).fill(0);
    if (hist.length >= 2) {
      const prior = new Set(hist[hist.length-1].numbers);
      const recentPair = hist.slice(-Math.min(20,hist.length));
      for(let n=1;n<=N;n++) {
        let co=0, denom=0;
        recentPair.forEach(d => {
          if(d.numbers.includes(n)) {
            denom++;
            if(d.numbers.some(v=>prior.has(v) && v!==n)) co++;
          }
        });
        pair[n-1]=denom ? co/denom : 0;
      }
    }
    const zT = zScores(transition), zP = zScores(pair);
    const scores = Array.from({length:N},(_,i)=>({
      number:i+1,
      score: 0.40*zL[i] + cfg.recentWeight*zR[i] + 0.10*zM[i] +
        cfg.delayWeight*delayZ[i] + cfg.transitionWeight*zT[i] + cfg.pairWeight*zP[i],
      longFreq:fL[i], recentFreq:fR[i], delay:delay[i]
    }));
    return scores.sort((a,b)=>b.score-a.score || a.number-b.number);
  }
  function makeCombination(history, opts) {
    const hist = cleanHistory(history);
    if(hist.length < 10) return {error:"Servono almeno 10 estrazioni valide."};
    const cfg = Object.assign({window:10, pool:14, diversity:true, seed:null}, opts || {});
    const ranked = rankNumbers(hist, cfg);
    const poolSize = Math.max(10, Math.min(20, Number(cfg.pool)||14));
    const pool = ranked.slice(0,poolSize);
    // Diversify by weighted sampling without replacement; no position assumption.
    let seed = Number.isFinite(cfg.seed) ? Math.abs(Math.floor(cfg.seed)) : (hist.length*7919 + (hist[hist.length-1].numero||1)*104729);
    const rng = () => { seed = (seed*1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const weightedPick = items => {
      const min = Math.min(...items.map(x=>x.score));
      const weights = items.map(x=>Math.exp(Math.max(-4,Math.min(4,x.score-min+0.15))));
      let r=rng()*weights.reduce((a,b)=>a+b,0);
      for(let i=0;i<items.length;i++){r-=weights[i];if(r<=0)return items[i];}
      return items[items.length-1];
    };
    const selected=[];
    while(selected.length<10 && pool.length) {
      const picked=weightedPick(pool);
      selected.push(picked.number);
      pool.splice(pool.findIndex(x=>x.number===picked.number),1);
    }
    selected.sort((a,b)=>a-b);
    // Numerone is independent: analyze its own history, never reuse main-number counts.
    const nr = counts(hist,"numerone");
    const nrZ = zScores(nr);
    const lastN = Array(N).fill(-1);
    hist.forEach((d,i)=>{lastN[d.numerone-1]=i;});
    const numScores = nr.map((v,i)=>({number:i+1, score:0.75*nrZ[i]+0.25*zScores(lastN.map(j=>j<0?hist.length:hist.length-1-j))[i], frequency:v, delay:lastN[i]<0?hist.length:hist.length-1-lastN[i]}));
    numScores.sort((a,b)=>b.score-a.score || a.number-b.number);
    return {
      numbers:selected, numerone:numScores[0].number,
      ranked, mainScores:ranked,
      numeroneScores:numScores, poolSize:cfg.pool,
      note:"Punteggi esplorativi: non rappresentano probabilità reali né garantiscono vantaggi sul caso."
    };
  }
  function scorePrediction(pred, actual) {
    const set = new Set(actual.numbers.map(Number));
    return {hits:pred.numbers.filter(n=>set.has(n)).length, numeroneHit:pred.numerone===Number(actual.numerone)};
  }
  function backtest(history, opts) {
    const hist=cleanHistory(history);
    const cfg=Object.assign({train:100, test:100, window:50, pool:14, maxSteps:300},opts||{});
    const minTrain=Math.max(10,Number(cfg.train)||100);
    const available=Math.max(0,hist.length-minTrain);
    const steps=Math.min(available,Math.max(1,Number(cfg.test)||100),Math.max(1,Number(cfg.maxSteps)||300));
    if(steps<10) return {error:"Servono almeno 10 estrazioni di test dopo il training.", validHistory:hist.length};
    const start=hist.length-steps;
    let hits=0, numHits=0, randomHits=0;
    const hitDistribution=Array(11).fill(0);
    // Every prediction uses history strictly before the target draw.
    for(let t=start;t<hist.length;t++) {
      const past=hist.slice(0,t);
      const pred=makeCombination(past,Object.assign({},cfg,{seed:t+12345}));
      const s=scorePrediction(pred,hist[t]);
      hits+=s.hits; numHits+=s.numeroneHit?1:0; hitDistribution[s.hits]++;
      // Exact expected main-number hits for 10 of 20 is 5, Numerone hit rate 5%.
      randomHits+=5;
    }
    const mean=hits/steps, expected=randomHits/steps;
    const variance=steps*(10*0.5*0.5*(10/19));
    const se=Math.sqrt(Math.max(variance,1e-9))/steps;
    return {
      validHistory:hist.length, train: start, test:steps, meanHits:mean,
      randomExpected:expected, hitDelta:mean-expected,
      approximateZ:(mean-expected)/se, numeroneHits:numHits,
      numeroneRate:numHits/steps, numeroneExpectedRate:0.05,
      hitDistribution, method:"walk-forward: per ogni target sono usate solo estrazioni precedenti",
      caution:"Una differenza su un singolo backtest non dimostra capacità predittiva; confrontare più finestre e seed."
    };
  }
  function diagnostics(history) {
    const hist=cleanHistory(history);
    return WINDOWS.map(w=>{
      const ds=hist.slice(-w), f=counts(ds,"main"), expected=ds.length*10/20;
      return {window:w, draws:ds.length, expectedPerNumber:expected,
        frequencies:f.map((count,i)=>({number:i+1,count,delta:count-expected})),
        avgHitsRandom:5, sumMean:ds.length?ds.reduce((s,d)=>s+d.numbers.reduce((a,n)=>a+n,0),0)/ds.length:0};
    });
  }
  root.WFLSonarEngine = {validDraw, cleanHistory, rankNumbers, makeCombination, backtest, diagnostics};
})(window);
