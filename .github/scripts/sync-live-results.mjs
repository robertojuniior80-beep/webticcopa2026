import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'copa2026-c344c';
const FIREBASE_ACCESS_TOKEN = process.env.FIREBASE_ACCESS_TOKEN || '';
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const API_FOOTBALL_BASE_URL = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const API_FOOTBALL_HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const BRAZIL_TZ = 'America/Sao_Paulo';
const OVERNIGHT_LOOKBACK_HOURS = 6;
const ROOT_DIR = process.cwd();

function log(message){
  console.log(`[live-sync] ${message}`);
}

function fail(message){
  console.error(`[live-sync] ${message}`);
  process.exit(1);
}

function readFile(relativePath){
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function loadTeamNormalizer(){
  const scriptSource = readFile('public/head-to-head-data.js');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(scriptSource, sandbox);
  const normalizer = sandbox.window?.HEAD_TO_HEAD?.normalizeTeamName;
  if(typeof normalizer !== 'function'){
    fail('Nao foi possivel carregar o normalizador de times de public/head-to-head-data.js.');
  }
  return normalizer;
}

function extractActiveMatches(){
  const html = readFile('public/index.html');
  const matches = [...html.matchAll(/const ACTIVE_MATCHES = \[(.*?)\n\];/gs)];
  const lastMatch = matches.at(-1);
  if(!lastMatch){
    fail('Nao encontrei const ACTIVE_MATCHES em public/index.html.');
  }
  const literal = `[${lastMatch[1]}]`;
  return vm.runInNewContext(literal, {});
}

function normalizeTeamName(rawName, normalizeAlias){
  return normalizeAlias(String(rawName || '').trim());
}

function isPlaceholderTeam(name){
  return /^(1º|2º|3°|3º|Melhor|Venc\.|Perdedor)/i.test(String(name || '').trim());
}

function parseBrazilDateLabel(matchDate){
  const result = String(matchDate || '').match(/(\d{2})\/(\d{2})/);
  if(!result) return null;
  const [, day, month] = result;
  return `2026-${month}-${day}`;
}

function getBrazilNowParts(){
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = { year: '', month: '', day: '', hour: '', minute: '' };
  for(const part of formatter.formatToParts(new Date())){
    if(part.type in parts){
      parts[part.type] = part.value;
    }
  }
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || '0'),
    minute: Number(parts.minute || '0')
  };
}

function shiftIsoDate(isoDate, days){
  const date = isoToDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoToDate(isoDate){
  return new Date(`${isoDate}T00:00:00Z`);
}

function buildTrackedMatches(normalizeAlias){
  return extractActiveMatches()
    .filter(match => match && match.id && match.phase && !isPlaceholderTeam(match.home) && !isPlaceholderTeam(match.away))
    .map(match => {
      const isoDate = parseBrazilDateLabel(match.date);
      return {
        id: match.id,
        phase: match.phase,
        isoDate,
        home: normalizeTeamName(match.home, normalizeAlias),
        away: normalizeTeamName(match.away, normalizeAlias),
        pairKey: buildPairKey(
          normalizeTeamName(match.home, normalizeAlias),
          normalizeTeamName(match.away, normalizeAlias)
        )
      };
    })
    .filter(match => match.isoDate);
}

function buildPairKey(home, away){
  return [home, away].sort((a, b) => a.localeCompare(b, 'pt-BR')).join('__');
}

function pickDatesToQuery(trackedMatches){
  const now = getBrazilNowParts();
  const candidateDates = new Set([now.isoDate]);
  if(now.hour < OVERNIGHT_LOOKBACK_HOURS){
    candidateDates.add(shiftIsoDate(now.isoDate, -1));
  }

  return [...candidateDates].filter(isoDate =>
    trackedMatches.some(match => match.isoDate === isoDate)
  );
}

async function fetchApiFootballFixtures(isoDate){
  const url = new URL('/fixtures', API_FOOTBALL_BASE_URL);
  url.searchParams.set('date', isoDate);
  url.searchParams.set('timezone', BRAZIL_TZ);

  const response = await fetch(url, {
    headers: {
      'x-apisports-key': API_FOOTBALL_KEY,
      'x-rapidapi-key': API_FOOTBALL_KEY,
      'x-rapidapi-host': API_FOOTBALL_HOST
    }
  });

  if(!response.ok){
    const body = await response.text();
    throw new Error(`API-Football respondeu ${response.status} para ${isoDate}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

function isFinalFixtureStatus(fixture){
  const short = String(fixture?.fixture?.status?.short || '').toUpperCase();
  return ['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(short);
}

function toStringScore(value){
  return value === null || value === undefined ? '' : String(value);
}

function indexFixturesByDate(fixtures, normalizeAlias){
  const indexed = new Map();
  for(const fixture of fixtures || []){
    if(!isFinalFixtureStatus(fixture)) continue;
    const home = normalizeTeamName(fixture?.teams?.home?.name, normalizeAlias);
    const away = normalizeTeamName(fixture?.teams?.away?.name, normalizeAlias);
    const isoDate = String(fixture?.fixture?.date || '').slice(0, 10);
    const pairKey = buildPairKey(home, away);
    const key = `${isoDate}__${pairKey}`;
    indexed.set(key, {
      home,
      away,
      isoDate,
      homeScore: toStringScore(fixture?.goals?.home),
      awayScore: toStringScore(fixture?.goals?.away),
      fixtureId: fixture?.fixture?.id || null,
      status: fixture?.fixture?.status?.short || ''
    });
  }
  return indexed;
}

async function fetchExistingFirestoreResult(matchId){
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/results/${encodeURIComponent(matchId)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${FIREBASE_ACCESS_TOKEN}`
    }
  });

  if(response.status === 404){
    return null;
  }

  if(!response.ok){
    const body = await response.text();
    throw new Error(`Firestore GET falhou para ${matchId}: ${response.status} ${body.slice(0, 300)}`);
  }

  const doc = await response.json();
  return {
    home: doc?.fields?.home?.stringValue ?? '',
    away: doc?.fields?.away?.stringValue ?? ''
  };
}

