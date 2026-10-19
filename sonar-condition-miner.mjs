import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
const DATA='winforlife_draws.json',LOG='data/sonar-condition-log.json',EVENTS='data/sonar-condition-events.json';
const N=20,K=10,TEST=1200,HOLD=500,WINDOWS=[3,5,10,15,20,30,50,75,100,150,200,300,500,1000];
function valid(d){return d&&Number.isInteger(+d.numero)&&/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===K&&d.numbers.every(n=>Number.isInteger(+n)&&+n>=1&&+n<=N)&&new Set(d.numbers.map(Number)).size===K&&Number.isInteger(+d.numerone)&&+d.numerone>=1&&+d.numerone<=N;}
function top(c,k=K,desc=true){return c.map((v,i)=>({n:i+1,v})).sort((a,b)=>(desc?b.v-a.v:a.v-b.v)||a.n-b.n).slice(0,k).map(x=>x.n).sort((a,b)=>a-b);}
function counts(ds){const c=Array(N).fill(0);for(const d of ds)for(const n of d.numbers)c[n-1]++;return c;}
function posCounts(ds){const c=Array.from({length:K},()=>Array(N).fill(0));for(const d of ds)for(let j=0;j<K;j++)c[j][d.numbers[j]-1]++;return c;}
function hits(p,d){const s=new Set(d.numbers);return p.reduce((v,n)=>v+(s.has(n)?1:0),0);}
function ov(a,b){const s=new Set(a);return b.reduce((v,n)=>v+(s.has(n)?1:0),0);}
function bucket(d,k){return k==='hour'?d.datetime.slice(11,13):k==='weekday'?String(new Date(d.datetime+':00Z').getUTCDay()):d.datetime.slice(5,7);}
function candidates(past,target){
 const out=[],add=(id,family,mode,picks,signature,meta={})=>{picks=[...new Set(picks)].sort((a,b)=>a-b);if(picks.length===K)out.push({id,family,mode,picks,signature,meta});};
 for(const w of WINDOWS){if(past.length<w)continue;const c=counts(past.slice(-w));add('freq_top_'+w,'frequency','include',top(c),'window='+w);add('freq_bottom_'+w,'frequency','exclude',top(c,K,false),'window='+w);}
 for(const kind of ['hour','weekday','month']){const key=bucket(target,kind),same=past.filter(d=>bucket(d,kind)===key);if(same.length>=30){const c=counts(same);add('calendar_'+kind+'_'+key,'calendar','include',top(c),'kind='+kind+';key='+key,{training:same.length});add('calendar_recent_'+kind+'_'+key,'calendar','include',top(counts(same.slice(-100))),'kind='+kind+';key='+key+';recent100',{training:same.length});add('calendar_bottom_'+kind+'_'+key,'calendar','exclude',top(c,K,false),'kind='+kind+';key='+key,{training:same.length});}}
 for(const w of [20,50,100,200,500,1000]){if(past.length<w)continue;const pc=posCounts(past.slice(-w));for(let j=0;j<K;j++)add('position_'+w+'_rank_'+(j+1),'position','include',top(pc[j],1),'window='+w+';rank='+(j+1),{window:w,rank:j+1});const sc=Array(N).fill(0);for(let n=0;n<N;n++)sc[n]=Math.max(...pc.map(row=>row[n]/w));add('number_to_position_'+w,'position','include',top(sc),'window='+w+';direction=number_to_position',{window:w});}
 const prev=past.at(-1),look=past.slice(Math.max(0,past.length-5000),Math.max(0,past.length-1));
 if(prev&&look.length){for(const threshold of [5,6,7,8,9,10]){const successors=[];for(let j=0;j<look.length-1;j++)if(ov(prev.numbers,look[j].numbers)===threshold)successors.push(look[j+1]);if(successors.length){const c=counts(successors),sig='previousDrawOverlap='+threshold+';lookback<=5000';add('analogue_overlap_'+threshold,'analogue','include',top(c),sig,{occurrences:successors.length});add('analogue_overlap_'+threshold+'_exclude','analogue','exclude',top(c,K,false),sig,{occurrences:successors.length});}}}
 for(const depth of [1,2,3]){if(past.length<depth)continue;const present=new Set(past.slice(-depth).flatMap(d=>d.numbers)),score=Array.from({length:N},(_,i)=>present.has(i+1)?1:0);add('transition_present_'+depth,'transition','include',top(score),'depth='+depth+';present');add('transition_absent_'+depth,'transition','include',top(score,K,false),'depth='+depth+';absent');}
 return out;
}
function summary(a){const n=a.length;if(!n)return{targets:0,mean:null,ci95:null,distribution:{}};const m=a.reduce((s,x)=>s+x,0)/n,v=a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,n-1),se=Math.sqrt(v/n),dist={};for(let i=0;i<=10;i++)dist[i]=a.filter(x=>x===i).length;return{targets:n,mean:+m.toFixed(4),deltaVs5:+(m-5).toFixed(4),ci95:[+(m-1.96*se).toFixed(4),+(m+1.96*se).toFixed(4)],distribution:dist,pAtLeast3:+(a.filter(x=>x>=3).length/n).toFixed(4),pAtLeast4:+(a.filter(x=>x>=4).length/n).toFixed(4)};}
function main(){
 const raw=JSON.parse(readFileSync(DATA,'utf8'));if(!Array.isArray(raw)||raw.length<2200||raw.some(d=>!valid(d)))throw Error('Dataset non valido o troppo corto; nessun registro scritto.');
 const ds=raw.map(d=>({...d,numbers:d.numbers.map(Number).sort((a,b)=>a-b),numero:Number(d.numero),numerone:Number(d.numerone)})).sort((a,b)=>a.datetime.localeCompare(b.datetime));if(new Set(ds.map(d=>d.datetime+':'+d.numero)).size!==ds.length)throw Error('ID concorso duplicati; nessun registro scritto.');
 const start=ds.length-TEST,holdStart=ds.length-HOLD,stats=new Map(),events=[],latest=[];
 for(let t=start;t<ds.length;t++){const past=ds.slice(0,t),actual=ds[t],split=t>=holdStart?'holdout':'development',cs=candidates(past,actual),isLatest=t===ds.length-1;
  for(const c of cs){const h=hits(c.picks,actual);let r=stats.get(c.id);if(!r){r={id:c.id,family:c.family,mode:c.mode,signature:c.signature,meta:c.meta,all:[],development:[],holdout:[],hit3:0,hit4:0,hit5:0};stats.set(c.id,r);}r.all.push(h);r[split].push(h);if(h>=3)r.hit3++;if(h>=4)r.hit4++;if(h>=5)r.hit5++;
   if(h>=3)events.push({target:actual.datetime,contest:actual.numero,condition:c.id,family:c.family,mode:c.mode,signature:c.signature,selected:c.picks,actual:actual.numbers,hits:h,split,trainingN:past.length,meta:c.meta});
   if(isLatest)latest.push({condition:c.id,family:c.family,mode:c.mode,signature:c.signature,selected:c.picks,trainingN:past.length,meta:c.meta,priorTargets:r.all.length,priorMeanHits:+(r.all.reduce((s,x)=>s+x,0)/r.all.length).toFixed(4)});
  }
 }
 const conditions=[...stats.values()].map(r=>({id:r.id,family:r.family,mode:r.mode,signature:r.signature,meta:r.meta,all:summary(r.all),development:summary(r.development),holdout:summary(r.holdout),targetsWith3Plus:r.hit3,targetsWith4Plus:r.hit4,targetsWith5Plus:r.hit5,rate3Plus:+(r.hit3/r.all.length).toFixed(4)}));
 const record={runAt:new Date().toISOString(),dataset:{count:ds.length,first:ds[0].datetime,last:ds.at(-1).datetime},protocol:{type:'chronological walk-forward condition discovery',targets:TEST,developmentTargets:TEST-HOLD,holdoutTargets:HOLD,minimumEventHits:3,windows:WINDOWS,analogLookback:5000,rule:'Keep all conditions producing at least 3 hits; include and exclusion hypotheses are separate; predictions use only prior records; no universal-rule promotion.'},conditionCount:conditions.length,conditions,latestConditions:latest,eventCount:events.length,eventsWithAtLeast3Hits:events,decision:'DISCOVERY_ONLY'};
 mkdirSync('data',{recursive:true});let hist=[];if(existsSync(LOG)){try{hist=JSON.parse(readFileSync(LOG,'utf8'));if(!Array.isArray(hist))hist=[];}catch{hist=[];}}hist.push(record);writeFileSync(LOG,JSON.stringify(hist,null,2)+'\\n');
 let old=[];if(existsSync(EVENTS)){try{old=JSON.parse(readFileSync(EVENTS,'utf8'));if(!Array.isArray(old))old=[];}catch{old=[];}}const em=new Map(old.map(e=>[e.target+':'+e.contest+':'+e.condition,e]));for(const e of events)em.set(e.target+':'+e.contest+':'+e.condition,e);writeFileSync(EVENTS,JSON.stringify([...em.values()],null,2)+'\\n');
 console.log(JSON.stringify({status:'PASS',dataset:record.dataset,targets:TEST,conditionCount:conditions.length,eventsWithAtLeast3Hits:events.length,families:[...new Set(conditions.map(c=>c.family))],latestConditions:latest.length,logs:[LOG,EVENTS],decision:record.decision},null,2));
}
main();
