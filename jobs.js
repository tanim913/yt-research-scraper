// Discover and scrape jobs. State is saved to disk after every API page, so a job survives
// a crash or a quota stop and resumes from where it was.
const fs = require('fs');
const path = require('path');
const yt = require('./yt');
const { flatten } = require('./filters');

const JOBS = path.join(yt.DATA, 'jobs');
const OUT = path.join(yt.DATA, 'out');
class Cancelled extends Error {}

const validId = (id) => /^[\w-]+$/.test(id);
const getJob = (id) => (validId(id) ? yt.load(`jobs/${id}.json`, null) : null);
const saveJob = (j) => yt.save(`jobs/${j.id}.json`, j);
function listJobs() {
  let files = [];
  try { files = fs.readdirSync(JOBS).filter((f) => /^[\w-]+\.json$/.test(f)); } catch {}
  return files.map((f) => yt.load('jobs/' + f, null)).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- CSV ----------
const esc = (x) => { const s = x == null ? '' : String(x); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvRow = (a) => a.map(esc).join(',') + '\r\n';
const BOM = '﻿'; // lets Excel open UTF-8 (Bengali, Russian, ...) correctly
const VIDEO_COLS = ['video_id', 'url', 'title', 'channel', 'published_at', 'views', 'likes', 'comments', 'duration_s', 'language', 'tags', 'search_regions', 'search_queries'];
const COMMENT_COLS = ['video_id', 'video_title', 'channel', 'comment_id', 'parent_id', 'is_reply', 'author', 'text', 'like_count', 'published_at', 'reply_count'];
const videosCsv = (vs) => BOM + csvRow(VIDEO_COLS) + vs.map((v) => csvRow([v.id, 'https://www.youtube.com/watch?v=' + v.id, v.title, v.channel, v.publishedAt, v.views, v.likes, v.comments, v.duration, v.language, v.tags.join('|'), (v.regions || []).join('|'), (v.queries || []).join('|')])).join('');
const commentsFile = (id) => path.join(OUT, id, 'comments.csv');

// Candidate videos of a discover job, deduplicated (a crash can re-append the last page).
function videosOf(id) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(JOBS, id + '.videos.ndjson'), 'utf8'); } catch {}
  const byId = new Map();
  for (const line of txt.split('\n')) {
    try {
      const v = JSON.parse(line), old = byId.get(v.id);
      if (old) { v.regions = [...new Set([...(old.regions || []), ...(v.regions || [])])]; v.queries = [...new Set([...(old.queries || []), ...(v.queries || [])])]; }
      byId.set(v.id, v);
    } catch {} // skips blank or half-written lines
  }
  return [...byId.values()];
}

// ---------- create / control ----------
const date = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : '');

function createJob(spec) {
  const base = { id: new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6), status: 'queued', createdAt: new Date().toISOString(), name: String(spec.name || '').slice(0, 100), error: null, log: [] };
  let job;
  if (spec.type === 'discover') {
    const mode = spec.mode === 'search' ? 'search' : 'channels';
    const channels = String(spec.channels || '').split(/[\s,]+/).filter(Boolean);
    const queries = [...new Set(String(spec.q || '').split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 10);
    const regions = [...new Set(String(spec.regionCode || '').split(/[\s,]+/).map((x) => x.slice(0, 2).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))].slice(0, 6);
    const q = queries.join(' | ');
    if (mode === 'channels' && !channels.length) throw new Error('Add at least one channel.');
    if (mode === 'search' && !queries.length) throw new Error('Enter a search query.');
    if (mode === 'search' && queries.length * Math.max(regions.length, 1) > 40) throw new Error('That is too many searches (keywords x countries). Keep it to 40 or fewer.');
    job = {
      ...base, type: 'discover',
      params: { mode, channels, q, after: date(spec.after), before: date(spec.before), order: ['date', 'viewCount', 'relevance'].includes(spec.order) ? spec.order : 'relevance', queries, regions, relevanceLanguage: String(spec.relevanceLanguage || '').slice(0, 5), maxPages: Math.min(Math.max(parseInt(spec.maxPages, 10) || 5, 1), 10) },
      cursor: { ci: 0, uploads: null, pageToken: null, page: 0, si: 0 },
      progress: { scanned: 0, candidates: 0 },
    };
  } else if (spec.type === 'scrape') {
    const videos = (Array.isArray(spec.videos) ? spec.videos : []).filter((v) => v && /^[\w-]{11}$/.test(v.id)).map((v) => ({ id: v.id, title: String(v.title || ''), channel: String(v.channel || '') }));
    if (!videos.length) throw new Error('Select at least one video.');
    job = {
      ...base, type: 'scrape',
      params: { videos, order: spec.order === 'time' ? 'time' : 'relevance', maxPerVideo: Math.max(0, parseInt(spec.maxPerVideo, 10) || 0), allReplies: !!spec.allReplies },
      cursor: { vi: 0, pageToken: null, count: 0, csvSize: 0 },
      progress: { video: 0, total: videos.length, comments: 0, skipped: [] },
    };
  } else throw new Error('Unknown job type.');
  saveJob(job);
  kick();
  return job;
}

