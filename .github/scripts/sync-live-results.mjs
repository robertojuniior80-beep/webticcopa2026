import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'copa2026-c344c';
const FIREBASE_ACCESS_TOKEN = process.env.FIREBASE_ACCESS_TOKEN || '';
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
const FIREBASE_REFRESH_TOKEN = process.env.FIREBASE_REFRESH_TOKEN || '';
const FIREBASE_CLIENT_ID = process.env.FIREBASE_CLIENT_ID || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = process.env.FIREBASE_CLIENT_SECRET || 'j9iVZfS8kkCEFUPaAeJV0sAi';
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const API_FOOTBALL_BASE_URL = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const API_FOOTBALL_HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const BRAZIL_TZ = 'America/Sao_Paulo';
const FINAL_SYNC_GRACE_MS = Number(process.env.FINAL_SYNC_GRACE_MS || 150 * 60 * 1000);
const MAX_DATES_PER_RUN = Math.max(1, Number(process.env.MAX_DATES_PER_RUN || 2));
const STALE_MATCH_AGE_MS = Number(process.env.STALE_MATCH_AGE_MS || 24 * 60 * 60 * 1000);
const ROOT_DIR = process.cwd();
let cachedFirestoreAccessToken = '';

async function exchangeRefreshTokenForAccessToken(){
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: FIREBASE_CLIENT_ID,
      client_secret: FIREBASE_CLIENT_SECRET,
      refresh_token: FIREBASE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  if(!response.ok){
    const body = await response.text();
    throw new Error(`OAuth refresh_token falhou: ${response.status} ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  if(!payload?.access_token){
    throw new Error('OAuth refresh_token sem access_token na resposta.');
  }
  return payload.access_token;
}

function log(message){
  console.log(`[live-sync] ${message}`);
}

function warn(message){
  console.warn(`[live-sync] ${message}`);
  if(process.env.GITHUB_ACTIONS === 'true'){
    console.log(`::warning::${message}`);
  }
}

function fail(message){
  console.error(`[live-sync] ${message}`);
  process.exit(1);
}

function toBase64Url(value){
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function readFile(relativePath){
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function parseServiceAccountCredentials(){
  if(!FIREBASE_SERVICE_ACCOUNT_JSON){
    return null;
  }

  try{
    const credentials = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
    if(!credentials.client_email || !credentials.private_key){
      throw new Error('JSON sem client_email/private_key.');
    }
    return credentials;
  }catch(error){
    fail(`Secret FIREBASE_SERVICE_ACCOUNT_JSON invalido: ${error.message}`);
  }
}

async function getFirestoreAccessToken(){
  if(cachedFirestoreAccessToken){
    return cachedFirestoreAccessToken;
  }

  if(FIREBASE_ACCESS_TOKEN){
    cachedFirestoreAccessToken = FIREBASE_ACCESS_TOKEN;
    return cachedFirestoreAccessToken;
  }

  if(FIREBASE_REFRESH_TOKEN){
    cachedFirestoreAccessToken = await exchangeRefreshTokenForAccessToken();
    return cachedFirestoreAccessToken;
  }

  const credentials = parseServiceAccountCredentials();
  if(!credentials){
    fail('Defina FIREBASE_ACCESS_TOKEN, FIREBASE_REFRESH_TOKEN ou FIREBASE_SERVICE_ACCOUNT_JSON para acessar o Firestore.');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600
  };

  const unsignedToken = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(claimSet))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(credentials.private_key);
  const assertion = `${unsignedToken}.${toBase64Url(signature)}`;

  const response = await fetch(claimSet.aud, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if(!response.ok){
    const body = await response.text();
    throw new Error(`OAuth token falhou: ${response.status} ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  if(!payload?.access_token){
    throw new Error('OAuth token sem access_token na resposta.');
  }

  cachedFirestoreAccessToken = payload.access_token;
  return cachedFirestoreAccessToken;
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
  const normalized = String(name || '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
  return /^(1º|2º|3°|3º|Melhor|Venc\.|Vencedor|Perdedor)/i.test(normalized);
}

function parseBrazilDateLabel(matchDate){
  const result = String(matchDate || '').match(/(\d{2})\/(\d{2})/);
  if(!result) return null;
  const [, day, month] = result;
  return `2026-${month}-${day}`;
}

function parseTrackedKickoff(matchDate){
  const result = String(matchDate || '').match(/(\d{2})\/(\d{2})(?:\s*[·\u00B7]\s*(\d{1,2})h(?:(\d{2}))?)?/);
  if(!result || result[3] === undefined){
    return null;
  }
  const [, day, month, hour, minute] = result;
  return new Date(`2026-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute || '00').padStart(2, '0')}:00-03:00`);
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
        kickoffAt: parseTrackedKickoff(match.date),
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

function formatKickoffForLog(kickoffAt){
  if(!(kickoffAt instanceof Date) || Number.isNaN(kickoffAt.getTime())){
    return 'horario indisponivel';
  }
  return kickoffAt.toISOString().replace('.000Z', 'Z');
}

function collectUnmatchedFinishedMatches(trackedMatches, fixturesByDate, now = Date.now()){
  return trackedMatches.filter(match => {
    const dateBucket = fixturesByDate.get(match.isoDate);
    if(!dateBucket) return false;
    if(!match.kickoffAt || Number.isNaN(match.kickoffAt.getTime())) return false;
    if(now < match.kickoffAt.getTime() + FINAL_SYNC_GRACE_MS) return false;
    const fixture = dateBucket.get(`${match.isoDate}__${match.pairKey}`);
    return !fixture;
  });
}

function pickDatesToQuery(trackedMatches, existingResultsByMatchId){
  const nowMs = Date.now();
  const hotDates = new Map();
  const staleDates = new Map();

  for(const match of trackedMatches){
    const existing = existingResultsByMatchId.get(match.id);
    const hasExistingResult = !!existing && existing.home !== '' && existing.away !== '';
    if(hasExistingResult) continue;

    if(!match.kickoffAt || Number.isNaN(match.kickoffAt.getTime())) continue;

    const kickoffMs = match.kickoffAt.getTime();
    const finalSyncReadyAt = kickoffMs + FINAL_SYNC_GRACE_MS;
    if(nowMs < finalSyncReadyAt) continue;

    const matchAgeMs = nowMs - kickoffMs;
    const bucket = matchAgeMs > STALE_MATCH_AGE_MS ? staleDates : hotDates;
    const current = bucket.get(match.isoDate);
    if(!current){
      bucket.set(match.isoDate, {
        isoDate: match.isoDate,
        oldestKickoffMs: kickoffMs,
        unresolvedMatches: 1
      });
      continue;
    }

    current.oldestKickoffMs = Math.min(current.oldestKickoffMs, kickoffMs);
    current.unresolvedMatches += 1;
  }

  const rankDates = items => items
    .sort((a, b) => a.oldestKickoffMs - b.oldestKickoffMs || b.unresolvedMatches - a.unresolvedMatches || a.isoDate.localeCompare(b.isoDate))
    .map(item => item.isoDate);

  return [...rankDates([...hotDates.values()]), ...rankDates([...staleDates.values()])]
    .slice(0, MAX_DATES_PER_RUN);
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

async function fetchExistingFirestoreResultsMap(){
  const accessToken = await getFirestoreAccessToken();
  const mapped = new Map();
  let nextPageToken = '';

  while(true){
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/results`);
    url.searchParams.set('pageSize', '500');
    if(nextPageToken){
      url.searchParams.set('pageToken', nextPageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if(!response.ok){
      const body = await response.text();
      throw new Error(`Firestore LIST falhou para results: ${response.status} ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    for(const doc of payload?.documents || []){
      const fullName = String(doc?.name || '');
      const matchId = fullName.split('/').pop();
      if(!matchId) continue;
      mapped.set(matchId, {
        home: doc?.fields?.home?.stringValue ?? '',
        away: doc?.fields?.away?.stringValue ?? ''
      });
    }

    nextPageToken = String(payload?.nextPageToken || '');
    if(!nextPageToken) break;
  }

  return mapped;
}

async function writeFirestoreResult(matchId, home, away){
  const accessToken = await getFirestoreAccessToken();
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/results/${encodeURIComponent(matchId)}`);
  url.searchParams.append('updateMask.fieldPaths', 'home');
  url.searchParams.append('updateMask.fieldPaths', 'away');

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
  log(`Partidas rastreadas: ${trackedMatches.length}`);

  if(DRY_RUN){
    log('Dry-run ativo: parsing local validado sem chamadas externas.');
    return;
  }

  if(!API_FOOTBALL_KEY){
    fail('Secret/API_FOOTBALL_KEY ausente.');
  }

  if(!FIREBASE_ACCESS_TOKEN && !FIREBASE_REFRESH_TOKEN && !FIREBASE_SERVICE_ACCOUNT_JSON){
    fail('Defina FIREBASE_ACCESS_TOKEN, FIREBASE_REFRESH_TOKEN ou FIREBASE_SERVICE_ACCOUNT_JSON para acessar o Firestore.');
  }

  const existingResultsByMatchId = await fetchExistingFirestoreResultsMap();
  const datesToQuery = pickDatesToQuery(trackedMatches, existingResultsByMatchId);

  log(`Resultados já presentes no Firestore: ${existingResultsByMatchId.size}`);
  log(`Datas candidatas para consulta: ${datesToQuery.length ? datesToQuery.join(', ') : 'nenhuma'}`);

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

  const unmatchedFinishedMatches = collectUnmatchedFinishedMatches(trackedMatches, fixturesByDate);
  for(const match of unmatchedFinishedMatches){
    warn(
      `Partida sem correspondencia final na API: ${match.id} ${match.home} x ${match.away} ` +
      `(${match.isoDate}, kickoff ${formatKickoffForLog(match.kickoffAt)}). ` +
      `Verifique se surgiu uma nova variacao de nome da selecao.`
    );
  }

  if(!updates.length){
    log('Nenhum placar final novo encontrado para gravar no Firestore.');
    return;
  }

  let writes = 0;
  for(const update of updates){
    const existing = existingResultsByMatchId.get(update.id) || null;
    if(existing && existing.home === update.home && existing.away === update.away){
      log(`Sem mudanca em results/${update.id} (${update.home} x ${update.away}).`);
      continue;
    }

    await writeFirestoreResult(update.id, update.home, update.away);
    existingResultsByMatchId.set(update.id, { home: update.home, away: update.away });
    writes += 1;
    log(`Atualizado results/${update.id} -> ${update.home} x ${update.away} (${update.status}).`);
  }

  log(`Sincronizacao concluida com ${writes} escrita(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