async function writeFirestoreResult(matchId, home, away){
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/results/${encodeURIComponent(matchId)}`);
  url.searchParams.append('updateMask.fieldPaths', 'home');
  url.searchParams.append('updateMask.fieldPaths', 'away');

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${FIREBASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        home: { stringValue: String(home) },
        away: { stringValue: String(away) }
      }
    })
  });

  if(!response.ok){
    const body = await response.text();
    throw new Error(`Firestore PATCH falhou para ${matchId}: ${response.status} ${body.slice(0, 300)}`);
  }
}

async function main(){
  const normalizeAlias = loadTeamNormalizer();
  const trackedMatches = buildTrackedMatches(normalizeAlias);
  const datesToQuery = pickDatesToQuery(trackedMatches);

  log(`Partidas rastreadas: ${trackedMatches.length}`);
  log(`Datas candidatas para consulta: ${datesToQuery.length ? datesToQuery.join(', ') : 'nenhuma'}`);

  if(DRY_RUN){
    return;
  }

  if(!API_FOOTBALL_KEY){
    fail('Secret/API_FOOTBALL_KEY ausente.');
  }

  if(!FIREBASE_ACCESS_TOKEN){
    fail('Token de acesso do Firestore ausente em FIREBASE_ACCESS_TOKEN.');
  }

  if(!datesToQuery.length){
    log('Nenhuma partida sem placar final em janela de sincronizacao. Encerrando sem chamadas externas.');
    return;
  }

  const fixturesByDate = new Map();
  for(const isoDate of datesToQuery){
    const payload = await fetchApiFootballFixtures(isoDate);
    const indexed = indexFixturesByDate(payload?.response || [], normalizeAlias);
    fixturesByDate.set(isoDate, indexed);
    log(`API-Football ${isoDate}: ${indexed.size} fixture(s) finalizada(s) indexada(s).`);
  }

  const updates = [];
  for(const match of trackedMatches){
    const dateBucket = fixturesByDate.get(match.isoDate);
    if(!dateBucket) continue;
    const fixture = dateBucket.get(`${match.isoDate}__${match.pairKey}`);
    if(!fixture) continue;
    if(fixture.homeScore === '' || fixture.awayScore === '') continue;
    updates.push({
      id: match.id,
      home: fixture.homeScore,
      away: fixture.awayScore,
      status: fixture.status
    });
  }

  if(!updates.length){
    log('Nenhum placar final novo encontrado para gravar no Firestore.');
    return;
  }

  let writes = 0;
  for(const update of updates){
    const existing = await fetchExistingFirestoreResult(update.id);
    if(existing && existing.home === update.home && existing.away === update.away){
      log(`Sem mudanca em results/${update.id} (${update.home} x ${update.away}).`);
      continue;
    }

    await writeFirestoreResult(update.id, update.home, update.away);
    writes += 1;
    log(`Atualizado results/${update.id} -> ${update.home} x ${update.away} (${update.status}).`);
  }

  log(`Sincronizacao concluida com ${writes} escrita(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
