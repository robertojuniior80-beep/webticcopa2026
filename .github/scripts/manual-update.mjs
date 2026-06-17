// manual-update.mjs
// Script to manually set match results (scores) in Firestore.
// Usage: node .github/scripts/manual-update.mjs <matchId> <homeScore> <awayScore>
// Example: node .github/scripts/manual-update.mjs J1 3 0

import crypto from 'node:crypto';
import process from 'process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Helper to base64url‑encode a string
function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseServiceAccount() {
  const envRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envRaw) {
    try {
      const creds = JSON.parse(envRaw);
      if (creds.client_email && creds.private_key) return creds;
    } catch (_) {}
  }
  const defaultPath = path.join(process.cwd(), 'copa2026-c344c-firebase-adminsdk-fbsvc-db112531ef.json');
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || defaultPath;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Service account file not found at ${filePath}.\nMake sure you are running the script from the project root and the file exists.`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const creds = JSON.parse(content);
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Invalid service account JSON structure.');
  }
  return creds;
}

async function getAccessToken() {
  const creds = parseServiceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  };
  const unsigned = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(claimSet))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(creds.private_key);
  const jwt = `${unsigned}.${toBase64Url(signature)}`;
  const tokenRes = await fetch(claimSet.aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`OAuth token request failed ${tokenRes.status}: ${txt}`);
  }
  const payload = await tokenRes.json();
  if (!payload.access_token) throw new Error('No access_token in response');
  return payload.access_token;
}

async function patchResult(matchId, homeScore, awayScore) {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'copa2026-c344c';
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/results/${encodeURIComponent(matchId)}?updateMask.fieldPaths=home&updateMask.fieldPaths=away`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { home: { stringValue: String(homeScore) }, away: { stringValue: String(awayScore) } } }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to write ${matchId}: ${res.status} ${txt}`);
  }
  console.log(`✅ Updated ${matchId} → ${homeScore} x ${awayScore}`);
}

function loadActiveMatches() {
  const paths = [
    path.join(process.cwd(), 'public', 'index.html'),
    path.join(process.cwd(), 'index.html')
  ];
  let html = null;
  for (const p of paths) {
    if (fs.existsSync(p)) {
      html = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  if (!html) return [];

  const match = [...html.matchAll(/const ACTIVE_MATCHES = \[(.*?)\n\];/gs)].at(-1);
  if (!match) return [];
  try {
    const literal = `[${match[1]}]`;
    return vm.runInNewContext(literal, {});
  } catch (_) {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const matches = loadActiveMatches();

  if (args.length < 3) {
    console.log('\n⚽ MANUAL RESULT UPDATE TOOL');
    console.log('============================');
    console.log('Usage:');
    console.log('  node .github/scripts/manual-update.mjs <matchId> <homeScore> <awayScore>');
    console.log('\nExample:');
    console.log('  node .github/scripts/manual-update.mjs J1 3 0');

    if (matches.length > 0) {
      console.log('\nAvailable Matches (IDs):');
      for (const m of matches) {
        console.log(`  - ${m.id.padEnd(5)}: ${m.home.padEnd(25)} vs ${m.away.padEnd(25)} (${m.date})`);
      }
    }
    console.log('');
    process.exit(1);
  }

  const [matchId, homeStr, awayStr] = args;
  const homeScore = parseInt(homeStr, 10);
  const awayScore = parseInt(awayStr, 10);

  if (isNaN(homeScore) || isNaN(awayScore)) {
    console.error('❌ Error: Scores must be valid integers.');
    process.exit(1);
  }

  // Optional: check if matchId exists in active matches
  const matchExists = matches.find(m => m.id.toUpperCase() === matchId.toUpperCase());
  if (matches.length > 0 && !matchExists) {
    console.warn(`⚠️ Warning: Match ID "${matchId}" not found in ACTIVE_MATCHES. Continuing anyway...`);
  }

  const normalizedMatchId = matchExists ? matchExists.id : matchId;

  try {
    await patchResult(normalizedMatchId, homeScore, awayScore);
    console.log('All updates completed successfully.\n');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
}

main();
