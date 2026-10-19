export function latestExpectedSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  let y = Number(parts.year), m = Number(parts.month), d = Number(parts.day), h = Number(parts.hour);
  // A confirmed draw in the current hour is valid immediately; never roll back
  // to the previous slot merely because the current hour is less than 20 minutes old.
  if (h < 7) {
    const previous = new Date(Date.UTC(y, m - 1, d));
    previous.setUTCDate(previous.getUTCDate() - 1);
    y = previous.getUTCFullYear(); m = previous.getUTCMonth() + 1; d = previous.getUTCDate(); h = 23;
  }
  if (h > 23) h = 23;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`;
}

export function isOfficiallyConfirmed(draw, sourceSets) {
  const id = d => `${String(d.datetime).slice(0, 4)}:${Number(d.numero)}`;
  return sourceSets
    .filter(source => source.label.startsWith('official-'))
    .some(source => source.draws.some(candidate =>
      id(candidate) === id(draw) &&
      candidate.datetime === draw.datetime &&
      Number(candidate.numerone) === Number(draw.numerone) &&
      JSON.stringify(candidate.numbers.map(Number).sort((a, b) => a - b)) ===
        JSON.stringify(draw.numbers.map(Number).sort((a, b) => a - b))
    ));
}
