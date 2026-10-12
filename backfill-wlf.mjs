import fs from 'node:fs';

const ARCHIVE_URL='https://www.estrazionelotto.it/archivio-winforlife';
const SEARCH_URL='https://www.estrazionelotto.it/archivio-winforlife/ricerca';
const DATA_FILE='winforlife_draws.json';
const STATE_FILE='data/archive/backfill-state.json';
const BACKUP_DIR='data/archive';
const MIN_DATE='2022-01-25';
const DAYS_PER_RUN=120;
const PAUSE_MS=250;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function dateAdd(iso,days){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function valid(d){return d&&Number.isInteger(Number(d.numero))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===10&&d.numbers.every(n=>Number.isInteger(Number(n))&&n>=1&&n<=20)&&new Set(d.numbers.map(Number)).size===10&&Number.isInteger(Number(d.numerone))&&d.numerone>=1&&d.numerone<=20;}
function parseDraws(html){
 const blocks=[...html.matchAll(/Estrazione\s+n[°º]\s*(\d+)\s*\((\d{2}:\d{2})\)([\s\S]*?)(?=Estrazione\s+n[°º]\s*\d+\s*\(\d{2}:\d{2}\)|$)/gi)];
 const out=[];
 for(const m of blocks){const plain=m[3].replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');const dm=plain.match(/del\s+(\d{2})-(\d{2})-(\d{4})/i),e=plain.search(/ESTRATTI/i),n=plain.search(/NUMERONE/i);if(!dm||e<0||n<e)continue;const nums=(plain.slice(e+7,n).match(/\b(?:[1-9]|1[0-9]|20)\b/g)||[]).map(Number);const nm=plain.slice(n).match(/NUMERONE\s+(\d{1,2})/i);if(nums.length<10||new Set(nums.slice(0,10)).size!==10||!nm)continue;const d={datetime:`${dm[3]}-${dm[2]}-${dm[1]}T${m[2]}`,numbers:nums.slice(0,10).sort((a,b)=>a-b),numerone:Number(nm[1]),numero:Number(m[1])};if(valid(d))out.push(d);}
 return out;
}
function cookiesFrom(response){const lines=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[(response.headers.get('set-cookie')||'')];return lines.map(x=>x.split(';')[0]).filter(Boolean).join('; ');}
async function main(){
 fs.mkdirSync(BACKUP_DIR,{recursive:true});
 const current=fs.existsSync(DATA_FILE)?JSON.parse(fs.readFileSync(DATA_FILE,'utf8')):[];
 if(!Array.isArray(current)||current.some(d=>!valid(d)))throw new Error('Dataset esistente non valido: backfill bloccato senza modificare lo storico.');
 const state=fs.existsSync(STATE_FILE)?JSON.parse(fs.readFileSync(STATE_FILE,'utf8')):{nextDate:MIN_DATE,completedDays:0,updatedAt:null};
 let next=state.nextDate||MIN_DATE;
 const today=new Date().toISOString().slice(0,10);
 if(next>today){console.log('Backfill già arrivato alla data corrente.');return;}
 const firstResponse=await fetch(ARCHIVE_URL,{headers:{'user-agent':'WFL-SONAR-history-backfill/1.0'}});
 if(!firstResponse.ok)throw new Error(`Archive HTTP ${firstResponse.status}`);
 const firstHtml=await firstResponse.text();
 let cookie=cookiesFrom(firstResponse);
 const tokenMatch=firstHtml.match(/name=["']_token["']\s+value=["']([^"']+)["']/i);
 const token=tokenMatch?.[1];
 if(!token)throw new Error('Token form non trovato: backfill fermato in sicurezza.');
 const key=d=>`${String(d.datetime).slice(0,4)}:${Number(d.numero)}`;
 const byNumber=new Map(current.map(d=>[key(d),d]));
 if(fs.existsSync(DATA_FILE)){
  const snapshot=`${BACKUP_DIR}/winforlife_draws_before_backfill_${new Date().toISOString().slice(0,10)}.json`;
  if(!fs.existsSync(snapshot))fs.copyFileSync(DATA_FILE,snapshot);
 }
 let done=0,added=0;
 while(next<=today&&done<DAYS_PER_RUN){
  const body=new URLSearchParams({_token:token,data:next});
  const response=await fetch(SEARCH_URL,{method:'POST',redirect:'follow',headers:{'user-agent':'WFL-SONAR-history-backfill/1.0','content-type':'application/x-www-form-urlencoded','cookie':cookie,'referer':ARCHIVE_URL,'origin':'https://www.estrazionelotto.it','accept':'text/html,application/xhtml+xml'},body});
  if(!response.ok)throw new Error(`Search HTTP ${response.status} for ${next}; checkpoint not advanced.`);
  const html=await response.text();
  const found=parseDraws(html).filter(d=>d.datetime.slice(0,10)===next);
  if(!found.length)throw new Error(`Zero draws parsed for ${next}; checkpoint not advanced, existing history preserved. Check source form response.`);
  for(const d of found){const id=key(d),prev=byNumber.get(id);if(prev){if(prev.datetime!==d.datetime||prev.numerone!==d.numerone||prev.numbers.join(',')!==d.numbers.join(','))throw new Error(`Conflict at draw ${id}; dataset not written.`);}else{byNumber.set(id,d);added++;}}
  done++;next=dateAdd(next,1);await sleep(PAUSE_MS);
 }
 const merged=[...byNumber.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero);
 if(merged.length<current.length)throw new Error('Merge would reduce archive size; write blocked.');
 fs.writeFileSync(DATA_FILE,JSON.stringify(merged,null,2)+'\n');
 fs.writeFileSync(STATE_FILE,JSON.stringify({nextDate:next,completedDays:Number(state.completedDays||0)+done,updatedAt:new Date().toISOString(),lastBatchDays:done,lastBatchAdded:added,recordCount:merged.length,first:merged[0]?.datetime,last:merged.at(-1)?.datetime},null,2)+'\n');
 console.log(JSON.stringify({from:state.nextDate||MIN_DATE,to:dateAdd(next,-1),days:done,added,total:merged.length,nextDate:next,first:merged[0]?.datetime,last:merged.at(-1)?.datetime},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
