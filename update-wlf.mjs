import * as cheerio from 'cheerio';
import fs from 'fs';

const URL = 'https://www.estrazionelotto.it/archivio-winforlife';
const DATA_FILE = 'winforlife_draws.json';
const DEBUG_FILE = 'debug-wlf.html';

async function scrape() {
  const res = await fetch(URL);
  const html = await res.text();

  // Salva HTML per debug (così possiamo vedere la struttura reale)
  fs.writeFileSync(DEBUG_FILE, html);

  const $ = cheerio.load(html);
  const draws = [];

  // Prova diversi selettori comuni per trovare le righe della tabella
  const rows = $('table tr, .archivio-table tr, .estrazione-row, div[class*="riga"]');
  console.log(`Trovate ${rows.length} potenziali righe.`);

  rows.each((i, row) => {
    const cols = $(row).find('td');
    if (cols.length >= 13) {
      const numero = parseInt($(cols[0]).text().trim(), 10);
      const data = $(cols[1]).text().trim();
      const ora = $(cols[2]).text().trim();
      const numbers = [];
      for (let j = 3; j <= 12; j++) {
        numbers.push(parseInt($(cols[j]).text().trim(), 10));
      }
      const numerone = parseInt($(cols[13]).text().trim(), 10);
      if (!isNaN(numero) && numbers.length === 10 && !isNaN(numerone)) {
        const [day, month, year] = data.split('/');
        const datetime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${ora}`;
        draws.push({ datetime, numbers, numerone, numero });
      }
    }
  });

  console.log(`Estrazioni parse: ${draws.length}`);

  draws.sort((a, b) => a.datetime.localeCompare(b.datetime));

  let existing = [];
  if (fs.existsSync(DATA_FILE)) {
    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  const existingKeys = new Set(existing.map(d => d.datetime));
  for (const d of draws) {
    if (!existingKeys.has(d.datetime)) {
      existing.push(d);
    }
  }
  existing.sort((a, b) => a.datetime.localeCompare(b.datetime));
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
  console.log(`Aggiornamento completato: ${existing.length} estrazioni totali.`);
}

scrape().catch(console.error);