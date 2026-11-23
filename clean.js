// Comment cleaning: label the script (language family), drop junk, keep a report of what was removed and why.
// All local. Only the optional translation step sends text to an AI service.
const fs = require('fs');
const path = require('path');
const jobs = require('./jobs');

const BOM = '﻿';

// Reads a whole CSV (quotes, doubled quotes, CRLF, BOM). shortcut: loads the file in memory, fine for a few hundred thousand comments; stream it if files grow past ~1 GB.
function parseCsv(txt) {
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) {
      if (ch === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { if (f.endsWith('\r')) f = f.slice(0, -1); row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const SCRIPTS = [
  ['bengali', /[ঀ-৿]/g], ['devanagari', /[ऀ-ॿ]/g], ['arabic', /[؀-ۿݐ-ݿ]/g],
  ['cyrillic', /[Ѐ-ӿ]/g], ['cjk', /[぀-ヿ㐀-鿿가-힯]/g], ['thai', /[฀-๿]/g],
  ['latin', /[A-Za-zÀ-ɏ]/g],
];
// The writing system most letters belong to. 'latin' also covers romanized Bangla and other languages typed in English letters; a script cannot tell those apart.
function scriptOf(text) {
  let best = 'none', n = 0;
  for (const [name, re] of SCRIPTS) { const c = (text.match(re) || []).length; if (c > n) { n = c; best = name; } }
  return { script: best, letters: n };
}

// Typical engagement bait and spam, in English and Bangla. The researcher adds their own words in the form.
const BAIT = /(\blike (if|for|this)\b|\b(please )?(sub|subscribe)\b|\bsub ?4 ?sub\b|\bfollow me\b|\bcheck (out )?my (channel|video)\b|\bfirst(!|\b.*\bcomment)|\bwho'?s watching\b|\bgive away\b|\bwhatsapp\b|লাইক\s*(চাপুন|দিন|করুন)|সাবস্ক্রাইব|ফলো\s*করুন|ফলো করে)/i;
const URL_RE = /(https?:\/\/|www\.)\S+/i;
const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

function classify(text, opts, seen) {
  const { script, letters } = scriptOf(text);
  let reason = '';
  if (opts.dropShort && letters < 3) reason = 'too short or no words';
  else if (opts.dropLinks && URL_RE.test(text) && letters - (text.match(URL_RE)[0].length) < 25) reason = 'link';
  else if (opts.dropBait && BAIT.test(text)) reason = 'engagement bait';
  else if (opts.dropWords.length && opts.dropWords.some((w) => norm(text).includes(w))) reason = 'your junk words';
  else if (opts.keepWords.length && !opts.keepWords.some((w) => norm(text).includes(w))) reason = 'not about the topic words';
  else if (opts.nonEnglish === 'drop' && script !== 'latin' && script !== 'none') reason = 'not English script';
  else if (opts.dropDuplicates) {
    const k = norm(text);
    if (seen.has(k)) reason = 'duplicate';
    else seen.add(k);
  }
  return { script, reason };
}

const list = (s) => String(s || '').split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 100);
const flag = (v, d) => (v === undefined ? d : !!v);

function run(id, o = {}) {
  const src = jobs.commentsFile(id);
  if (!fs.existsSync(src)) throw new Error('This job has no comments yet.');
  const opts = {
    dropShort: flag(o.dropShort, true), dropLinks: flag(o.dropLinks, true), dropBait: flag(o.dropBait, true), dropDuplicates: flag(o.dropDuplicates, true),
    dropWords: list(o.dropWords), keepWords: list(o.keepWords), nonEnglish: o.nonEnglish === 'drop' ? 'drop' : 'keep',
  };
  const rows = parseCsv(fs.readFileSync(src, 'utf8'));
  const head = rows.shift() || [];
  const ti = head.indexOf('text');
  if (ti < 0) throw new Error('This file has no text column.');
  const dir = path.dirname(src);
  const kept = [BOM + jobs.csvRow([...head, 'script'])], removed = [BOM + jobs.csvRow([...head, 'script', 'reason'])];
  const counts = {}, scripts = {}, seen = new Set();
  let nKept = 0;
  for (const r of rows) {
    if (r.length < head.length) continue; // half-written last line of a running job
    const { script, reason } = classify(r[ti], opts, seen);
    if (reason) { removed.push(jobs.csvRow([...r, script, reason])); counts[reason] = (counts[reason] || 0) + 1; }
    else { kept.push(jobs.csvRow([...r, script])); nKept++; scripts[script] = (scripts[script] || 0) + 1; }
  }
  fs.writeFileSync(path.join(dir, 'comments-clean.csv'), kept.join(''));
  fs.writeFileSync(path.join(dir, 'comments-removed.csv'), removed.join(''));
  const report = { total: rows.length, kept: nKept, removed: rows.length - nKept, byReason: counts, keptByScript: scripts, options: opts, at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'clean-report.json'), JSON.stringify(report));
  fs.rmSync(path.join(dir, 'translations.ndjson'), { force: true }); // rows changed, so earlier translations no longer line up with the file
  return report;
}

// ---------- optional AI translation of the kept non-English comments ----------
const TR = (id) => path.join(path.dirname(jobs.commentsFile(id)), 'translations.ndjson');
const readTr = (id) => {
  const m = new Map();
  try { for (const l of fs.readFileSync(TR(id), 'utf8').split('\n')) { try { const o = JSON.parse(l); m.set(o.id, o.t); } catch {} } } catch {}
  return m;
};

// The next batch of kept comments that still need an English version (not Latin script), 40 at a time.
function nextToTranslate(id, limit = 40) {
  const f = path.join(path.dirname(jobs.commentsFile(id)), 'comments-clean.csv');
  if (!fs.existsSync(f)) throw new Error('Clean the comments first.');
  const rows = parseCsv(fs.readFileSync(f, 'utf8')), head = rows.shift(), ti = head.indexOf('text'), ci = head.indexOf('comment_id'), si = head.indexOf('script');
  const done = readTr(id), todo = [];
  let remaining = 0;
  for (const r of rows) {
    if (r.length < head.length || r[si] === 'latin' || r[si] === 'none' || done.has(r[ci])) continue;
    remaining++;
    if (todo.length < limit) todo.push({ id: r[ci], text: r[ti] });
  }
  return { todo, remaining, done: done.size };
}
const saveTranslations = (id, map) => fs.appendFileSync(TR(id), Object.entries(map).map(([k, t]) => JSON.stringify({ id: k, t })).join('\n') + '\n');

// comments-clean.csv with a text_en column (the translation, or the original for English-script comments)
function cleanCsvWithEnglish(id) {
  const f = path.join(path.dirname(jobs.commentsFile(id)), 'comments-clean.csv');
  if (!fs.existsSync(f)) return null;
  const rows = parseCsv(fs.readFileSync(f, 'utf8')), head = rows.shift(), ti = head.indexOf('text'), ci = head.indexOf('comment_id'), si = head.indexOf('script');
  const tr = readTr(id);
  return BOM + jobs.csvRow([...head, 'text_en']) + rows.filter((r) => r.length >= head.length).map((r) => jobs.csvRow([...r, tr.get(r[ci]) || (r[si] === 'latin' ? r[ti] : '')])).join('');
}

module.exports = { run, parseCsv, scriptOf, nextToTranslate, saveTranslations, cleanCsvWithEnglish, report: (id) => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(jobs.commentsFile(id)), 'clean-report.json'), 'utf8')); } catch { return null; } } };
