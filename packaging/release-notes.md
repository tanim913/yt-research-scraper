## Install

| System | Download | How |
|---|---|---|
| **Windows** | `yt-research-scraper-setup-windows-x64.exe` | Run it and follow the steps. Start it from the Start menu. (A `…-portable.exe` needs no install.) |
| **Mac, M1 or newer** | `yt-research-scraper-macos-apple-silicon.dmg` | Open the file and drag the app into Applications. |
| **Mac, Intel** | `yt-research-scraper-macos-intel.dmg` | Same as above. |
| **Ubuntu / Debian** | `yt-research-scraper-linux-amd64.deb` | `sudo apt install ./yt-research-scraper-linux-amd64.deb`, then start it from the applications menu or run `yt-research-scraper`. |
| **Other Linux** | `yt-research-scraper-linux-x64` | `chmod +x yt-research-scraper-linux-x64`, then run it. |

The app opens in your web browser. Keep its window open while you work; closing it stops the app. Your keys and data are saved in `.yt-research-scraper` in your home folder.

The apps are **not code-signed**, so the first launch shows a warning:
- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **Mac:** right-click the app → **Open** → **Open**. On macOS 15 or newer, if that is not offered, open **System Settings → Privacy & Security**, scroll down and press **Open Anyway**.

## Set up the AI helper (optional, free)

The AI helper suggests keywords, crosses out off-topic videos and translates comments. It needs a free key from **one** of these services:

**Google Gemini (recommended)**
1. Open <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Press **Create API key** and copy the key.
3. In the app, open step 3 **Research rules → AI helper → Set up a free AI key**.
4. Choose **Google Gemini**, paste the key, press **Save AI key**.

**OpenRouter**
1. Open <https://openrouter.ai/keys>, sign in, press **Create key** and copy it.
2. In the same box choose **OpenRouter**, paste the key, and keep a model whose name ends in `:free`. Free models may be renamed; see <https://openrouter.ai/models?max_price=0> for the current ones.
3. Press **Save AI key**.

Only your topic text, video titles and (if you press Translate) the comments you choose are sent to the service you pick. Never your YouTube keys. Free plans have small limits and may use submitted text to improve their products, so read the service's terms before sending comments.

## What's new

- Search several keywords and countries in one pool; keep the top N videos per year, country or channel, with a report of groups that fell short.
- Clean comments: remove spam, bait, duplicates and your own junk words, label each comment's script, and translate non-English comments with the AI helper.
- Optional AI helper for keyword suggestions and off-topic checks.
