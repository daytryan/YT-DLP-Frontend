# yt-dlp downloader (Chrome extension)

Adds a **Download** button next to Share on every YouTube watch page. Pick a
format and quality, hit Download, and the file lands on your Desktop (or a
folder you choose). Video and audio, with optional subtitles, chapters and
cover art.

It's a thin UI over [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg
running on your own machine — nothing is uploaded anywhere, and there's no
server or account.

## How it works

```
YouTube page  ──►  extension  ──►  Chrome native messaging  ──►  native_host.py  ──►  yt-dlp + ffmpeg
 (Download btn)     (background.js)                              (one process per download)
```

- The **extension** draws the panel and collects your choices (mode, format,
  quality, folder, checkboxes).
- **`background.js`** relays that to a local helper via Chrome's native
  messaging. Chrome starts the helper on demand and kills it when the download
  ends, so nothing runs in the background between downloads.
- **`native_host.py`** runs one `yt-dlp` download per process and streams
  progress (percent, speed, ETA) back to the panel. `ffmpeg` does the
  merging/conversion.
- If a video needs you to be signed in (age-restricted, members-only,
  private), the extension retries once with your browser's YouTube cookies.
  Those cookies are written to a temp file only for that download and deleted
  right after.

## Requirements

- **Windows** (the installer registers via the Windows registry)
- **Python 3.8+** on your PATH — <https://www.python.org/downloads/> (tick
  "Add python.exe to PATH" in the installer)
- **ffmpeg** on your PATH — `winget install Gyan.FFmpeg`, then open a new
  terminal. Needed for video merging and every audio format.
- Chrome, Edge, Brave or Chromium

`yt-dlp` and `mutagen` are installed for you by the setup script.

## Setup

1. **Run `install.bat`** (double-click it). It will:
   - `pip install -U yt-dlp mutagen`
   - write `host.bat` and `com.ytdlp.bridge.json` pointing at this folder
   - register the native host for every Chromium browser it finds
   - warn you if ffmpeg is missing

2. **Load the extension:**
   - Go to `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - **Remove any older copy of this extension first** — the extension ID is
     pinned in `manifest.json` and a stale copy will clash
   - **Load unpacked** → select the `extension/` folder inside this directory

3. Open any YouTube video. You should see a **Download** button next to Share.
   The toolbar popup (click the extension icon) works too, and is the
   fallback if YouTube's layout ever hides the in-page button.

Don't move this folder after installing — the registered paths point here. If
you move it, run `install.bat` again.

## Using it

- **Video / Audio** toggle at the top.
- **Format** — video: mp4, mkv, webm · audio: mp3, m4a, opus, wav, flac
- **Quality** — "Best available" down to 360p, or 320/192/128 kbps for audio
- **Subtitles** (video only) — embeds English captions, auto-generated if
  there are no author captions
- **Chapters** — chapter markers you can skip between in VLC/mpv, when the
  video has them
- **Cover art / Metadata** — embeds the thumbnail as cover art plus
  title/artist tags. On formats that can't hold an image (wav, webm) the box
  is labelled "Metadata" and writes tags only.
- **Save to** — click the field or **Browse** to pick a folder; the **×**
  resets to Desktop. Your choices are remembered.

Options that a container can't support are hidden or relabelled rather than
offered and then failing mid-download.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Native host not installed" | Run `install.bat`. Make sure you loaded the extension from *this* folder's `extension/`. |
| Downloads fail with an extractor / "format not available" error | YouTube changed something — run `install.bat` again to pull the newest yt-dlp. It says so in the error message. |
| First download fails, install looked fine | ffmpeg isn't on your PATH. `winget install Gyan.FFmpeg`, then reopen your terminal / restart Chrome. |
| Button missing on the page | Use the toolbar popup instead. YouTube layout changes can hide the in-page button; the popup is independent. |
| Age-restricted / private video won't download | You must be signed into YouTube *in this browser* — the extension borrows those cookies for the retry. |
| Nothing happens after moving the folder | Re-run `install.bat` from the new location. |

## What's in this folder

| File | Purpose |
| --- | --- |
| `install.bat` / `install.py` | One-time setup: installs yt-dlp, registers the native host |
| `native_host.py` | The download helper Chrome runs per job |
| `extension/` | The unpacked Chrome extension (load this at `chrome://extensions`) |
| `extension-id.txt` | The pinned extension ID, used to lock the native host to this extension |
| `test-wrapped.js` | Extension test harness (not needed for normal use) |

`host.bat` and `com.ytdlp.bridge.json` are generated by the installer.

## Uninstall

1. Remove the extension at `chrome://extensions`.
2. Delete the registry key `HKCU\Software\<browser>\NativeMessagingHosts\com.ytdlp.bridge`
   for each browser (e.g. `...\Google\Chrome\...`).
3. Delete this folder.
4. Optionally `pip uninstall yt-dlp mutagen`.
