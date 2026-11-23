# YouTube Research Scraper

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-20%2B-black.svg)
![Dependencies: none](https://img.shields.io/badge/dependencies-none-black.svg)

Build YouTube comment datasets for research without hand-picking videos.

You describe the videos you want with rules: channels, date range, keywords, views, comment counts, language, no Shorts and so on. The tool finds the matching videos, lets you review them on a contact sheet, and scrapes all their comments to CSV. It shares the work across several API keys, so the daily quota is not a wall, and when every key runs out it pauses and resumes on its own.

It was built for the kind of dataset used in studies of public opinion on news videos, for example comments on Russia–Ukraine war coverage from BBC, CNN and Al Jazeera.

## Why

Existing comment scrapers start from videos you already have. The slow part of research is **finding the right videos** under clear, reportable rules. Doing that with YouTube's search API costs 100 quota units per call, so one key runs out after about 100 searches. This tool:

- **Finds videos cheaply.** It lists each channel's uploads at about 1 unit per 25 videos instead of searching.
- **Applies your rules locally.** Changing a rule costs no quota.
- **Pools API keys** from several Google Cloud projects and moves to the next key when one runs out.
- **Pauses instead of failing.** Progress is saved after every page, so a job survives quota limits, crashes and restarts.

## Features

- **Two ways to find videos:** from a list of channels (cheap), or by searching all of YouTube (costly; the cost is shown before you start).
- **Research rules:**
  - keywords to include (any or all) and to exclude, checked against title, description and tags
  - minimum and maximum views, likes, comments and length
  - comments per 1,000 views
  - language and category
  - skip Shorts, live streams, made-for-kids videos and videos with comments turned off
- **Saved rule sets,** so the same selection can be repeated and reported in a methods section.
- **Contact-sheet review:** every match is a thumbnail circled in red; click one to cross it out.
- **Cost before you spend:** the selection strip shows the estimated quota cost against what's left today.
- **CSV output:** `videos.csv` and `comments.csv` (UTF-8 with BOM, so Excel shows Bangla, Russian and other scripts correctly). Replies are linked to their parent comment.
- **Built-in user guide** at `/guide`, written for non-developers.
- **Runs locally,** with zero npm dependencies. Your keys and data stay on your machine.

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- A free **YouTube Data API v3** key from Google Cloud (this is not an AI model key)

## Quick start

```bash
git clone https://github.com/tanim913/yt-research-scraper.git
cd yt-research-scraper
node server.js
```

Open <http://127.0.0.1:3000>. The user guide is at <http://127.0.0.1:3000/guide>.

To use another port, run `PORT=4000 node server.js`.

## Getting an API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com/projectcreate) and create a project.
2. Open **APIs & Services → Library**, find **YouTube Data API v3**, and press **Enable**.
3. Open **Credentials → Create credentials → API key**, and copy the key.
4. Paste it into step 1 of the app.

Each key gives 10,000 units a day. **Keys only add up when they come from different projects;** keys in the same project share one quota. The quota resets at midnight Pacific time, and the app shows that moment in your local time.

## How to use it

1. **API keys:** add one or more keys.
2. **Find videos:** list channels (`@BBCNews`, a channel URL, or a `UC…` ID), set the date range, and press **Find videos**. Frames appear as videos arrive.
3. **Research rules:** narrow the results. The sheet updates as you type, and it costs nothing.
4. **Review:** cross out anything you don't want. Export `videos.csv` if you need the list.
5. **Scrape:** choose the comment order, a cap per video, and whether to fetch all replies, then press **Scrape comments**. Download `comments.csv` from **Jobs**, even while the job is running.

## Quota costs

| Action | Approximate cost |
|---|---|
| Find videos from channels | 1 unit per 25 videos scanned |
| Search all of YouTube | 100 units per 50 results |
| Scrape comments | 1 unit per 80–100 comments |
| Change research rules | free |

For example, about 86,000 comments from three news channels over two and a half years is roughly 1,000–1,500 units, which fits in one key's daily quota.

## Output

**comments.csv:** `video_id, video_title, channel, comment_id, parent_id, is_reply, author, text, like_count, published_at, reply_count`

**videos.csv:** `video_id, url, title, channel, published_at, views, likes, comments, duration_s, language, tags`

```python
import pandas as pd
df = pd.read_csv("comments.csv")
top_level = df[df.is_reply == 0]
```

## Project structure

| File | Purpose |
|---|---|
| `server.js` | Local HTTP server and JSON API (bound to 127.0.0.1) |
| `yt.js` | YouTube API client: key pool, quota tracking, retries |
| `jobs.js` | Discover and scrape jobs that save after every page and resume |
| `filters.js` | Research rules, applied locally |
| `index.html` | The app (single page, no build step) |
| `guide.html` | The user guide |
| `test.js` | Tests against a fake API: no network, no quota |

Run the tests with:

```bash
node --test
```

## Privacy and security

- The server only listens on `127.0.0.1`, and it rejects requests that don't come from localhost.
- API keys, quota counters, jobs and CSVs are stored in `data/`, which is git-ignored. **Don't share that folder.**
- Only the official YouTube Data API v3 is used. There is no scraping of YouTube pages.

## Limits

- YouTube lists at most about the latest 20,000 uploads of a channel. For older videos on very large channels, use search mode with a date range.
- A search returns at most about 500 results.
- The language rule only removes videos whose uploader set a different language. Videos with no language set are kept.
- View and comment counts are recorded when the videos are found.
- Comment text is saved exactly as written. In Excel, a comment starting with `=`, `+`, `-` or `@` may be read as a formula; use pandas or Google Sheets import for analysis.

## License

[MIT](LICENSE)
