// node --test   (uses a temp data dir and a fake YouTube API; no network, no quota)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.YT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-test-'));
const yt = require('./yt');
const jobs = require('./jobs');
const { parseDuration, flatten, matches } = require('./filters');

const K1 = 'TEST-KEY-ONE-0000000000000000000000000';
const K2 = 'TEST-KEY-TWO-0000000000000000000000000';
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
const quotaErr = reply(403, { error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } });
const reset = () => { for (const f of ['keys.json', 'quota.json']) fs.rmSync(path.join(yt.DATA, f), { force: true }); };

test('parseDuration', () => {
  assert.strictEqual(parseDuration('PT1H2M3S'), 3723);
  assert.strictEqual(parseDuration('PT45S'), 45);
  assert.strictEqual(parseDuration('P1DT1S'), 86401);
  assert.strictEqual(parseDuration(''), 0);
});

test('research rules', () => {
  const v = flatten({ id: 'aaaaaaaaaaa', snippet: { title: 'Ukraine war update', description: 'Kyiv', tags: ['Russia'], publishedAt: '2023-05-01T10:00:00Z', defaultAudioLanguage: 'en-US', categoryId: '25' }, statistics: { viewCount: '10000', likeCount: '300', commentCount: '50' }, contentDetails: { duration: 'PT5M' } });
  assert.ok(matches(v, {}));
  assert.ok(matches(v, { include: 'ukraine, gaza' }));
  assert.ok(!matches(v, { include: 'ukraine, gaza', includeMode: 'all' }));
  assert.ok(matches(v, { include: 'russia, kyiv', includeMode: 'all' }), 'tags and description count');
  assert.ok(!matches(v, { exclude: 'update' }));
  assert.ok(!matches(v, { after: '2023-06-01' }));
  assert.ok(matches(v, { after: '2023-05-01', before: '2023-05-01' }));
  assert.ok(!matches(v, { minViews: 20000 }));
  assert.ok(!matches(v, { maxComments: 10 }));
  assert.ok(matches(v, { minEngagement: 5 }) && !matches(v, { minEngagement: 6 }), '50 comments / 10k views = 5 per 1000');
  assert.ok(matches(v, { language: 'en' }) && !matches(v, { language: 'bn' }));
  assert.ok(!matches(v, { categoryId: '10' }));
  assert.ok(matches(v, { excludeShorts: true, minDuration: '', maxDuration: '' }));
  assert.ok(!matches({ ...v, duration: 40 }, { excludeShorts: true }));
  assert.ok(!matches({ ...v, commentsOff: true }, {}), 'comments-off skipped by default');
  assert.ok(matches({ ...v, commentsOff: true }, { skipCommentsOff: false }));
});

test('channel input parsing', () => {
  assert.deepStrictEqual(jobs.channelQuery('@BBCNews'), { forHandle: '@BBCNews' });
  assert.deepStrictEqual(jobs.channelQuery('https://www.youtube.com/@aljazeeraenglish/videos'), { forHandle: '@aljazeeraenglish' });
  assert.deepStrictEqual(jobs.channelQuery('https://youtube.com/channel/UC16niRr50-MSBwiO3YDb3RA'), { id: 'UC16niRr50-MSBwiO3YDb3RA' });
  assert.deepStrictEqual(jobs.channelQuery('https://youtube.com/user/CNN'), { forUsername: 'CNN' });
});

test('csv escaping', () => {
  assert.strictEqual(jobs.csvRow(['a', 'b,c', 'say "hi"', 'x\ny', null]), 'a,"b,c","say ""hi""","x\ny",\r\n');
});

test('rotates to the next key on quotaExceeded, then pauses when all are dead', async () => {
  reset();
  yt.addKey(K1, 'one'); yt.addKey(K2, 'two');
  const used = [];
  yt.setFetch(async (url) => { const k = new URL(url).searchParams.get('key'); used.push(k); return k === K1 ? quotaErr : reply(200, { items: [1] }); });
  const r = await yt.call('videos', { id: 'x' });
  assert.deepStrictEqual(r.items, [1]);
  assert.deepStrictEqual(used, [K1, K2]);
  const s = yt.status();
  assert.strictEqual(s.keys.find((k) => k.label === 'one').dead, 'quotaExceeded');
  assert.strictEqual(s.keys.find((k) => k.label === 'two').used, 1);

  yt.setFetch(async () => quotaErr);
  await assert.rejects(yt.call('videos', { id: 'x' }), yt.AllKeysExhausted);
  assert.ok(!yt.hasLiveKey());
});

