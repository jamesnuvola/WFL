import fs from 'node:fs';

const DATA_FILE='winforlife_draws.json';
const STATE_FILE='data/archive/backfill-state.json';
const BACKUP_DIR='data/archive';
const MIN_DATE='2022-01-25';
const DAYS_PER_RUN=30;
const PAUSE_MS=250;
const MONTHS=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function dateAdd(iso,days){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function valid(d){return d&&Number.isInteger(Number(d.numero))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===10&&d.numbers.every(n=>Number.isInteger(Number(n))&&n>=1&&n<=20)&&new Set(d.numbers.map(Number)).size===10&&Number.isInteger(Number(d.numerone))&&d.numerone>=1&&d.numerone<=20;}
function decode(s){return s.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&deg;/gi,'°').replace(/&#(?:186|xba);/gi,'º').replace(/&egrave;/gi,'è').replace(/&agrave;/gi,'à').replace(/&igrave;/gi,'ì').replace(/&ograve;/gi,'ò').replace(/&ugrave;/gi,'ù').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");}
function plainText(html){return decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));}
function parseOfficial(html){
 const text=plainText(html),blocks=text.split(/(?=N\s*[º°]\s*\d+\s+del\s+)/i).slice(1),out=[];
 for(const block of blocks){
  const h=block.match(/^N\s*[º°]\s*(\d+)\s+del\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\s+([01]\d|2[0-3]):([0-5]\d)/i);
  if(!h)continue;
  const month=MONTHS.findIndex(x=>x===h[3].toLocaleLowerCase('it'))+1;
  if(!month)continue;
  const values=(block.slice(h[0].length).match(/\b(?:[1-9]|1[0-9]|20)\b/g)||[]).map(Number);
  if(values.length<11)continue;
  const d={datetime:`${h[4]}-${String(month).padStart(2,'0')}-${String(h[2]).padStart(2,'0')}T${h[5]}:${h[6]}`,numbers:values.slice(0,10).sort((a,b)=>a-b),numerone:values[10],numero:Number(h[1])};
  if(valid(d))out.push(d);
 }
 const map=new Map();
 for(const d of out){const k=`${d.datetime.slice(0,4)}:${d.numero}`,prev=map.get(k);if(prev&&JSON.stringify(prev)!==JSON.stringify(d))throw new Error(`Conflicting official records for ${k}`);map.set(k,d);}
 return [...map.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero);
}
async function fetchDay(iso){
 const [y,m,d]=iso.split('-');
 const url=`https://www.winforlife.it/archivio-estrazioni-classico/${y}/${MONTHS[Number(m)-1]}/${Number(d)}?_wfl_backfill=${Date.now()}`;
 const r=await fetch(url,{cache:'no-store',headers:{'user-agent':'WFL-SONAR-history-backfill/2.0','cache-control':'no-cache','pragma':'no-cache','accept':'text/html,application/xhtml+xml'}});
 if(!r.ok)throw new Error(`Official archive HTTP ${r.status} for ${iso}`);
 return parseOfficial(await r.text()).filter(x=>x.datetime.slice(0,10)===iso);
}
async function main(){
 fs.mkdirSync(BACKUP_DIR,{recursive:true});
 const current=fs.existsSync(DATA_FILE)?JSON.parse(fs.readFileSync(DATA_FILE,'utf8')):[];
 if(!Array.isArray(current)||current.some(d=>!valid(d)))throw new Error('Dataset esistente non valido: backfill bloccato senza modificare lo storico.');
 const state=fs.existsSync(STATE_FILE)?JSON.parse(fs.readFileSync(STATE_FILE,'utf8')):{nextDate:MIN_DATE,completedDays:0,updatedAt:null};
 let next=state.nextDate||MIN_DATE;
 const now=new Date();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(next>today){console.log('Backfill già arrivato alla data corrente.');return;}
 const key=d=>`${String(d.datetime).slice(0,4)}:${Number(d.numero)}`;
 const byNumber=new Map(current.map(d=>[key(d),d]));
 if(fs.existsSync(DATA_FILE)){
  const snapshot=`${BACKUP_DIR}/winforlife_draws_before_official_backfill_${new Date().toISOString().slice(0,10)}.json`;
  if(!fs.existsSync(snapshot))fs.copyFileSync(DATA_FILE,snapshot);
 }
 let done=0,added=0;
 while(next<=today&&done<DAYS_PER_RUN){
  const found=await fetchDay(next);
  if(!found.length)throw new Error(`Zero official draws parsed for ${next}; checkpoint not advanced and existing history preserved.`);
  for(const d of found){
   const id=key(d),prev=byNumber.get(id);
   if(prev){if(prev.datetime!==d.datetime||Number(prev.numerone)!==d.numerone||JSON.stringify(prev.numbers.map(Number).sort((a,b)=>a-b))!==JSON.stringify(d.numbers))throw new Error(`Conflict at draw ${id}; dataset not written.`);}
   else{byNumber.set(id,d);added++;}
  }
  done++;next=dateAdd(next,1);await sleep(PAUSE_MS);
 }
 const merged=[...byNumber.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero);
 if(merged.length<current.length)throw new Error('Merge would reduce archive size; write blocked.');
 fs.writeFileSync(DATA_FILE,JSON.stringify(merged,null,2)+'\n');
 fs.writeFileSync(STATE_FILE,JSON.stringify({nextDate:next,completedDays:Number(state.completedDays||0)+done,updatedAt:new Date().toISOString(),lastBatchDays:done,lastBatchAdded:added,recordCount:merged.length,first:merged[0]?.datetime,last:merged.at(-1)?.datetime,source:'winforlife.it official archive'},null,2)+'\n');
 console.log(JSON.stringify({source:'winforlife.it official archive',from:state.nextDate||MIN_DATE,to:dateAdd(next,-1),days:done,added,total:merged.length,nextDate:next,first:merged[0]?.datetime,last:merged.at(-1)?.datetime},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
