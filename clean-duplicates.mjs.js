import fs from 'fs';

const DATA_FILE = 'winforlife_draws.json';

function clean() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('File non trovato.');
    return;
  }

  const all = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const seen = new Map();

  // Tieni solo la prima occorrenza per ogni numero di concorso
  const cleaned = [];
  for (const d of all) {
    if (!d.numero) {
      // Se manca il numero del concorso, non possiamo deduplicare; teniamolo
      cleaned.push(d);
      continue;
    }
    if (!seen.has(d.numero)) {
      seen.set(d.numero, true);
      cleaned.push(d);
    }
  }

  cleaned.sort((a, b) => a.datetime.localeCompare(b.datetime));
  fs.writeFileSync(DATA_FILE, JSON.stringify(cleaned, null, 2));
  console.log(`Rimossi ${all.length - cleaned.length} duplicati. Totale: ${cleaned.length} estrazioni.`);
}

clean();