const cancelled = new Set();
let running = null;

function cancelJob(id) {
  const j = getJob(id);
  if (!j) return;
  if (running === id) cancelled.add(id);
  else if (['queued', 'paused', 'error'].includes(j.status)) { j.status = 'cancelled'; saveJob(j); }
}
function resumeJob(id) {
  const j = getJob(id);
  if (j && ['paused', 'error', 'cancelled'].includes(j.status)) { j.status = 'queued'; j.error = null; saveJob(j); kick(); }
}

// Runs jobs one at a time, oldest first. Called on start, on new job/key, and every minute
// (which also resumes paused jobs after the midnight-PT quota reset).
let runP = null;
const kick = () => runP || (runP = loop()); // returns the active run, so tests can await it
async function loop() {
  try { await runJobs(); } finally { runP = null; }
}
async function runJobs() {
  for (;;) {
    const job = listJobs().reverse().find((j) => ['queued', 'running'].includes(j.status) || (j.status === 'paused' && yt.hasLiveKey()));
    if (!job) return;
    running = job.id;
    job.status = 'running'; job.error = null; saveJob(job);
    try {
      await (job.type === 'discover' ? discover : scrape)(job);
      job.status = 'done';
    } catch (e) {
      if (e instanceof yt.AllKeysExhausted) { job.status = 'paused'; job.error = e.message; }
      else if (e instanceof Cancelled) job.status = 'cancelled';
      else { job.status = 'error'; job.error = e.message; }
    }
    cancelled.delete(job.id);
    running = null;
    saveJob(job);
    if (job.status === 'paused') return; // no live key left: wait for the next kick
  }
}

const checkCancel = (job) => { if (cancelled.has(job.id)) throw new Cancelled(); };