test('per-video errors are skips, not key failures', async () => {
  reset(); yt.addKey(K1);
  yt.setFetch(async () => reply(403, { error: { errors: [{ reason: 'commentsDisabled' }] } }));
  await assert.rejects(yt.call('commentThreads', { videoId: 'x' }), yt.SkipError);
  assert.ok(yt.hasLiveKey());
});

// Fake comment API: video AAAAAAAAAAA has 2 pages of 2 threads; BBBBBBBBBBB has comments disabled.
function fakeComments({ failOnPage2 = false } = {}) {
  return async (url) => {
    const u = new URL(url), p = u.searchParams;
    if (u.pathname.endsWith('/commentThreads')) {
      if (p.get('videoId') === 'BBBBBBBBBBB') return reply(403, { error: { errors: [{ reason: 'commentsDisabled' }] } });
      const page = p.get('pageToken') === 'P2' ? 2 : 1;
      if (page === 2 && failOnPage2) return quotaErr;
      const t = (n, replies) => ({ snippet: { totalReplyCount: replies, topLevelComment: { id: `c${page}${n}`, snippet: { textDisplay: `text ${page}${n}`, authorDisplayName: 'u', likeCount: 1, publishedAt: '2024-01-01' } } },
        replies: replies ? { comments: [{ id: `c${page}${n}.r1`, snippet: { textDisplay: 'reply, "quoted"', authorDisplayName: 'r' } }] } : undefined });
      return reply(200, { items: [t(1, 1), t(2, 0)], nextPageToken: page === 1 ? 'P2' : undefined });
    }
    throw new Error('unexpected ' + url);
  };
}
const readIds = (id) => fs.readFileSync(jobs.commentsFile(id), 'utf8').split('\r\n').slice(1).filter(Boolean).map((l) => l.split(',')[3]);

test('scrape job: pauses on quota, resumes after a key is added, no duplicates', async () => {
  reset(); yt.addKey(K1);
  yt.setFetch(fakeComments({ failOnPage2: true }));
  const job = jobs.createJob({ type: 'scrape', videos: [{ id: 'AAAAAAAAAAA', title: 'A' }, { id: 'BBBBBBBBBBB', title: 'B' }] });
  await jobs.kick();
  let j = jobs.getJob(job.id);
  assert.strictEqual(j.status, 'paused');
  assert.deepStrictEqual(readIds(job.id), ['c11', 'c11.r1', 'c12']);

  // simulate a crash after rows were appended but before the cursor was saved
  fs.appendFileSync(jobs.commentsFile(job.id), 'GARBAGE,row,from,c99\r\n');

  yt.setFetch(fakeComments());
  yt.addKey(K2);
  await jobs.kick();
  j = jobs.getJob(job.id);
  assert.strictEqual(j.status, 'done');
  assert.deepStrictEqual(readIds(job.id), ['c11', 'c11.r1', 'c12', 'c21', 'c21.r1', 'c22']);
  assert.deepStrictEqual(j.progress.skipped, ['BBBBBBBBBBB: commentsDisabled']);
  assert.ok(fs.readFileSync(jobs.commentsFile(job.id), 'utf8').startsWith('﻿video_id,'));
});

test('scrape job: max comments per video', async () => {
  reset(); yt.addKey(K1);
  yt.setFetch(fakeComments());
  const job = jobs.createJob({ type: 'scrape', videos: [{ id: 'AAAAAAAAAAA' }], maxPerVideo: 2 });
  await jobs.kick();
  assert.deepStrictEqual(readIds(job.id), ['c11', 'c11.r1']);
});

