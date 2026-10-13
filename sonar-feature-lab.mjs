import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const DATA='winforlife_draws.json', LOG='data/sonar-feature-log.json';
const N=20, PICK=10, TEST=1200, HOLDOUT=500, MIN_TRAIN=1000;
const WINDOWS=[3,5,10,20,50,100,200,500];

function valid(d){return d&&Number.isInteger(Number(d.numero))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===10&&d.numbers.every(n=>Number.isInteger(Number(n))&&Number(n)>=1&&Number(n)<=20)&&new Set(d.numbers.map(Number)).size===10&&Number.isInteger(Number(d.numerone))&&Number(d.numerone)>=1&&Number(d.numerone)<=20;}
function top(scores,k=10){return scores.map((v,i)=>({n:i+1,v})).sort((a,b)=>b.v-a.v||a.n-b.n).slice(0,k).map(x=>x.n);}
function z(a){const m=a.reduce((s,x)=>s+x,0)/Math.max(1,a.length),v=a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length),sd=Math.sqrt(v);return a.map(x=>sd>1e-9?(x-m)/sd:0);}
function freq(ds){const c=Array(N).fill(0);for(const d of ds)for(const n of d.numbers)c[n-1]++;return c;}
function overlap(a,b){const s=new Set(a);return b.reduce((n,x)=>n+(s.has(x)?1:0),0);}
function hits(p,a){const s=new Set(a.numbers);return p.reduce((n,x)=>n+(s.has(x)?1:0),0);}
function rand(seed){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
function shufflePick(seed){const a=Array.from({length:N},(_,i)=>i+1),r=rand(seed);for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,PICK).sort((x,y)=>x-y);}
function hr(d){return Number(d.datetime.slice(11,13));}
function dow(d){return new Date(d.datetime+':00Z').getUTCDay();}
function month(d){return d.datetime.slice(5,7);}
function date(d){return d.datetime.slice(0,10);}
function timeMs(d){return Date.parse(d.datetime+':00Z');}
function summarize(a){const n=a.length;if(!n)return{targets:0,meanHits:null,delta:null,ci95:null};const m=a.reduce((s,x)=>s+x,0)/n,v=a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,n-1),se=Math.sqrt(v/n);return{targets:n,meanHits:+m.toFixed(5),expected:5,delta:+(m-5).toFixed(5),se:+se.toFixed(5),ci95:[+(m-1.96*se).toFixed(5),+(m+1.96*se).toFixed(5)]};}
function paired(a,b){const d=a.map((x,i)=>x-b[i]),n=d.length,m=d.reduce((s,x)=>s+x,0)/n,v=d.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,n-1),se=Math.sqrt(v/n);return{meanDelta:+m.toFixed(5),se:+se.toFixed(5),ci95:[+(m-1.96*se).toFixed(5),+(m+1.96*se).toFixed(5)],positiveTargets:d.filter(x=>x>0).length,negativeTargets:d.filter(x=>x<0).length,tiedTargets:d.filter(x=>x===0).length};}
function rankTransition(past){const scores=Array(N).fill(0),totals=Array(N).fill(0),prev=past.at(-1).numbers;for(let i=0;i<past.length-1;i++){const ov=overlap(prev,past[i].numbers);if(ov===0)continue;for(const n of past[i+1].numbers){scores[n-1]+=ov/10;totals[n-1]++;}}return scores.map((v,i)=>(v+0.5)/(totals[i]+10));}
function analogScores(past,threshold){const s=Array(N).fill(0),w=Array(N).fill(0),prev=past.at(-1).numbers;for(let i=0;i<past.length-1;i++){const ov=overlap(prev,past[i].numbers);if(ov>=threshold){for(const n of past[i+1].numbers){s[n-1]+=ov/10;w[n-1]++;}}}return s.map((v,i)=>(v+0.5)/(w[i]+10));}
function predictSet(id,past,engine,target){
 const all=freq(past),last=past.at(-1),prev=past.at(-2),rec=w=>freq(past.slice(-Math.min(w,past.length)));
 if(id==='statusquo')return engine.makeCombination(past,{window:10,pool:14,seed:past.length*7919+104729}).numbers;
 if(id==='global')return top(all);
 const m=id.match(/^recent(\d+)$/);if(m)return top(rec(+m[1]));
 if(id==='globalRecent50')return top(all.map((v,i)=>v+0.5*rec(50)[i]));
 if(id==='coldGlobal')return top(all.map(v=>-v));
 if(id==='trendUp20'||id==='trendDown20'){const recent=rec(20),older=freq(past.slice(-40,-20));return top(recent.map((v,i)=>id==='trendUp20'?v-older[i]:older[i]-v));}
 if(id==='streak'||id==='antiStreak'){const s=Array(N).fill(0);for(let i=past.length-1;i>=0;i--){for(let n=1;n<=N;n++){if(past[i].numbers.includes(n))s[n-1]++;else break;}}return top(id==='streak'?s:s.map(v=>-v));}
 if(id==='delayOverdue'||id==='delayRecent'){const seen=Array(N).fill(-1);past.forEach((d,i)=>d.numbers.forEach(n=>seen[n-1]=i));const gap=seen.map(i=>i<0?past.length:past.length-1-i);return top(id==='delayOverdue'?gap:gap.map(x=>-x));}
 if(id==='delayVsExpected'){const seen=Array(N).fill(-1),gaps=Array.from({length:N},()=>[]);past.forEach((d,i)=>{d.numbers.forEach(n=>{if(seen[n-1]>=0)gaps[n-1].push(i-seen[n-1]);seen[n-1]=i;});});const now=seen.map(i=>i<0?past.length:past.length-1-i);return top(now.map((x,i)=>x/(gaps[i].length?gaps[i].reduce((a,b)=>a+b,0)/gaps[i].length:2)));}
 if(id==='repeat2'||id==='repeat4'||id==='repeat6'||id==='repeat8'||id==='repeat10'){const k=+id.slice(6),prevNums=last.numbers.slice().sort((a,b)=>all[b-1]-all[a-1]||a-b).slice(0,k),rest=top(all,20).filter(n=>!prevNums.includes(n));return [...prevNums,...rest.slice(0,10-k)].sort((a,b)=>a-b);}
 if(id==='exclude2'||id==='exclude4'||id==='exclude6'||id==='exclude8'||id==='exclude10'){const k=+id.slice(7),ex=last.numbers.slice().sort((a,b)=>all[a-1]-all[b-1]||b-a).slice(0,k),cand=top(all,20).filter(n=>!ex.includes(n));return cand.slice(0,10).sort((a,b)=>a-b);}
 if(id==='transition')return top(rankTransition(past));
 if(id==='analog8'||id==='analog9'||id==='analog10')return top(analogScores(past,+id.slice(6)));
 if(id==='pairGlobal'||id==='pairRecent'){const hist=id==='pairRecent'?past.slice(-100):past,sc=Array(N).fill(0),den=Array(N).fill(0),prevNums=new Set(last.numbers);for(const d of hist){for(const n of d.numbers){den[n-1]++;if(d.numbers.some(v=>prevNums.has(v)&&v!==n))sc[n-1]++;}}return top(sc.map((v,i)=>(v+0.5)/(den[i]+1)));}
 if(id.startsWith('hour')||id.startsWith('weekday')||id.startsWith('month')){const kind=id.startsWith('hour')?'hour':id.startsWith('weekday')?'weekday':'month',key=kind==='hour'?hr(target):kind==='weekday'?dow(target):month(target),same=past.filter(d=>(kind==='hour'?hr(d):kind==='weekday'?dow(d):month(d))===key),w=id.includes('recent')?200:same.length;return top(freq(same.slice(-w)));}
 if(id.startsWith('rolling')){const hours=+id.slice(7),cut=timeMs(target)-hours*3600000,sub=past.filter(d=>timeMs(d)>=cut&&timeMs(d)<timeMs(target));return top(freq(sub));}
 if(id==='intraday3'||id==='intraday5'||id==='intraday10'){const k=+id.slice(8),sub=past.filter(d=>date(d)===date(target));return top(freq(sub.slice(-k)));}
 if(id==='lifecycle'){const recent=rec(20),older=freq(past.slice(-100,-20));return top(recent.map((v,i)=>v-z(older)[i]*0.5));}
 if(id==='returnAfterAbsent'){const seen=Array(N).fill(-1);past.forEach((d,i)=>d.numbers.forEach(n=>seen[n-1]=i));const gaps=seen.map(i=>i<0?past.length:past.length-1-i);const recent=rec(20);return top(gaps.map((g,i)=>g>=3&&g<=10?recent[i]+1:recent[i]));}
 if(id==='balancedOddEven'||id==='balancedLowHigh'){const ranked=top(all,20),selected=[];const odd=id==='balancedOddEven';for(const n of ranked){if(selected.length===10)break;const group=odd?(n%2):(n<=10);const count=selected.filter(x=>odd?(x%2):x<=10).length;if((group&&count<5)||(!group&&selected.length-count<5))selected.push(n);}for(const n of ranked)if(selected.length<10&&!selected.includes(n))selected.push(n);return selected.sort((a,b)=>a-b);}
 return top(all);
}
function predictNumerone(id,past,target,engine){
 const n=20, vals=key=>past.map(d=>Number(d.numerone)), counts=arr=>{const c=Array(n).fill(0);for(const x of arr)c[x-1]++;return c;}, top1=s=>s.map((v,i)=>({n:i+1,v})).sort((a,b)=>b.v-a.v||a.n-b.n)[0].n;
 if(id==='engine')return engine.makeCombination(past,{window:10,pool:14,seed:past.length*7919+104729}).numerone;
 if(id==='global')return top1(counts(vals()));
 const m=id.match(/^recent(\d+)$/);if(m)return top1(counts(vals().slice(-Number(m[1]))));
 const seen=Array(n).fill(-1);past.forEach((d,i)=>{seen[Number(d.numerone)-1]=i;});
 if(id==='overdue'||id==='mostRecent'){const gaps=seen.map(i=>i<0?past.length:past.length-1-i);return top1(id==='overdue'?gaps:gaps.map(x=>-x));}
 if(id==='transition'){const last=Number(past.at(-1).numerone),c=Array(n).fill(0),den=Array(n).fill(0);for(let i=0;i<past.length-1;i++)if(Number(past[i].numerone)===last){const next=Number(past[i+1].numerone);c[next-1]++;}return top1(c.map(x=>x+0.5));}
 if(id==='hourrecent'||id==='weekdayrecent'||id==='monthrecent'){const kind=id.startsWith('hour')?'hour':id.startsWith('weekday')?'weekday':'month',key=kind==='hour'?hr(target):kind==='weekday'?dow(target):month(target),same=past.filter(d=>(kind==='hour'?hr(d):kind==='weekday'?dow(d):month(d))===key).slice(-200);return top1(counts(same.map(d=>Number(d.numerone))));}
 if(id==='analogExact'||id==='analogNear8'){const prev=past.at(-1),scores=Array(n).fill(0);for(let i=0;i<past.length-1;i++){const ov=overlap(prev.numbers,past[i].numbers);if((id==='analogExact'&&ov===10)||(id==='analogNear8'&&ov>=8)){scores[Number(past[i+1].numerone)-1]++;}}return top1(scores);}
 return top1(counts(vals()));
}
function main(){
 const raw=JSON.parse(readFileSync(DATA,'utf8'));if(!Array.isArray(raw)||raw.some(d=>!valid(d)))throw new Error('Dataset non valido; nessun report scritto.');
 const ds=raw.map(d=>({...d,numbers:d.numbers.map(Number).sort((a,b)=>a-b),numerone:Number(d.numerone),numero:Number(d.numero)})).sort((a,b)=>a.datetime.localeCompare(b.datetime));
 if(new Set(ds.map(d=>d.datetime)).size!==ds.length)throw new Error('Timestamp duplicati; test interrotto.');
 if(ds.length<MIN_TRAIN+TEST)throw new Error('Storico insufficiente.');
 globalThis.window=globalThis;const require=createRequire(import.meta.url);require('./wfl-sonar-engine.js');const engine=globalThis.WFLSonarEngine;
 const ids=['statusquo','global',...WINDOWS.map(w=>'recent'+w),'globalRecent50','delayOverdue','delayRecent','delayVsExpected','coldGlobal','trendUp20','trendDown20','streak','antiStreak','transition','pairGlobal','pairRecent','analog8','analog9','analog10','repeat2','repeat4','repeat6','repeat8','repeat10','exclude2','exclude4','exclude6','exclude8','exclude10','lifecycle','returnAfterAbsent','balancedOddEven','balancedLowHigh','hour','hourrecent','weekday','weekdayrecent','month','monthrecent','intraday3','intraday5','intraday10','rolling6','rolling24','rolling72','rolling168','rolling720'];
 const values=Object.fromEntries(ids.map(id=>[id,{all:[],dev:[],holdout:[],numAll:0,numDev:0,numHoldout:0}]));
 const numIds=['engine','global',...WINDOWS.map(w=>'recent'+w),'overdue','mostRecent','transition','hourrecent','weekdayrecent','monthrecent','analogExact','analogNear8'];
 const numValues=Object.fromEntries(numIds.map(id=>[id,{all:[],dev:[],holdout:[]} ]));
 const start=ds.length-TEST,hs=ds.length-HOLDOUT;
 for(let t=start;t<ds.length;t++){
   const past=ds.slice(0,t),actual=ds[t],hold=t>=hs;
   for(const id of ids){
     let picks;
     try{picks=predictSet(id,past,engine,actual);}catch(e){throw new Error('Strategy '+id+' failed at target '+t+': '+e.message);}
     if(!Array.isArray(picks)||picks.length!==10||new Set(picks).size!==10||picks.some(n=>n<1||n>20))throw new Error('Invalid prediction from '+id);
     const h=hits(picks,actual),v=values[id];v.all.push(h);v[hold?'holdout':'dev'].push(h);
     // Evaluate Numerone independently; never mix it into the 10/20 main-number score.
     if(id==='statusquo'){const predNum=engine.makeCombination(past,{window:10,pool:14,seed:past.length*7919+104729}).numerone;if(predNum===actual.numerone){v.numAll++;if(hold)v.numHoldout++;else v.numDev++;}}
   }
   for(const id of numIds){const pred=predictNumerone(id,past,actual,engine),v=numValues[id];v.all.push(pred===actual.numerone?1:0);v[hold?'holdout':'dev'].push(pred===actual.numerone?1:0);}
   }
 }
 const results={};for(const id of ids){const v=values[id];results[id]={label:id,all:summarize(v.all),development:summarize(v.dev),holdout:summarize(v.holdout),vsStatusQuo:{all:paired(v.all,values.statusquo.all),development:paired(v.dev,values.statusquo.dev),holdout:paired(v.holdout,values.statusquo.holdout)},numerone:id==='statusquo'?{all:v.numAll,development:v.numDev,holdout:v.numHoldout,expectedRate:.05}:null};}
 const numeroneResults={};for(const id of numIds){const v=numValues[id];numeroneResults[id]={all:summarize(v.all),development:summarize(v.dev),holdout:summarize(v.holdout),rateInterpretation:'Binary Numerone hit rate; theoretical reference 5%'};}
 const ranked=ids.filter(id=>id!=='statusquo').map(id=>({id,holdoutMean:results[id].holdout.meanHits,holdoutDeltaVsStatusQuo:results[id].vsStatusQuo.holdout.meanDelta,developmentDeltaVsStatusQuo:results[id].vsStatusQuo.development.meanDelta,holdoutPairedCI:results[id].vsStatusQuo.holdout.ci95})).sort((a,b)=>b.holdoutDeltaVsStatusQuo-a.holdoutDeltaVsStatusQuo);
 const best=ranked[0];
 const numeroneRanked=numIds.filter(id=>id!=='engine').map(id=>({id,holdoutRate:numeroneResults[id].holdout.meanHits,holdoutDeltaVsStatusQuo:numeroneResults[id].holdout.meanHits-numeroneResults.engine.holdout.meanHits,developmentDeltaVsStatusQuo:numeroneResults[id].development.meanHits-numeroneResults.engine.development.meanHits})).sort((a,b)=>b.holdoutDeltaVsStatusQuo-a.holdoutDeltaVsStatusQuo);
 const record={runAt:new Date().toISOString(),dataset:{count:ds.length,first:ds[0].datetime,last:ds.at(-1).datetime},protocol:{type:'walk-forward feature ablation and cross-game rule transfer, WFL Classico adapted',testTargets:TEST,developmentTargets:TEST-HOLDOUT,holdoutTargets:HOLDOUT,minTraining:MIN_TRAIN,gameRules:{main:'10 distinct numbers from 1..20; score exact intersection size, expectation 5',numerone:'separate 1..20 draw; not blended with main hits',time:'calendar keys use recorded draw timestamp; all predictions use history strictly before target'},promotionPolicy:'Rank by raw holdout mean hits versus status quo; an observed positive difference is an exploratory challenger. Do not interpret a single holdout winner as statistically proven; confirm on next untouched rolling block before permanent promotion.',transferredRules:['global/recent frequency','gap and return lifecycle','transition to following draw','co-occurrence/pair association','repeat versus exclude prior-draw numbers','exact and near-sequence successor analogues','hour/day-of-week/month conditioning','intraday micro-trends','rolling 6h/24h/72h/7d/30d windows','odd/even and low/high balance'],excludedRules:['VinciCasa order-position transitions and P1-P5 rules do not apply because WFL numbers are an unordered set','SuperEnalotto six-of-90 combinatorics and 6/6,5/6,4/6 thresholds do not apply','Numerone remains an independent target']},results,challengerRanking:ranked,topObservedChallenger:best,numeroneResults,numeroneChallengerRanking:numeroneRanked,topNumeroneChallenger:numeroneRanked[0],decision:'EXPLORATORY_CHALLENGER_ONLY'};
 mkdirSync('data',{recursive:true});let log=[];if(existsSync(LOG)){try{log=JSON.parse(readFileSync(LOG,'utf8'));if(!Array.isArray(log))log=[];}catch{log=[];}}log.push(record);writeFileSync(LOG,JSON.stringify(log,null,2)+'\n');console.log(JSON.stringify(record,null,2));
}
main();
