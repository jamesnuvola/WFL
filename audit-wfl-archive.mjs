import fs from 'node:fs';

const DATA_FILE='winforlife_draws.json';
const STATE_FILE='data/archive/wfl-archive-audit-state.json';
const REPORT_FILE='data/archive/wfl-archive-audit-2022-2025.json';
const START='2022-01-25';
const END='2025-12-31';
const DAYS_PER_RUN=90;
const MONTHS=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function addDay(iso){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function decode(s){return s.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&deg;/gi,'°').replace(/&#(?:186|xba);/gi,'º').replace(/&egrave;/gi,'è').replace(/&agrave;/gi,'à').replace(/&igrave;/gi,'ì').replace(/&ograve;/gi,'ò').replace(/&ugrave;/gi,'ù').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");}
function plainText(html){return decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));}
function valid(d){return d&&Number.isInteger(Number(d.numero))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime||'')&&Array.isArray(d.numbers)&&d.numbers.length===10&&d.numbers.every(n=>Number.isInteger(Number(n))&&n>=1&&n<=20)&&new Set(d.numbers.map(Number)).size===10&&Number.isInteger(Number(d.numerone))&&Number(d.numerone)>=1&&Number(d.numerone)<=20;}
function parseOfficial(html,iso){
 const blocks=plainText(html).split(/(?=N\s*[º°]\s*\d+\s+del\s+)/i).slice(1),out=[];
 for(const block of blocks){
  const h=block.match(/^N\s*[º°]\s*(\d+)\s+del\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\s+([01]\d|2[0-3]):([0-5]\d)/i);
  if(!h)continue;
  const month=MONTHS.indexOf(h[3].toLocaleLowerCase('it'))+1;if(!month)continue;
  const day=String(h[4]+'-'+String(month).padStart(2,'0')+'-'+String(h[2]).padStart(2,'0'));
  if(day!==iso)continue;
  const vals=(block.slice(h[0].length).match(/\b(?:[1-9]|1[0-9]|20)\b/g)||[]).map(Number);
  if(vals.length<11)continue;
  const d={datetime:day+'T'+h[5]+':'+h[6],numbers:vals.slice(0,10).sort((a,b)=>a-b),numerone:vals[10],numero:Number(h[1])};
  if(valid(d))out.push(d);
 }
 const map=new Map();
 for(const d of out){const prev=map.get(d.datetime);if(prev&&JSON.stringify(prev)!==JSON.stringify(d))throw new Error('duplicate/conflicting official rows at '+d.datetime);map.set(d.datetime,d);}
 return [...map.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime));
}
async function fetchDay(iso){
 const [y,m,d]=iso.split('-'),url='https://www.winforlife.it/archivio-estrazioni-classico/'+y+'/'+MONTHS[Number(m)-1]+'/'+Number(d)+'?_wfl_audit='+Date.now();
 const r=await fetch(url,{cache:'no-store',headers:{'user-agent':'WFL-SONAR-archive-audit/1.0 (+https://github.com/jamesnuvola/WFL)','cache-control':'no-cache, no-store, max-age=0','pragma':'no-cache','accept':'text/html,application/xhtml+xml'}});
 if(!r.ok)throw new Error('HTTP '+r.status);
 return parseOfficial(await r.text(),iso);
}
function same(a,b){return a.datetime===b.datetime&&Number(a.numero)===Number(b.numero)&&Number(a.numerone)===Number(b.numerone)&&a.numbers.map(Number).sort((x,y)=>x-y).join(',')===b.numbers.map(Number).sort((x,y)=>x-y).join(',');}
async function main(){
 const current=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
 if(!Array.isArray(current)||current.some(d=>!valid(d)))throw new Error('Stored archive invalid; audit stopped.');
 const byDate=new Map();
 for(const d of current){if(!String(d.datetime).startsWith('2022-')&&!String(d.datetime).startsWith('2023-')&&!String(d.datetime).startsWith('2024-')&&!String(d.datetime).startsWith('2025-'))continue;const date=d.datetime.slice(0,10);if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(d);}
 const state=fs.existsSync(STATE_FILE)?JSON.parse(fs.readFileSync(STATE_FILE,'utf8')):{nextDate:START,completedDates:0,updatedAt:null};
 const report=fs.existsSync(REPORT_FILE)?JSON.parse(fs.readFileSync(REPORT_FILE,'utf8')):{source:'WinForLife.it official daily archive',range:{from:START,to:END},startedAt:new Date().toISOString(),completedDates:0,checkedDays:0,findings:[],totals:{officialDraws:0,storedDraws:0,missingRecords:0,extraRecords:0,conflicts:0,emptyOfficialPages:0,fetchErrors:0}};
 let date=state.nextDate||START,done=0;
 while(date<=END&&done<DAYS_PER_RUN){
  let official=[],fetchError=null;
  try{official=await fetchDay(date);}catch(e){fetchError=String(e.message||e);}
  const stored=(byDate.get(date)||[]).slice().sort((a,b)=>a.datetime.localeCompare(b.datetime));
  const offByDate=new Map(official.map(d=>[d.datetime,d]));
  const storeByDate=new Map(stored.map(d=>[d.datetime,d]));
  const missing=official.filter(d=>!storeByDate.has(d.datetime));
  const extra=stored.filter(d=>!offByDate.has(d.datetime));
  const conflicts=official.filter(d=>storeByDate.has(d.datetime)&&!same(d,storeByDate.get(d.datetime)));
  const finding={date,officialDraws:official.length,storedDraws:stored.length,missingRecords:missing.map(d=>({datetime:d.datetime,numero:d.numero})),extraRecords:extra.map(d=>({datetime:d.datetime,numero:d.numero})),conflicts:conflicts.map(d=>({datetime:d.datetime,numero:d.numero,official:{numbers:d.numbers,numerone:d.numerone},stored:{numbers:storeByDate.get(d.datetime).numbers,numerone:storeByDate.get(d.datetime).numerone}}))};
  if(fetchError){finding.status='fetch_error';finding.error=fetchError;report.totals.fetchErrors++;}
  else if(!official.length){finding.status='official_empty';report.totals.emptyOfficialPages++;}
  else if(missing.length||extra.length||conflicts.length)finding.status='mismatch';
  else finding.status='match';
  report.totals.officialDraws+=official.length;report.totals.storedDraws+=stored.length;report.totals.missingRecords+=missing.length;report.totals.extraRecords+=extra.length;report.totals.conflicts+=conflicts.length;
  if(finding.status!=='match')report.findings.push(finding);
  report.checkedDays++;report.completedDates++;
  done++;date=addDay(date);await sleep(180);
 }
 report.updatedAt=new Date().toISOString();report.nextDate=date;report.complete=date>END;
 fs.mkdirSync('data/archive',{recursive:true});
 fs.writeFileSync(STATE_FILE,JSON.stringify({nextDate:date,completedDates:Number(state.completedDates||0)+done,updatedAt:report.updatedAt,lastBatchDays:done,source:'WinForLife.it official daily archive'},null,2)+'\n');
 fs.writeFileSync(REPORT_FILE,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({from:state.nextDate||START,to:date<=END?date:'2025-12-31',batchDays:done,nextDate:date,complete:report.complete,checkedDays:report.checkedDays,findings:report.findings.length,totals:report.totals},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