test('discover job (channels): stops at the start date, fetches stats, re-filters for free', async () => {
  reset(); yt.addKey(K1);
  const calls = [];
  const item = (id, date) => ({ contentDetails: { videoId: id, videoPublishedAt: date + 'T00:00:00Z' } });
  yt.setFetch(async (url) => {
    const u = new URL(url), p = u.searchParams, ep = u.pathname.split('/').pop();
    calls.push(ep);
    if (ep === 'channels') return reply(200, p.get('forHandle') === '@missing' ? { items: [] } : { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUx' } } }] });
    if (ep === 'playlistItems') {
      return p.get('pageToken') === 'N2'
        ? reply(200, { items: [item('v4_________', '2021-12-01'), item('v5_________', '2021-11-01')], nextPageToken: 'N3' })
        : reply(200, { items: [item('v1_________', '2024-09-01'), item('v2_________', '2024-01-01'), item('v3_________', '2022-02-01')], nextPageToken: 'N2' });
    }
    if (ep === 'videos') return reply(200, { items: p.get('id').split(',').map((id) => ({ id, snippet: { title: id === 'v2_________' ? 'Ukraine' : 'Other', publishedAt: '2023-01-01T00:00:00Z' }, statistics: { viewCount: '5', commentCount: '1' }, contentDetails: { duration: 'PT2M' } })) });
    throw new Error('unexpected ' + url);
  });
  const job = jobs.createJob({ type: 'discover', mode: 'channels', channels: '@BBCNews @missing', after: '2022-01-01', before: '2024-08-31' });
  await jobs.kick();
  const j = jobs.getJob(job.id);
  assert.strictEqual(j.status, 'done');
  assert.deepStrictEqual(jobs.videosOf(job.id).map((v) => v.id), ['v2_________', 'v3_________']);
  assert.deepStrictEqual(j.log, ['Channel not found: @missing']);
  assert.ok(!calls.includes('search'), 'channel mode never uses the 100-unit search');
  assert.strictEqual(calls.filter((c) => c === 'playlistItems').length, 2, 'stopped once a page was entirely older than the start date');
});

test('ai helper: suggests keywords and flags off-topic titles; the key is never returned', async () => {
  const ai = require('./ai');
  const sent = [];
  const gemini = (text) => async (url, opts) => { sent.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }; };
  assert.equal(ai.status().configured, false);
  await assert.rejects(ai.suggest('war news'), /Set up an AI key/);
  const st = ai.configure({ provider: 'gemini', key: 'TEST-AI-KEY-1234567890' });
  assert.deepEqual(st, { provider: 'gemini', model: 'gemini-2.5-flash', configured: true, last4: '7890' });
  ai.setFetch(gemini('```json\n{"include":["Ukraine","ukraine","Kyiv"],"exclude":["gameplay"],"note":"ok"}\n```'));
  assert.deepEqual(await ai.suggest('war news'), { include: ['ukraine', 'kyiv'], exclude: ['gameplay'], search: [], note: 'ok' });
  ai.setFetch(gemini('{"off":[2,9,"x"]}'));
  const vids = [{ id: 'a', title: 'War update', channel: 'C' }, { id: 'b', title: 'Cat video', channel: 'D' }];
  assert.deepEqual((await ai.judge('war news', vids)).off, ['b']); // 9 and "x" are out of range, dropped
  assert.match(sent[0].opts.headers['x-goog-api-key'], /^TEST-AI-KEY/);
  assert.ok(!sent[0].url.includes('TEST-AI-KEY')); // key travels in a header, not the URL
  ai.setFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  await assert.rejects(ai.suggest('war news'), /free limit/);
});

test('discover job (search): every keyword x country is searched, and each video remembers where it was found', async () => {
  reset(); yt.addKey(K1);
  const searches = [];
  yt.setFetch(async (url) => {
    const u = new URL(url), p = u.searchParams, ep = u.pathname.split('/').pop();
    if (ep === 'search') {
      searches.push(p.get('q') + '@' + p.get('regionCode'));
      // 'shared_____' turns up in every search; the other id is unique to its search
      return reply(200, { items: [{ id: { videoId: 'shared_____' } }, { id: { videoId: 'only' + searches.length + '______' } }] });
    }
    if (ep === 'videos') return reply(200, { items: p.get('id').split(',').map((id) => ({ id, snippet: { title: id, publishedAt: '2024-01-01T00:00:00Z' }, statistics: { viewCount: '5', commentCount: '9' }, contentDetails: { duration: 'PT5M' } })) });
    throw new Error('unexpected ' + url);
  });
  assert.throws(() => jobs.createJob({ type: 'discover', mode: 'search', q: Array.from({ length: 10 }, (_, i) => 'k' + i).join('\n'), regionCode: 'BD IN US CN GB FR' }), /too many searches/);
  const job = jobs.createJob({ type: 'discover', mode: 'search', q: 'ram price\nram shortage\nram price', regionCode: 'bd, in', maxPages: 1 });
  await jobs.kick();
  assert.strictEqual(jobs.getJob(job.id).status, 'done');
  assert.deepStrictEqual(searches, ['ram price@BD', 'ram shortage@BD', 'ram price@IN', 'ram shortage@IN']); // duplicate keyword ignored
  const vs = jobs.videosOf(job.id), shared = vs.find((v) => v.id === 'shared_____');
  assert.strictEqual(vs.length, 5);
  assert.deepStrictEqual(shared.regions.sort(), ['BD', 'IN']);
  assert.deepStrictEqual(shared.queries.sort(), ['ram price', 'ram shortage']);
  assert.match(jobs.videosCsv(vs), /BD\|IN,ram price\|ram shortage/);
});

test('comment cleaning: labels scripts, drops junk with a reason, keeps a report, merges translations', async () => {
  const clean = require('./clean'), ai = require('./ai');
  const id = 'clean-test';
  fs.mkdirSync(path.dirname(jobs.commentsFile(id)), { recursive: true });
  const H = ['video_id', 'video_title', 'channel', 'comment_id', 'parent_id', 'is_reply', 'author', 'text', 'like_count', 'published_at', 'reply_count'];
  const row = (cid, text) => jobs.csvRow(['v1', 'RAM prices, "up"', 'C', cid, '', 0, '@a', text, 1, '2024-01-01T00:00:00Z', 0]);
  const texts = ['RAM prices are crazy right now', 'ram prices are  crazy right now', '😂😂', 'like if you love namaz', 'নামাজ ভালোবাসলে লাইক চাপুন', 'bnp or awami league?', 'দাম অনেক বেশি\nআগের চেয়ে', 'https://spam.example/x', 'ok'];
  fs.writeFileSync(jobs.commentsFile(id), '﻿' + jobs.csvRow(H) + texts.map((t, i) => row('c' + i, t)).join(''));
  const rep = clean.run(id, { dropWords: 'bnp, awami' });
  assert.deepStrictEqual(rep.byReason, { duplicate: 1, 'too short or no words': 2, 'engagement bait': 2, 'your junk words': 1, link: 1 });
  assert.strictEqual(rep.kept, 2);
  assert.deepStrictEqual(rep.keptByScript, { latin: 1, bengali: 1 });
  assert.match(fs.readFileSync(path.join(path.dirname(jobs.commentsFile(id)), 'comments-removed.csv'), 'utf8'), /duplicate/);
  // translation: only non-Latin kept comments are sent, and the answer is merged into text_en
  assert.deepStrictEqual(clean.nextToTranslate(id).todo.map((t) => t.id), ['c6']);
  ai.configure({ provider: 'gemini', key: 'TEST-AI-KEY-1234567890' });
  ai.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"t":["The price is much higher than before"]}' }] } }] }) }));
  clean.saveTranslations(id, await ai.translate(clean.nextToTranslate(id).todo));
  assert.strictEqual(clean.nextToTranslate(id).remaining, 0);
  const out = clean.parseCsv(clean.cleanCsvWithEnglish(id));
  assert.deepStrictEqual(out.map((r) => r[r.length - 1]), ['text_en', 'RAM prices are crazy right now', 'The price is much higher than before']);
});
