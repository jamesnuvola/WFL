import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA='winforlife_draws.json', LOG='data/sonar-position-log.json';
const N=20, PICK=10, TEST=1200, HOLDOUT=500, MIN_TRAIN=1000, PRIOR=100;
function valid(d){return d&&Number.isInteger(Number(d.numero))&&/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===10&&d.numbers.every(n=>Number.isInteger(Number(n))&&n>=1&&n<=20)&&new Set(d.numbers.map(Number)).size===10&&Number.isInteger(Number(d.numerone))&&Number(d.numerone)>=1&&Number(d.numerone)<=20;}
function choose(n,k){if(k<0||k>n)return 0;k=Math.min(k,n-k);let v=1;for(let i=1;i<=k;i++)v=v*(n-k+i)/i;return v;}
const DEN=choose(N,PICK);
function expectedPositionProb(pos,n){return choose(n-1,pos-1)*choose(N-n,PICK-pos)/DEN;}
function summarize(a){const n=a.length;if(!n)return{targets:0,meanHits:null};const mean=a.reduce((s,x)=>s+x,0)/n,variance=a.reduce((s,x)=>s+(x-mean)**2,0)/Math.max(1,n-1),se=Math.sqrt(variance/n);return{targets:n,meanHits:+mean.toFixed(5),expected:5,delta:+(mean-5).toFixed(5),se:+se.toFixed(5),ci95:[+(mean-1.96*se).toFixed(5),+(mean+1.96*se).toFixed(5)]};}
function paired(a,b){const d=a.map((x,i)=>x-b[i]),n=d.length,m=d.reduce((s,x)=>s+x,0)/n,v=d.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,n-1),se=Math.sqrt(v/n);return{meanDelta:+m.toFixed(5),se:+se.toFixed(5),ci95:[+(m-1.96*se).toFixed(5),+(m+1.96*se).toFixed(5)],positive:d.filter(x=>x>0).length,negative:d.filter(x=>x<0).length,tied:d.filter(x=>x===0).length};}
function hr(d){return Number(d.datetime.slice(11,13));}
function hits(p,d){const s=new Set(d.numbers);return p.reduce((v,n)=>v+(s.has(n)?1:0),0);}
function theoretical(){return Array.from({length:PICK},(_,j)=>Array.from({length:N},(_,i)=>expectedPositionProb(j+1,i+1)));}
const prior=theoretical();
function positionPrediction(past,windowSize){
 const hist=windowSize?past.slice(-windowSize):past;
 const counts=Array.from({length:PICK},()=>Array(N).fill(0));
 for(const d of hist)for(let j=0;j<PICK;j++)counts[j][d.numbers[j]-1]++;
 const scores=counts.map((row,j)=>row.map((c,i)=>Math.log((c+PRIOR*prior[j][i])/(hist.length+PRIOR)+1e-12)));
 // Dynamic programming: choose one strictly increasing number for each sorted rank.
 const dp=Array.from({length:PICK},()=>Array(N).fill(-Infinity)),prev=Array.from({length:PICK},()=>Array(N).fill(-1));
 for(let n=0;n<N;n++)dp[0][n]=scores[0][n];
 for(let j=1;j<PICK;j++)for(let n=j;n<N-(PICK-j);n++)for(let k=j-1;k<n;k++){const v=dp[j-1][k]+scores[j][n];if(v>dp[j][n]){dp[j][n]=v;prev[j][n]=k;}}
 let n=Array.from({length:N},(_,i)=>i).sort((a,b)=>dp[PICK-1][b]-dp[PICK-1][a])[0],out=Array(PICK);
 for(let j=PICK-1;j>=0;j--){out[j]=n+1;n=prev[j][n];}
 return out;
}
function enginePrediction(past,targetHour,engine){return engine.makeCombination(past,{strategy:'hourrecent',hourWindow:200,targetHour}).numbers;}
async function main(){
 const raw=JSON.parse(readFileSync(DATA,'utf8'));if(!Array.isArray(raw)||raw.some(d=>!valid(d)))throw new Error('Dataset non valido; nessun report scritto.');
 const ds=raw.map(d=>({...d,numbers:d.numbers.map(Number).sort((a,b)=>a-b),numerone:Number(d.numerone),numero:Number(d.numero)})).sort((a,b)=>a.datetime.localeCompare(b.datetime));
 if(new Set(ds.map(d=>d.datetime)).size!==ds.length)throw new Error('Timestamp duplicati; test interrotto.');
 if(ds.length<MIN_TRAIN+TEST)throw new Error('Storico insufficiente.');
 const positionDiagnostics=[];
 for(let j=0;j<PICK;j++){
   const obs=Array(N).fill(0);for(const d of ds)obs[d.numbers[j]-1]++;
   const cells=Array.from({length:N},(_,i)=>({number:i+1,observed:obs[i],expectedProbability:prior[j][i],expectedCount:ds.length*prior[j][i],delta:obs[i]-ds.length*prior[j][i]}));
   const usable=cells.filter(x=>x.expectedCount>=5),chi2=usable.reduce((s,x)=>s+(x.observed-x.expectedCount)**2/x.expectedCount,0);
   positionDiagnostics.push({position:j+1,observations:ds.length,chiSquare:+chi2.toFixed(4),degreesOfFreedom:Math.max(0,usable.length-1),topObserved:cells.slice().sort((a,b)=>b.observed-a.observed).slice(0,5),largestAbsoluteDeviations:cells.slice().sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,5)});
 }
 globalThis.window=globalThis;await import('./wfl-sonar-engine.js');const engine=globalThis.WFLSonarEngine;
 const ids=['positionGlobal','positionRecent200','positionRecent1000','hourrecentStatusquo'];
 const vals=Object.fromEntries(ids.map(id=>[id,{all:[],dev:[],holdout:[]} ]));
 const start=ds.length-TEST,hs=ds.length-HOLDOUT;
 for(let t=start;t<ds.length;t++){
   const past=ds.slice(0,t),actual=ds[t],hold=t>=hs,targetHour=hr(actual);
   const preds={
     positionGlobal:positionPrediction(past,0),
     positionRecent200:positionPrediction(past,200),
     positionRecent1000:positionPrediction(past,1000),
     hourrecentStatusquo:enginePrediction(past,targetHour,engine)
   };
   for(const id of ids){const p=preds[id];if(p.length!==PICK||new Set(p).size!==PICK||p.some((n,i)=>i&&p[i-1]>=n))throw new Error('Invalid ordered set from '+id);const v=hits(p,actual);vals[id].all.push(v);vals[id][hold?'holdout':'dev'].push(v);}
 }
 const results={};for(const id of ids){const v=vals[id];results[id]={all:summarize(v.all),development:summarize(v.dev),holdout:summarize(v.holdout),vsHourrecent:{all:paired(v.all,vals.hourrecentStatusquo.all),development:paired(v.dev,vals.hourrecentStatusquo.dev),holdout:paired(v.holdout,vals.hourrecentStatusquo.holdout)}};}
 const ranked=ids.filter(x=>x!=='hourrecentStatusquo').map(id=>({id,developmentDelta:results[id].vsHourrecent.development.meanDelta,holdoutDelta:results[id].vsHourrecent.holdout.meanDelta,holdoutCI:results[id].vsHourrecent.holdout.ci95})).sort((a,b)=>b.holdoutDelta-a.holdoutDelta);
 const record={runAt:new Date().toISOString(),dataset:{count:ds.length,first:ds[0].datetime,last:ds.at(-1).datetime},methodology:{name:'sorted-rank positional lab',positions:10,positionMeaning:'rank after ascending sort in the official winning combination, NOT physical order of draw',sourceNote:'Official archive presents the 10-number winning combination sorted ascending; stored archive parser sorts it too. This lab cannot infer physical extraction order.',walkForward:{testTargets:TEST,developmentTargets:TEST-HOLDOUT,holdoutTargets:HOLDOUT,minTraining:MIN_TRAIN,allPredictionsUseOnlyPriorHistory:true,score:'exact intersection hits among the 10-number set; theoretical expectation 5'},positionPrior:'Exact order-statistic distribution for a uniformly random 10-of-20 set; empirical rank frequencies shrink toward this prior (alpha='+PRIOR+').',numerone:'Kept separate; not used in positional model.'},positionDiagnostics,results,challengerRanking:ranked,decision:'EXPLORATORY_ONLY_NO_PROMOTION'};
 mkdirSync('data',{recursive:true});let log=[];if(existsSync(LOG)){try{log=JSON.parse(readFileSync(LOG,'utf8'));if(!Array.isArray(log))log=[];}catch{log=[];}}log.push(record);writeFileSync(LOG,JSON.stringify(log,null,2)+'\n');console.log(JSON.stringify(record,null,2));
}
function awaitImportShim(){return {createRequire:(...args)=>{const {createRequire}=globalThis.__createRequireShim||{};if(createRequire)return createRequire(...args);throw new Error('createRequire shim unavailable');}}}
main();
