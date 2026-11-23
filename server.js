// Local web app: node server.js, then open http://127.0.0.1:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const yt = require('./yt');
const jobs = require('./jobs');
const { applyFilters } = require('./filters');

const PORT = +process.env.PORT || 3000;

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const download = (res, name, type) => res.writeHead(200, { 'content-type': type, 'content-disposition': `attachment; filename="${name}"` });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 20e6) { reject(new Error('Request too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Bad JSON.')); } });
  });
}

// The job list leaves out the big parts (video lists, cursors).
const summary = ({ params, cursor, log, ...j }) => ({ ...j, mode: params.mode, channels: params.channels, q: params.q, videoCount: params.videos && params.videos.length, log });

async function handle(req, res) {
  // Local only: reject other Host headers (DNS rebinding) and non-JSON POSTs (cross-site form posts).
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'Forbidden host.' });
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only.' });

  const url = new URL(req.url, 'http://localhost');
  const [api, kind, id, action] = url.pathname.split('/').filter(Boolean);
  const m = req.method;

  const page = { '/': 'index.html', '/guide': 'guide.html' }[url.pathname];
  if (m === 'GET' && page) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, page)).pipe(res);
  }
  if (api !== 'api') return send(res, 404, { error: 'Not found.' });

  if (kind === 'quota' && m === 'GET') return send(res, 200, yt.status());
  if (kind === 'keys' && !id && m === 'POST') {
    const b = await readBody(req);
    yt.addKey(b.key, b.label);
    jobs.kick(); // a new key resumes paused jobs right away
    return send(res, 200, yt.status());
  }
  if (kind === 'keys' && id && m === 'DELETE') { yt.removeKey(id); return send(res, 200, yt.status()); }

  if (kind === 'jobs' && !id) {
    if (m === 'GET') return send(res, 200, jobs.listJobs().map(summary));
    if (m === 'POST') return send(res, 200, summary(jobs.createJob(await readBody(req))));
  }
  if (kind === 'jobs' && id) {
    const job = jobs.getJob(id);
    if (!job) return send(res, 404, { error: 'No such job.' });
    if (!action && m === 'GET') return send(res, 200, summary(job));
    if (action === 'filter' && m === 'POST') {
      const all = jobs.videosOf(id);
      const videos = applyFilters(all, await readBody(req)).map(({ description, ...v }) => v);
      return send(res, 200, { total: all.length, videos });
    }
    if (action === 'videos.csv' && m === 'GET') {
      let rules = {};
      try { rules = JSON.parse(url.searchParams.get('rules') || '{}'); } catch {}
      download(res, `videos-${id}.csv`, 'text/csv; charset=utf-8');
      return res.end(jobs.videosCsv(applyFilters(jobs.videosOf(id), rules)));
    }
    if (action === 'comments.csv' && m === 'GET') {
      const file = jobs.commentsFile(id);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'No comments yet.' });
      download(res, `comments-${id}.csv`, 'text/csv; charset=utf-8');
      return fs.createReadStream(file).pipe(res);
    }
    if (action === 'cancel' && m === 'POST') { jobs.cancelJob(id); return send(res, 200, { ok: true }); }
    if (action === 'resume' && m === 'POST') { jobs.resumeJob(id); return send(res, 200, { ok: true }); }
  }
  send(res, 404, { error: 'Not found.' });
}

http.createServer((req, res) => handle(req, res).catch((e) => send(res, 400, { error: e.message })))
  .listen(PORT, '127.0.0.1', () => {
    console.log(`YouTube research scraper: open http://127.0.0.1:${PORT}`);
    jobs.kick(); // resume jobs left running or paused
    setInterval(jobs.kick, 60 * 1000); // picks paused jobs back up after the quota reset
  });
