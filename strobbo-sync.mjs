// Haalt de Strobbo-agenda op en zet de diensten klaar voor Loonboek (Firestore: loonboek/strobbo)
const API_KEY = 'AIzaSyC399MvSiF3PWF_ZTdFr0UqaoC6Fo7WsrY';
const PROJECT = 'wiezen-club';

let url = process.env.STROBBO_URL;
if (!url) { console.error('Geheim STROBBO_URL ontbreekt'); process.exit(1); }
url = url.trim().replace(/^webcal:\/\//i, 'https://');

const res = await fetch(url);
if (!res.ok) { console.error('Strobbo gaf een fout:', res.status); process.exit(1); }
const ics = await res.text();
if (!ics.includes('BEGIN:VCALENDAR')) { console.error('Geen geldige agenda ontvangen'); process.exit(1); }

const lines = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
const events = [];
let cur = null;
for (const line of lines) {
  if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
  if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
  if (!cur) continue;
  const i = line.indexOf(':');
  if (i < 0) continue;
  const key = line.slice(0, i).split(';')[0].toUpperCase();
  cur[key] = line.slice(i + 1);
}

const unesc = s => (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

function lokaleDatum(v) {
  const m = (v || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return { datum: `${g('year')}-${g('month')}-${g('day')}`, ms: d.getTime() };
  }
  return { datum: `${m[1]}-${m[2]}-${m[3]}`, ms: Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) };
}

const diensten = [];
for (const e of events) {
  if (!e.DTSTART) continue;
  const titel = unesc(e.SUMMARY);
  const beschr = unesc(e.DESCRIPTION);
  if (/geweigerd|geannuleerd/i.test(titel + ' ' + beschr)) continue;
  const start = lokaleDatum(e.DTSTART);
  if (!start) continue;

  let uren = null, tijd = '';
  const w = beschr.match(/Werktijd:\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
  if (w) {
    const a = +w[1] * 60 + +w[2];
    let b = +w[3] * 60 + +w[4];
    if (b <= a) b += 1440;
    uren = (b - a) / 60;
    tijd = `${w[1].padStart(2, '0')}:${w[2]}-${w[3].padStart(2, '0')}:${w[4]}`;
  } else if (e.DTEND) {
    const eind = lokaleDatum(e.DTEND);
    uren = (eind.ms - start.ms) / 3600000;
  }
  if (!uren || uren <= 0) continue;

  const soort = (beschr.split('\n')[0] || titel.replace(/\s*\(.*\)\s*$/, '')).trim();
  const opm = (beschr.match(/Opmerking:\s*(.+)/i) || [])[1];
  diensten.push({
    strobboId: e.UID || `${start.datum}-${tijd}`,
    date: start.datum,
    planned: Math.round(uren * 100) / 100,
    note: ['Strobbo', soort, tijd, opm && opm.trim()].filter(Boolean).join(' · ')
  });
}

const body = { fields: {
  json: { stringValue: JSON.stringify(diensten) },
  bijgewerkt: { stringValue: new Date().toISOString() }
} };
const fsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/loonboek/strobbo?key=${API_KEY}&updateMask.fieldPaths=json&updateMask.fieldPaths=bijgewerkt`;
const r = await fetch(fsUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!r.ok) { console.error('Firestore fout:', r.status, await r.text()); process.exit(1); }
console.log(`${diensten.length} diensten doorgestuurd naar Loonboek`);
