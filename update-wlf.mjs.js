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

  // Cerchiamo TUTTI i blocchi che contengono un numerone (cerchio rosso)
  const blocks = $('div').filter((i, el) => {
    return $(el).find('span[class*="bg-red-500"]').length > 0;
  });

  console.log(`Blocchi con numerone trovati: ${blocks.length}`);

  blocks.each((i, block) => {
    // Estrai il numero dell'estrazione e l'orario
    const headerText = $(block).find('span').first().text().trim();
    const numeroMatch = headerText.match(/Estrazione n°\s*(\d+)\s*\((\d{2}:\d{2})\)/);
    if (!numeroMatch) return;

    const numero = parseInt(numeroMatch[1], 10);
    const ora = numeroMatch[2];

    // Estrai la data
    const dataText = $(block).find('span:contains("del")').text().trim();
    const dataMatch = dataText.match(/del\s+(\d{2}-\d{2}-\d{4})/);
    if (!dataMatch) return;

    const [day, month, year] = dataMatch[1].split('-');
    const datetime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${ora}`;

    // Estrai i 10 numeri
    const numberElements = $(block).find('div[class*="grid grid-cols-5"] div[class*="font-bold text-center"]');
    if (numberElements.length !== 10) return;

    const numbers = [];
    numberElements.each((j, el) => {
      const num = parseInt($(el).text().trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= 20) numbers.push(num);
    });
    if (numbers.length !== 10) return;

    // Estrai il Numerone
    const numeroneElement = $(block).find('span[class*="bg-red-500"]');
    const numerone = parseInt(numeroneElement.text().trim(), 10);
    if (isNaN(numerone) || numerone < 1 || numerone > 20) return;

    draws.push({ datetime, numbers, numerone, numero });
  });

  console.log(`Estrazioni parse: ${draws.length}`);
  if (draws.length > 0) {
    console.log(`Ultima estratta: ${draws[draws.length-1].datetime}`);
  }

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