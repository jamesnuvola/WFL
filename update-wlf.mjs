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
  const draws = [];

  // Cerca TUTTI i blocchi che contengono la scritta "Estrazione n°"
  const estrazioneRegex = /Estrazione n[°º]\s*(\d+)\s*\((\d{2}:\d{2})\)/i;
  const dataRegex = /del\s+(\d{2}-\d{2}-\d{4})/i;

  $('body').find('div').each((i, div) => {
    const divText = $(div).text();
    const estrazioneMatch = divText.match(estrazioneRegex);
    const dataMatch = divText.match(dataRegex);

    if (estrazioneMatch && dataMatch) {
      const numero = parseInt(estrazioneMatch[1], 10);
      const ora = estrazioneMatch[2];
      const dataCompleta = dataMatch[1];
      const [day, month, year] = dataCompleta.split('-');
      const datetime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${ora}`;

      // Estrai tutti i numeri tra 1 e 20
      const allNumbers = [];
      const spans = $(div).find('div, span');
      spans.each((j, el) => {
        const t = $(el).text().trim();
        if (/^\d{1,2}$/.test(t)) {
          const n = parseInt(t, 10);
          if (n >= 1 && n <= 20) allNumbers.push(n);
        }
      });

      // I primi 10 numeri validi sono l'estrazione, l'11° è il Numerone
      if (allNumbers.length >= 11) {
        const numbers = allNumbers.slice(0, 10);
        const numerone = allNumbers[10]; // il primo dopo i 10
        if (numerone >= 1 && numerone <= 20) {
          draws.push({ datetime, numbers, numerone, numero });
        }
      }
    }
  });

  // Deduplica per datetime (potrebbero esserci duplicati dovuti a div annidati)
  const unique = new Map();
  for (const d of draws) {
    unique.set(d.datetime, d);
  }
  const finalDraws = [...unique.values()];

  console.log(`Estrazioni trovate: ${finalDraws.length}`);
  if (finalDraws.length > 0) {
    finalDraws.sort((a, b) => a.datetime.localeCompare(b.datetime));
    console.log(`Ultima estratta: ${finalDraws[finalDraws.length - 1].datetime}`);
  }

  // Merge con esistente
  let existing = [];
  if (fs.existsSync(DATA_FILE)) {
    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  const existingKeys = new Set(existing.map(d => d.datetime));
  for (const d of finalDraws) {
    if (!existingKeys.has(d.datetime)) {
      existing.push(d);
    }
  }
  existing.sort((a, b) => a.datetime.localeCompare(b.datetime));
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
  console.log(`Aggiornamento completato: ${existing.length} estrazioni totali.`);
}

scrape().catch(console.error);
