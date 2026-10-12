import fs from 'node:fs';

const OFFICIAL_URL = 'https://www.winforlife.it/archivio-estrazioni-classico';
const FALLBACK_URL = 'https://www.estrazionelotto.it/archivio-winforlife';
const DATA_FILE = 'winforlife_draws.json';
const BACKUP_DIR = 'data/archive';

const MONTHS = {
  gennaio:'01', febbraio:'02', marzo:'03', aprile:'04', maggio:'05', giugno:'06',
  luglio:'07', agosto:'08', settembre:'09', ottobre:'10', novembre:'11', dicembre:'12'
};

function valid(d) {
  return d && Number.isInteger(Number(d.numero)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime || '') &&
    Array.isArray(d.numbers) && d.numbers.length === 10 &&
    d.numbers.every(n => Number.isInteger(Number(n)) && n >= 1 && n <= 20) &&
    new Set(d.numbers.map(Number)).size === 10 &&
    Number.isInteger(Number(d.numerone)) && Number(d.numerone) >= 1 && Number(d.numerone) <= 20;
}
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
function parseOfficial(html) {
  // Parse each official archive row. Expected text: "Nº 4833 del 12 Ottobre 2026 11:00 [10 numbers] [Numerone]".
  const text = plainText(html);
  const blocks = text.split(/(?=N\s*[º°]\s*\d+\s+del\s+)/i).slice(1);
  const out = [];
  for (const block of blocks) {
    const head = block.match(/^N\s*[º°]\s*(\d+)\s+del\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\s+([01]\d|2[0-3]):([0-5]\d)/i);
    if (!head) continue;
    const month = MONTHS[head[3].toLocaleLowerCase('it')];
    if (!month) continue;
    const timeEnd = head[0].length;
    const nextHeader = block.slice(timeEnd);
    const values = (nextHeader.match(/\b(?:[1-9]|1[0-9]|20)\b/g) || []).map(Number);
    if (values.length < 11) continue;
    const numbers = values.slice(0, 10);
    const numerone = values[10];
    const d = {
      datetime: `${head[4]}-${month}-${String(head[2]).padStart(2,'0')}T${head[5]}:${head[6]}`,
      numbers: numbers.sort((a,b) => a-b),
      numerone,
      numero: Number(head[1])
    };
    if (valid(d)) out.push(d);
  }
  return dedupe(out);
}
function parseFallback(html) {
  const blocks = [...html.matchAll(/Estrazione\s+n[°º]\s*(\d+)\s*\((\d{2}:\d{2})\)([\s\S]*?)(?=Estrazione\s+n[°º]\s*\d+\s*\(\d{2}:\d{2}\)|$)/gi)];
  const out = [];
  for (const m of blocks) {
    const plain = decode(m[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
    const date = plain.match(/del\s+(\d{2})-(\d{2})-(\d{4})/i);
    const extractedAt = plain.search(/ESTRATTI/i);
    const numeroneAt = plain.search(/NUMERONE/i);
    if (!date || extractedAt < 0 || numeroneAt < extractedAt) continue;
    const numbers = (plain.slice(extractedAt + 7, numeroneAt).match(/\b(?:[1-9]|1[0-9]|20)\b/g) || []).map(Number);
    const nm = plain.slice(numeroneAt).match(/NUMERONE\s+(\d{1,2})/i);
    const d = {
      datetime: `${date[3]}-${date[2]}-${date[1]}T${m[2]}`,
      numbers: numbers.slice(0,10).sort((a,b) => a-b),
      numerone: Number(nm?.[1]),
      numero: Number(m[1])
    };
    if (valid(d)) out.push(d);
  }
  return dedupe(out);
}
function dedupe(draws) {
  const map = new Map();
  for (const d of draws) {
    const key = `${d.datetime.slice(0,4)}:${d.numero}`;
    const prev = map.get(key);
    if (prev && JSON.stringify(prev) !== JSON.stringify(d)) {
      throw new Error(`Source contains conflicting versions for draw ${key}`);
    }
    map.set(key, d);
  }
  return [...map.values()].sort((a,b) => a.datetime.localeCompare(b.datetime) || a.numero-b.numero);
}
async function fetchText(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(url + separator + '_wfl_refresh=' + Date.now(), {
    cache: 'no-store',
    headers: {
      'user-agent': 'WFL-SONAR-data-maintenance/2.0 (+https://github.com/jamesnuvola/WFL)',
      'cache-control': 'no-cache, no-store, max-age=0',
      'pragma': 'no-cache',
      'accept': 'text/html,application/xhtml+xml'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url} `);
  return response.text();
}
function latestExpectedSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(now).reduce((o,p) => (o[p.type]=p.value,o), {});
  let y=Number(parts.year), m=Number(parts.month), d=Number(parts.day), h=Number(parts.hour);
  const minute=Number(parts.minute);
  // Allow the previous slot for the first 25 minutes after the scheduled draw.
  if (h >= 7 && h <= 23 && minute < 25) h--;
  if (h > 23) h=23;
  if (h < 7) {
    const previous = new Date(Date.UTC(y,m-1,d));
    previous.setUTCDate(previous.getUTCDate()-1);
    y=previous.getUTCFullYear(); m=previous.getUTCMonth()+1; d=previous.getUTCDate(); h=23;
  }
  if (h > 23) h=23;
  if (h < 7) h=23;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00`;
}
async function main() {
  const errors = [];
  const sourceSets = [];
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/Rome', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o), {});
  const monthNames = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const dailyUrl = `${OFFICIAL_URL}/${parts.year}/${monthNames[Number(parts.month)-1]}/${Number(parts.day)}`;

  // The root archive can lag behind even while the daily page has newer contests.
  // Fetch each independently and union them; never treat a partial root page as complete.
  for (const [label, url] of [['official-root', OFFICIAL_URL], ['official-daily', dailyUrl]]) {
    try {
      const parsed = parseOfficial(await fetchText(url));
      if (parsed.length) sourceSets.push({label, draws:parsed});
      else errors.push(`${label}: no complete draws parsed`);
    } catch (e) { errors.push(`${label}: ${e.message}`); }
  }
  // The official root is sometimes cached/stale. Use the secondary archive only to
  // fill missing contests; duplicate contests must agree exactly or the sync stops.
  try {
    const parsed = parseFallback(await fetchText(FALLBACK_URL));
    if (parsed.length) sourceSets.push({label:'secondary-fallback', draws:parsed});
    else errors.push('secondary-fallback: no complete draws parsed');
  } catch (e) { errors.push(`secondary-fallback: ${e.message}`); }

  if (!sourceSets.length) throw new Error(`No valid draws parsed. ${errors.join(' | ')}`);
  let scraped = [];
  for (const set of sourceSets) scraped = dedupe([...scraped, ...set.draws]);

  const current = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : [];
  if (!Array.isArray(current) || current.some(d => !valid(d))) {
    throw new Error('Existing dataset is invalid; refusing to overwrite or repair it automatically.');
  }
  const key = d => `${String(d.datetime).slice(0,4)}:${Number(d.numero)}`;
  const byNumber = new Map();
  for (const d of current) {
    const id=key(d), prev=byNumber.get(id);
    if (prev && JSON.stringify(prev)!==JSON.stringify(d)) throw new Error(`Conflicting existing records for ${id}`);
    byNumber.set(id,d);
  }
  let added=0, unchanged=0;
  for (const d of scraped) {
    const id=key(d), prev=byNumber.get(id);
    if (prev) {
      if (prev.datetime!==d.datetime || Number(prev.numerone)!==d.numerone ||
          JSON.stringify(prev.numbers.map(Number).sort((a,b)=>a-b))!==JSON.stringify(d.numbers)) {
        throw new Error(`Source conflicts with stored draw ${id}; no data written.`);
      }
      unchanged++;
    } else { byNumber.set(id,d); added++; }
  }
  const merged=[...byNumber.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime)||a.numero-b.numero);
  if (merged.length < current.length) throw new Error('Merge would reduce history; refusing write.');

  const latest=merged.at(-1);
  const expected=latestExpectedSlot();
  if (latest.datetime < expected) {
    throw new Error(`Official/secondary archives are stale: latest stored draw ${latest.datetime}, expected at least ${expected}. No sync marked successful and no write performed. Sources: ${sourceSets.map(s=>s.label+':'+s.draws.at(-1)?.datetime).join(', ')}. ${errors.join(' | ')}`);
  }
  if (latest.datetime > expected) {
    const delta = Date.parse(latest.datetime) - Date.parse(expected);
    if (delta > 60*60*1000) throw new Error(`Unexpected future draw ${latest.datetime} versus expected slot ${expected}; write blocked.`);
  }

  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const snapshot=`${BACKUP_DIR}/winforlife_draws_${new Date().toISOString().slice(0,10)}.json`;
  if (fs.existsSync(DATA_FILE) && !fs.existsSync(snapshot)) fs.copyFileSync(DATA_FILE,snapshot);
  fs.writeFileSync(DATA_FILE,JSON.stringify(merged,null,2)+'\\n');
  console.log(JSON.stringify({
    sources:sourceSets.map(s=>({name:s.label,count:s.draws.length,latest:s.draws.at(-1)?.datetime,contest:s.draws.at(-1)?.numero})),
    added,unchanged,before:current.length,after:merged.length,
    expectedLatest:expected,latest:latest.datetime,latestContest:latest.numero,
    first:merged[0]?.datetime,snapshot,errors
  },null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
