import * as cheerio from 'cheerio';
import fs from 'fs';

const URL = 'https://www.estrazionelotto.it/archivio-winforlife';
const DATA_FILE = 'winforlife_draws.json';
const DEBUG_FILE = 'debug-wlf.html';

async function scrape() {
  const res = await fetch(URL);
  const html = await res.text();
  fs.writeFileSync(DEBUG_FILE, html);

  const $ = cheerio.load(html);
  const pageText = $('body').text(); // tutto il testo della pagina

  // Cerchiamo tutti i blocchi "Estrazione n° XXXX (HH:MM)"
  const blockRegex = /Estrazione\s+n[°º]\s*(\d+)\s*\((\d{2}:\d{2})\)\s*\n\s*del\s+(\d{2}-\d{2}-\d{4})/gi;
  const draws = [];
  let match;

  while ((match = blockRegex.exec(pageText)) !== null) {
    const numero = parseInt(match[1], 10);
    const ora = match[2];
    const dataCompleta = match[3];
    const [day, month, year] = dataCompleta.split('-');
    const datetime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${ora}`;

    // Dal punto in cui abbiamo trovato l'intestazione, prendiamo tutto fino a "NUMERONE"
    const startIdx = match.index + match[0].length;
    const afterHeader = pageText.substring(startIdx, startIdx + 300); // prendiamo abbastanza testo
    const numeroneMatch = afterHeader.match(/NUMERONE\s*(\d+)/i);
    if (!numeroneMatch) continue;
    const numerone = parseInt(numeroneMatch[1], 10);

    // Raccogliamo tutti i numeri tra 1 e 20 che appaiono prima di NUMERONE
    const numbersText = afterHeader.substring(0, afterHeader.indexOf('NUMERONE'));
    const numberMatches = numbersText.match(/\b([1-9]|1[0-9]|20)\b/g);
    if (!numberMatches || numberMatches.length < 10) continue;
    const numbers = numberMatches.slice(0, 10).map(Number);

    if (numbers.length === 10 && numerone >= 1 && numerone <= 20) {
      draws.push({ datetime, numbers, numerone, numero });
    }
  }

  console.log(`Estrazioni trovate: ${draws.length}`);

  // Deduplica per numero concorso
  const unique = new Map();
  for (const d of draws) unique.set(d.numero, d);
  const finalDraws = [...unique.values()];
  finalDraws.sort((a, b) => a.datetime.localeCompare(b.datetime));

  if (finalDraws.length > 0) {
    console.log(`Ultima estratta: ${finalDraws[finalDraws.length - 1].datetime}`);
  }

  // Merge con esistente
  let existing = [];
  if (fs.existsSync(DATA_FILE)) {
    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  const existingNumbers = new Set(existing.map(d => d.numero).filter(n => n));
  let added = 0;
  for (const d of finalDraws) {
    if (d.numero && !existingNumbers.has(d.numero)) {
      existing.push(d);
      existingNumbers.add(d.numero);
      added++;
    }
  }
  existing.sort((a, b) => a.datetime.localeCompare(b.datetime));
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
  console.log(`Aggiunte ${added} nuove estrazioni. Totale: ${existing.length}`);
}

scrape().catch(console.error);