// YouTube Data API v3 client with a pool of API keys and per-key daily quota tracking.
const fs = require('fs');
const path = require('path');

const DATA = process.env.YT_DATA || path.join(__dirname, 'data');
const BASE = 'https://www.googleapis.com/youtube/v3/';
const DAILY = 10000;
const DEAD_REASONS = ['quotaExceeded', 'dailyLimitExceeded', 'keyInvalid', 'accessNotConfigured', 'ipRefererBlocked'];
const SKIP_REASONS = ['commentsDisabled', 'videoNotFound', 'playlistNotFound', 'channelNotFound', 'processingFailure', 'forbidden'];

class AllKeysExhausted extends Error { constructor() { super('All API keys are out of quota (or invalid). Add a key or wait for the reset at midnight Pacific time.'); } }
class SkipError extends Error { constructor(reason) { super(reason); this.reason = reason; } }

let fetchImpl = (...a) => fetch(...a);
const setFetch = (f) => { fetchImpl = f; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load(file, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch { return def; }
}
function save(file, value) {
  fs.mkdirSync(path.dirname(path.join(DATA, file)), { recursive: true });
  const p = path.join(DATA, file);
  fs.writeFileSync(p + '.tmp', JSON.stringify(value));
  fs.renameSync(p + '.tmp', p); // atomic, so a crash never leaves half a file
}

// YouTube quota resets at midnight Pacific time.
const ptDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

function quota() {
  const q = load('quota.json', {});
  return q.day === ptDay() ? q : { day: ptDay(), used: {}, dead: {} };
}

const getKeys = () => load('keys.json', []);
function addKey(key, label) {
  key = String(key || '').trim();
  if (!/^[\w-]{20,60}$/.test(key)) throw new Error('That does not look like an API key.');
  const keys = getKeys().filter((k) => k.key !== key);
  keys.push({ key, label: String(label || '').slice(0, 60) });
  save('keys.json', keys);
  const q = quota(); delete q.dead[key]; save('quota.json', q); // re-adding a key retries it
}
function removeKey(id) {
  save('keys.json', getKeys().filter((k) => k.key.slice(-6) !== id));
}

// Status for the UI: keys are masked, identified by their last 6 characters.
function status() {
  const q = quota();
  return {
    day: q.day,
    keys: getKeys().map((k) => ({
      id: k.key.slice(-6), label: k.label, used: q.used[k.key] || 0,
      left: Math.max(0, DAILY - (q.used[k.key] || 0)), dead: q.dead[k.key] || null,
    })),
  };
}
const hasLiveKey = () => { const q = quota(); return getKeys().some((k) => !q.dead[k.key]); };

async function call(endpoint, params, cost = 1) {
  for (;;) {
    const q = quota();
    const live = getKeys().map((k) => k.key).filter((k) => !q.dead[k]);
    if (!live.length) throw new AllKeysExhausted();
    const key = live.sort((a, b) => (q.used[a] || 0) - (q.used[b] || 0))[0]; // spread load evenly
    const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
    const url = BASE + endpoint + '?' + new URLSearchParams([...clean, ['key', key]]);

    let res, body;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchImpl(url);
        body = await res.json().catch(() => ({}));
      } catch (e) {
        if (attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
        throw e;
      }
      const reason = body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason;
      if ((res.status >= 500 || reason === 'rateLimitExceeded') && attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
      break;
    }

    const q2 = quota(); // re-read: another call may have written meanwhile
    q2.used[key] = (q2.used[key] || 0) + cost;
    if (res.ok) { save('quota.json', q2); return body; }

    const err = body.error || {};
    const reason = (err.errors && err.errors[0] && err.errors[0].reason) || '';
    const badKey = reason === 'badRequest' && /api key/i.test(err.message || '');
    if (DEAD_REASONS.includes(reason) || badKey) {
      q2.dead[key] = badKey ? 'keyInvalid' : reason;
      save('quota.json', q2);
      continue; // rotate to next key
    }
    save('quota.json', q2);
    if (SKIP_REASONS.includes(reason) || res.status === 404) throw new SkipError(reason || 'notFound');
    throw new Error(`${endpoint}: ${res.status} ${reason} ${err.message || ''}`.trim());
  }
}

module.exports = { call, addKey, removeKey, getKeys, status, hasLiveKey, setFetch, load, save, ptDay, AllKeysExhausted, SkipError, DATA };
