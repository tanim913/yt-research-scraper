// Research rules applied locally to fetched videos: changing them costs no API quota.

// ISO 8601 duration (PT1H2M3S) -> seconds
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}

// videos.list item -> the flat record used by filters, UI and CSV
function flatten(item) {
  const s = item.snippet || {}, st = item.statistics || {}, cd = item.contentDetails || {};
  return {
    id: item.id,
    title: s.title || '',
    channel: s.channelTitle || '',
    channelId: s.channelId || '',
    publishedAt: s.publishedAt || '',
    description: s.description || '',
    tags: s.tags || [],
    categoryId: s.categoryId || '',
    language: s.defaultAudioLanguage || s.defaultLanguage || '',
    live: (s.liveBroadcastContent || 'none') !== 'none' || !!item.liveStreamingDetails,
    madeForKids: !!(item.status && item.status.madeForKids),
    views: +st.viewCount || 0,
    likes: +st.likeCount || 0,
    comments: +st.commentCount || 0,
    commentsOff: st.commentCount === undefined, // the API omits commentCount when comments are disabled
    duration: parseDuration(cd.duration),
  };
}

const num = (x) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
const list = (s) => String(s || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

function matches(v, r) {
  const text = `${v.title} ${v.description} ${v.tags.join(' ')}`.toLowerCase();
  const inc = list(r.include);
  if (inc.length && !(r.includeMode === 'all' ? inc.every((w) => text.includes(w)) : inc.some((w) => text.includes(w)))) return false;
  if (list(r.exclude).some((w) => text.includes(w))) return false;

  const day = v.publishedAt.slice(0, 10);
  if (r.after && day < r.after) return false;
  if (r.before && day > r.before) return false;

  const ranges = [['views', 'minViews', 'maxViews'], ['likes', 'minLikes', 'maxLikes'], ['comments', 'minComments', 'maxComments'], ['duration', 'minDuration', 'maxDuration']];
  for (const [f, lo, hi] of ranges) {
    if (num(r[lo]) !== null && v[f] < num(r[lo])) return false;
    if (num(r[hi]) !== null && v[f] > num(r[hi])) return false;
  }
  // comments per 1,000 views
  if (num(r.minEngagement) !== null && (v.views ? (v.comments * 1000) / v.views : 0) < num(r.minEngagement)) return false;

  if (r.excludeShorts && (v.duration <= 60 || /#shorts/i.test(v.title + ' ' + v.description))) return false;
  // videos with no language set are kept: most uploads do not set one
  if (r.language && v.language && !list(r.language).some((l) => v.language.toLowerCase().startsWith(l))) return false;
  if (r.categoryId && v.categoryId !== String(r.categoryId)) return false;
  if (r.skipCommentsOff !== false && v.commentsOff) return false;
  if (r.skipLive && v.live) return false;
  if (r.skipKids && v.madeForKids) return false;
  return true;
}

const applyFilters = (videos, rules = {}) => videos.filter((v) => matches(v, rules));

module.exports = { parseDuration, flatten, matches, applyFilters };