// ---------- discover ----------
function channelQuery(s) {
  const id = /(UC[\w-]{22})/.exec(s);
  if (id) return { id: id[1] };
  const user = /\/user\/([\w.-]+)/.exec(s);
  if (user) return { forUsername: user[1] };
  const handle = /@([\w.-]+)/.exec(s);
  return { forHandle: '@' + (handle ? handle[1] : s.replace(/\/+$/, '').replace(/^.*\//, '')) };
}

async function discover(job) {
  const p = job.params, c = job.cursor;
  const file = path.join(JOBS, job.id + '.videos.ndjson');
  const addVideos = async (ids, tag = {}) => {
    if (!ids.length) return;
    const r = await yt.call('videos', { part: 'snippet,statistics,contentDetails,status,liveStreamingDetails', id: ids.join(','), maxResults: 50 });
    const items = r.items || [];
    if (items.length) fs.appendFileSync(file, items.map((i) => JSON.stringify({ ...flatten(i), regions: tag.region ? [tag.region] : [], queries: tag.query ? [tag.query] : [] })).join('\n') + '\n');
    job.progress.candidates += items.length;
  };

  if (p.mode === 'channels') {
    // Uploads playlist: 1 unit per 50 videos, vs 100 units per 50 with search.list.
    while (c.ci < p.channels.length) {
      checkCancel(job);
      const ch = p.channels[c.ci];
      if (!c.uploads) {
        const r = await yt.call('channels', { part: 'contentDetails', ...channelQuery(ch) });
        if (!r.items || !r.items.length) {
          job.log.push(`Channel not found: ${ch}`);
          c.ci++; saveJob(job); continue;
        }
        c.uploads = r.items[0].contentDetails.relatedPlaylists.uploads;
        saveJob(job);
      }
      let r;
      try {
        r = await yt.call('playlistItems', { part: 'contentDetails', playlistId: c.uploads, maxResults: 50, pageToken: c.pageToken });
      } catch (e) {
        if (!(e instanceof yt.SkipError)) throw e;
        job.log.push(`Could not list uploads of ${ch}: ${e.reason}`);
        r = { items: [] };
      }
      const items = r.items || [];
      const ids = [];
      let older = 0;
      for (const it of items) {
        const day = (it.contentDetails.videoPublishedAt || '').slice(0, 10);
        if (p.after && day && day < p.after) { older++; continue; }
        if (p.before && day > p.before) continue;
        ids.push(it.contentDetails.videoId);
      }
      job.progress.scanned += items.length;
      await addVideos(ids);
      // uploads come newest first, so a page that is entirely too old ends this channel
      c.pageToken = r.nextPageToken || null;
      if (!c.pageToken || (items.length && older === items.length)) { c.ci++; c.uploads = null; c.pageToken = null; }
      saveJob(job);
    }
  } else {
    // One search per keyword x country. Each costs 100 units a page, so the form shows the total before it starts.
    const regions = p.regions && p.regions.length ? p.regions : [''];
    const queries = p.queries && p.queries.length ? p.queries : [p.q];
    const plan = regions.flatMap((region) => queries.map((query) => ({ region, query })));
    while ((c.si || 0) < plan.length) {
      const { region, query } = plan[c.si || 0];
      while (c.page < p.maxPages) {
        checkCancel(job);
        const r = await yt.call('search', {
          part: 'id', type: 'video', q: query, maxResults: 50, order: p.order, pageToken: c.pageToken,
          publishedAfter: p.after && p.after + 'T00:00:00Z', publishedBefore: p.before && p.before + 'T23:59:59Z',
          regionCode: region || undefined, relevanceLanguage: p.relevanceLanguage,
        }, 100);
        const ids = (r.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
        job.progress.scanned += ids.length;
        await addVideos(ids, { region, query });
        c.page++;
        c.pageToken = r.nextPageToken || null;
        saveJob(job);
        if (!c.pageToken) break;
      }
      c.si = (c.si || 0) + 1; c.page = 0; c.pageToken = null;
      saveJob(job);
    }
  }
  job.progress.candidates = videosOf(job.id).length;
}

// ---------- scrape ----------
const commentRow = (v, cm, parentId, replyCount) => {
  const s = cm.snippet || {};
  return [v.id, v.title, v.channel, cm.id, parentId, parentId ? 1 : 0, s.authorDisplayName, s.textDisplay || s.textOriginal, s.likeCount, s.publishedAt, replyCount];
};

async function fetchReplies(parentId) {
  const out = [];
  let pageToken = null;
  do {
    const r = await yt.call('comments', { part: 'snippet', parentId, maxResults: 100, textFormat: 'plainText', pageToken });
    out.push(...(r.items || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

async function scrape(job) {
  const p = job.params, c = job.cursor, file = commentsFile(job.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!c.csvSize) {
    fs.writeFileSync(file, BOM + csvRow(COMMENT_COLS));
    c.csvSize = fs.statSync(file).size;
    saveJob(job);
  } else {
    fs.truncateSync(file, c.csvSize); // drop rows written after the last saved cursor: no duplicates on resume
  }

  while (c.vi < p.videos.length) {
    checkCancel(job);
    const v = p.videos[c.vi];
    job.progress.video = c.vi + 1;
    let rows = [], next = null;
    try {
      const r = await yt.call('commentThreads', { part: 'snippet,replies', videoId: v.id, maxResults: 100, order: p.order, textFormat: 'plainText', pageToken: c.pageToken });
      for (const t of r.items || []) {
        const top = t.snippet.topLevelComment, n = t.snippet.totalReplyCount || 0;
        rows.push(commentRow(v, top, '', n));
        let replies = (t.replies && t.replies.comments) || [];
        if (p.allReplies && n > replies.length) {
          replies = await fetchReplies(top.id).catch((e) => { if (e instanceof yt.SkipError) return replies; throw e; });
        }
        for (const rc of replies) rows.push(commentRow(v, rc, top.id, ''));
      }
      next = r.nextPageToken || null;
    } catch (e) {
      if (!(e instanceof yt.SkipError)) throw e;
      job.progress.skipped.push(`${v.id}: ${e.reason}`);
    }
    if (p.maxPerVideo) rows = rows.slice(0, p.maxPerVideo - c.count);
    if (rows.length) fs.appendFileSync(file, rows.map(csvRow).join(''));
    c.count += rows.length;
    job.progress.comments += rows.length;
    c.csvSize = fs.statSync(file).size;
    c.pageToken = next;
    if (!next || (p.maxPerVideo && c.count >= p.maxPerVideo)) { c.vi++; c.pageToken = null; c.count = 0; }
    saveJob(job);
  }
}

module.exports = { createJob, getJob, listJobs, cancelJob, resumeJob, kick, videosOf, videosCsv, commentsFile, channelQuery, csvRow };
