import fs from 'node:fs';

const URL = 'https://www.estrazionelotto.it/archivio-winforlife';
const DATA_FILE = 'winforlife_draws.json';
const DEBUG_FILE = 'debug-wlf.html';
const BACKUP_DIR = 'data/archive';

function parseDraws(html) {
  const blocks = [...html.matchAll(/Estrazione\s+n[°º]\s*(\d+)\s*\((\d{2}:\d{2})\)([\s\S]*?)(?=Estrazione\s+n[°º]\s*\d+\s*\(\d{2}:\d{2}\)|$)/gi)];
  const out = [];
  for (const m of blocks) {
    const plain = m[3].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, ' ').replace(/\s+/g, ' ');
    const date = plain.match(/del\s+(\d{2})-(\d{2})-(\d{4})/i);
    const extractedAt = plain.search(/ESTRATTI/i);
    const numeroneAt = plain.search(/NUMERONE/i);
    if (!date || extractedAt < 0 || numeroneAt < extractedAt) continue;
    const numbers = (plain.slice(extractedAt + 'ESTRATTI'.length, numeroneAt).match(/\b(?:[1-9]|1[0-9]|20)\b/g) || []).map(Number);
    const numeroneMatch = plain.slice(numeroneAt).match(/NUMERONE\s+(\d{1,2})/i);
    if (numbers.length < 10 || new Set(numbers.slice(0, 10)).size !== 10 || !numeroneMatch) continue;
    const numerone = Number(numeroneMatch[1]);
    if (numerone < 1 || numerone > 20) continue;
    out.push({
      datetime: `${date[3]}-${date[2]}-${date[1]}T${m[2]}`,
      numbers: numbers.slice(0, 10).sort((a,b)=>a-b),
      numerone,
      numero: Number(m[1])
    });
  }
  return out;
}
function valid(d) {
  return d && Number.isInteger(Number(d.numero)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.datetime || '') &&
    Array.isArray(d.numbers) && d.numbers.length === 10 &&
    d.numbers.every(n=>Number.isInteger(Number(n)) && n>=1 && n<=20) &&
    new Set(d.numbers.map(Number)).size === 10 &&
    Number.isInteger(Number(d.numerone)) && d.numerone>=1 && d.numerone<=20;
}
async function main() {
  const response = await fetch(URL, {headers:{'user-agent':'WFL-SONAR-data-maintenance/1.0'}});
  if (!response.ok) throw new Error(`Archive HTTP ${response.status}`);
  const html = await response.text();
  fs.writeFileSync(DEBUG_FILE, html);
  const scraped = parseDraws(html).filter(valid);
  if (!scraped.length) throw new Error('Parser produced zero valid draws; refusing to alter historical dataset.');
  const current = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : [];
  if (!Array.isArray(current)) throw new Error('Existing dataset is not an array; refusing overwrite.');
  const byNumber = new Map();
  const key = d => `${String(d.datetime).slice(0,4)}:${Number(d.numero)}`;
  for (const d of current) {
    if (!valid(d)) throw new Error(`Invalid existing record; refusing overwrite: ${JSON.stringify(d)}`);
    const id = key(d), prev = byNumber.get(id);
    if (prev && JSON.stringify(prev) !== JSON.stringify(d)) throw new Error(`Conflicting existing records for draw ${id}`);
    byNumber.set(id, d);
  }
  let added = 0, unchanged = 0;
  for (const d of scraped) {
    const id = key(d), prev = byNumber.get(id);
    if (prev) {
      if (JSON.stringify(prev.numbers.map(Number)) !== JSON.stringify(d.numbers) || Number(prev.numerone)!==d.numerone || prev.datetime!==d.datetime) {
        throw new Error(`Source conflict for draw ${id}; preserved existing dataset and stopped.`);
      }
      unchanged++;
    } else { byNumber.set(id, d); added++; }
  }
  const merged = [...byNumber.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime));
  // Immutable dated snapshot before every write. The existing file is never replaced with a smaller set.
  fs.mkdirSync(BACKUP_DIR, {recursive:true});
  const snapshot = `${BACKUP_DIR}/winforlife_draws_${new Date().toISOString().slice(0,10)}.json`;
  if (fs.existsSync(DATA_FILE) && !fs.existsSync(snapshot)) fs.copyFileSync(DATA_FILE, snapshot);
  if (merged.length < current.length) throw new Error('Merge would reduce history; refusing write.');
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2) + '\n');
  console.log(JSON.stringify({
    sourceDraws:scraped.length, added, unchanged, before:current.length, after:merged.length,
    first:merged[0]?.datetime, last:merged.at(-1)?.datetime, snapshot
  }, null, 2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
