import fs from 'node:fs';

const DATA_FILE = 'winforlife_draws.json';
const BACKUP_DIR = 'data/archive';
const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function decode(s) {
  return s.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&deg;/gi, '°').replace(/&#(?:186|xba);/gi, 'º')
    .replace(/&egrave;/gi, 'è').replace(/&agrave;/gi, 'à')
    .replace(/&igrave;/gi, 'ì').replace(/&ograve;/gi, 'ò').replace(/&ugrave;/gi, 'ù')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}
function plainText(html) {
  return decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}
function valid(d) {
  return d && Number.isInteger(Number(d.numero)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime || '') &&
    Array.isArray(d.numbers) && d.numbers.length === 10 &&
    d.numbers.every(n => Number.isInteger(Number(n)) && n >= 1 && n <= 20) &&
    new Set(d.numbers.map(Number)).size === 10 &&
    Number.isInteger(Number(d.numerone)) && Number(d.numerone) >= 1 && Number(d.numerone) <= 20;
}
function parseOfficial(html, iso) {
  const text = plainText(html);
  const blocks = text.split(/(?=N\s*[º°]\s*\d+\s+del\s+)/i).slice(1);
  const out = [];
  for (const block of blocks) {
    const h = block.match(/^N\s*[º°]\s*(\d+)\s+del\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\s+([01]\d|2[0-3]):([0-5]\d)/i);
    if (!h) continue;
    const month = MONTHS.indexOf(h[3].toLocaleLowerCase('it')) + 1;
    if (!month) continue;
    const date = `${h[4]}-${String(month).padStart(2,'0')}-${String(h[2]).padStart(2,'0')}`;
    if (date !== iso) continue;
    const values = (block.slice(h[0].length).match(/\b(?:[1-9]|1[0-9]|20)\b/g) || []).map(Number);
    if (values.length < 11) continue;
    const d = {datetime:`${date}T${h[5]}:${h[6]}`, numbers:values.slice(0,10).sort((a,b)=>a-b), numerone:values[10], numero:Number(h[1])};
    if (valid(d)) out.push(d);
  }
  const map = new Map();
  for (const d of out) {
    const k = d.datetime;
    if (map.has(k) && JSON.stringify(map.get(k)) !== JSON.stringify(d)) throw new Error(`Official source conflict for ${k}`);
    map.set(k,d);
  }
  return [...map.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime));
}
function isoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function addDay(iso) {
  const d = new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return isoDate(d);
}
async function fetchDay(iso) {
  const [y,m,d] = iso.split('-');
  const url = `https://www.winforlife.it/archivio-estrazioni-classico/${y}/${MONTHS[Number(m)-1]}/${Number(d)}?_wfl_repair=${Date.now()}`;
  const response = await fetch(url, {cache:'no-store', headers:{
    'user-agent':'WFL-SONAR-2026-repair/1.0 (+https://github.com/jamesnuvola/WFL)',
    'cache-control':'no-cache, no-store, max-age=0', pragma:'no-cache',
    accept:'text/html,application/xhtml+xml'
  }});
  if (!response.ok) throw new Error(`Official archive HTTP ${response.status} for ${iso}`);
  return parseOfficial(await response.text(), iso);
}
function validateDay(iso, draws, isToday) {
  if (!draws.length) throw new Error(`No official results parsed for ${iso}; refusing to change dataset.`);
  const hours = draws.map(d=>Number(d.datetime.slice(11,13))).sort((a,b)=>a-b);
  if (new Set(hours).size !== hours.length || hours.some(h=>h<7||h>23)) throw new Error(`Duplicate/invalid hours for ${iso}`);
  const expectedCount = isToday ? draws.length : 17;
  if (draws.length !== expectedCount) throw new Error(`Expected ${expectedCount} official draws for ${iso}, got ${draws.length}; refusing partial repair.`);
  if (!isToday && (hours.length!==17 || hours.some((h,i)=>h!==i+7))) throw new Error(`Missing hourly slot for ${iso}`);
  if (isToday && hours.some((h,i)=>h !== hours[0]+i)) throw new Error(`Non-contiguous published slots for current day ${iso}`);
  for (let i=1;i<draws.length;i++) if (draws[i].numero !== draws[i-1].numero+1) throw new Error(`Contest numbering gap on ${iso}: ${draws[i-1].numero} to ${draws[i].numero}`);
}
async function main() {
  const current = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
  if (!Array.isArray(current) || current.some(d=>!valid(d))) throw new Error('Existing dataset invalid; repair stopped without writing.');
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  let date = '2026-01-01';
  const rebuilt = [];
  let days = 0;
  while (date <= today) {
    const draws = await fetchDay(date);
    validateDay(date, draws, date===today);
    rebuilt.push(...draws);
    days++;
    if (days % 10 === 0) console.log(`Verified ${days} dates through ${date}; records=${rebuilt.length}`);
    date = addDay(date);
    await sleep(200);
  }
  const counts = new Map();
  for (const d of rebuilt) counts.set(d.datetime.slice(0,10),(counts.get(d.datetime.slice(0,10))||0)+1);
  if (counts.size !== days) throw new Error('Duplicate/missing date coverage detected.');
  const contestIds = new Set();
  for (const d of rebuilt) {
    const id = `2026:${d.numero}`;
    if (contestIds.has(id)) throw new Error(`Duplicate 2026 contest number ${d.numero}`);
    contestIds.add(id);
  }
  // On every complete day, the official annual numbering should start at 1 and continue in hourly order.
  for (const d of rebuilt) {
    const dayOffset = Math.floor((Date.parse(d.datetime.slice(0,10)+'T00:00:00Z') - Date.parse('2026-01-01T00:00:00Z')) / 86400000);
    const expected = dayOffset*17 + (Number(d.datetime.slice(11,13))-6);
    if (d.numero !== expected) throw new Error(`2026 contest/date mismatch: ${d.datetime} is contest ${d.numero}, expected ${expected}`);
  }
  const non2026 = current.filter(d=>!String(d.datetime).startsWith('2026-'));
  const merged = [...non2026, ...rebuilt].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero);
  if (merged.length < current.length - current.filter(d=>String(d.datetime).startsWith('2026-')).length) throw new Error('Non-2026 history would be lost.');
  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const snapshot = `${BACKUP_DIR}/winforlife_draws_before_2026_repair_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  fs.copyFileSync(DATA_FILE,snapshot);
  fs.writeFileSync(DATA_FILE,JSON.stringify(merged,null,2)+'\n');
  console.log(JSON.stringify({source:'WinForLife.it official daily archive',year:2026,verifiedDays:days,replacedRecords:current.filter(d=>String(d.datetime).startsWith('2026-')).length,officialRecords:rebuilt.length,totalBefore:current.length,totalAfter:merged.length,first2026:rebuilt[0]?.datetime,firstContest:rebuilt[0]?.numero,last2026:rebuilt.at(-1)?.datetime,lastContest:rebuilt.at(-1)?.numero,snapshot},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
