"""Chrome native-messaging host: one download per process, exits when the job ends.

Chrome starts this on demand (extension/background.js connects) and reaps it when the
port closes, so nothing has to be running in the background.  Register it: install.bat
"""
# Chrome spawns a whole process per connection, so every import here is paid on a folder pick too.
# subprocess (cancel only), tempfile (cookies only) and importlib.util (mutagen probe) are imported
# where they are used instead; json already pulls `re` in, so that one is free.
import json, os, re, struct, sys, threading, time

DESKTOP = os.path.join(os.path.expanduser("~"), "Desktop")

# The protocol owns real stdout — anything yt-dlp or a library prints would corrupt a frame.
PIPE = sys.stdout.buffer
sys.stdout = sys.stderr


SENT = [0.0]
LOCK = threading.Lock()


def send(**obj):
    data = json.dumps(obj).encode()
    with LOCK:  # two threads write here; a torn frame would desync the protocol
        SENT[0] = time.monotonic()
        PIPE.write(struct.pack("@I", len(data)) + data)
        PIPE.flush()


def recv(stream=None):
    stream = stream or sys.stdin.buffer
    head = stream.read(4)
    if len(head) < 4:
        return None
    return json.loads(stream.read(struct.unpack("@I", head)[0]))


# Containers ffmpeg will accept a cover image in. Ask for a thumbnail in any other one and
# yt-dlp raises instead of skipping, which would fail the whole download over an extra.
THUMBABLE = {"mp3", "m4a", "mp4", "mov", "mkv", "mka", "ogg", "opus", "flac"}
MUTAGEN_ONLY = {"ogg", "opus", "flac"}  # yt-dlp writes cover art into these through mutagen
# ffmpeg accepts the chapter metadata for these and then drops it on the floor (checked against
# ffmpeg 7.1.1). Unlike a cover image it fails nothing, so this is not about safety: asking buys
# a whole extra remux pass and delivers a file with no chapters in it.
NO_CHAPTERS = {"wav", "flac"}


def build_opts(mode, fmt, quality, subs=False, meta=False, chapters=False):
    # noplaylist: a /watch?v=..&list=.. URL must download the one video, not the playlist
    opts = {"noplaylist": True}
    pps = []  # order matters: yt-dlp runs same-phase postprocessors in the order given
    if mode == "audio":
        opts["format"] = "ba/b"
        pps.append({"key": "FFmpegExtractAudio", "preferredcodec": fmt,
                    "preferredquality": "0" if quality == "best" else quality})
    else:
        h = "" if quality == "best" else f"[height<={quality}]"
        # prefer streams already in the target container so the merge is a remux, not a re-encode
        pref = {"mp4": f"bv*{h}[ext=mp4]+ba[ext=m4a]/",
                "webm": f"bv*{h}[ext=webm]+ba[ext=webm]/"}.get(fmt, "")
        opts["format"] = f"{pref}bv*{h}+ba/b{h}"
        opts["merge_output_format"] = fmt
        if subs:  # audio has nothing to embed subtitles into, so this is video-only
            # automatic captions too: most videos have no author-written ones, and asking for
            # only those would silently produce no subtitles at all.
            # subtitleslangs entries are anchored regexes, so plain "en" is one exact track.
            # "en.*" also pulls every auto-translated en-xx track, which trips YouTube's 429.
            opts.update(writesubtitles=True, writeautomaticsub=True, subtitleslangs=["en"])
            pps.append({"key": "FFmpegEmbedSubtitle"})  # deletes the .vtt once it is embedded
    # One postprocessor writes both. add_chapters is a no-op on a video without chapters, so
    # asking for them costs nothing when there are none - but a container that cannot keep them
    # is worth dropping here, so chapters alone stops pulling in a pointless ffmpeg pass.
    chapters = chapters and fmt not in NO_CHAPTERS
    if meta or chapters:
        pps.append({"key": "FFmpegMetadata", "add_metadata": meta, "add_chapters": chapters})
    if meta and fmt in THUMBABLE:
        # mutagen raises if it is missing, so drop the cover art rather than fail the download on
        # an install that predates it (install.bat pulls it in). find_spec walks sys.path, so ask
        # only when cover art is actually on the table - at import it cost every spawn.
        import importlib.util
        if fmt not in MUTAGEN_ONLY or importlib.util.find_spec("mutagen"):
            opts["writethumbnail"] = True
            pps.append({"key": "EmbedThumbnail"})
    opts["postprocessors"] = pps
    return opts


LAST = [0.0]
STAGE = ["Working"]  # last named postprocessor, so the keepalive can repeat it
STOP = threading.Event()  # only check_opts sets this; a real job runs to os._exit
PARTS = set()  # part files of the running download, removed if cancelled
# ffmpeg steps worth naming; anything else (MoveFiles etc.) is too quick to be worth a flicker
STEPS = {"Merger": "Merging video + audio", "ExtractAudio": "Extracting audio",
         "VideoConvertor": "Converting video", "EmbedSubtitle": "Embedding subtitles",
         "Metadata": "Writing metadata", "EmbedThumbnail": "Embedding thumbnail",
         }  # yt-dlp strips the FFmpeg prefix from PP names

# yt-dlp's shapes for "YouTube changed and my extractor is stale" — the one failure a user can
# actually fix, and it reads like a random error unless we say so.
# ponytail: both patterns compile on every spawn and only the error path reads them, but that
# measured 115us of a 39ms start - move them behind a first-use cell if the list ever grows.
STALE = re.compile(r"unable to extract|nsig|signature extraction|"
                   r"requested format is not available|player response", re.I)

# yt-dlp fetches subtitles before the video and makes any failure there fatal, so a rate-limited
# caption track would otherwise cost the whole download.
SUB_FAIL = re.compile(r"video subtitles", re.I)


def label(info):
    """A merged format downloads two streams, so the bar restarts — say which one it is."""
    info = info or {}
    if info.get("vcodec", "none") != "none":
        return "Downloading video"
    if info.get("acodec", "none") != "none":
        return "Downloading audio"
    return "Downloading"


def hook(d):
    """yt-dlp calls this many times a second; send structured numbers, throttled."""
    if d["status"] == "downloading":
        now = time.monotonic()
        if now - LAST[0] < 0.25:
            return
        LAST[0] = now
        PARTS.update(f for f in (d.get("tmpfilename"), d.get("filename")) if f)
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        done = d.get("downloaded_bytes") or 0
        send(state="running", stage="downloading", label=label(d.get("info_dict")),
             done=done, total=total, pct=round(done / total * 100, 1) if total else None,
             speed=d.get("speed"), eta=d.get("eta"))
    elif d["status"] == "finished":
        LAST[0] = 0.0
        send(state="running", stage="downloading", label=label(d.get("info_dict")), pct=100)


def pp_hook(d):
    step = STEPS.get(d.get("postprocessor"))
    if step and d["status"] == "started":
        STAGE[0] = step
        send(state="running", stage="processing", label=step, pct=100)


def keepalive():
    """Long ffmpeg steps send nothing for minutes.

    Chrome evicts an idle MV3 service worker after ~30s, and that tears down this port —
    which reads here as EOF, i.e. a cancel, deleting parts of an all-but-finished download.
    A trickle of traffic keeps the worker awake; the panel ignores repeats.
    """
    while not STOP.wait(5):
        if time.monotonic() - SENT[0] >= 15:
            send(state="running", stage="processing", label=STAGE[0], pct=100)


def pick_folder():
    """Native folder dialog. tkinter is stdlib, so this costs no extra dependency."""
    import tkinter
    from tkinter import filedialog
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return filedialog.askdirectory(title="Download folder", initialdir=DESKTOP)
    finally:
        root.destroy()


def download(job, dest):
    import yt_dlp  # ~225ms, and only this path needs it

    opts = {**build_opts(job.get("mode", "video"), job.get("fmt", "mp4"), job.get("quality", "best"),
                         job.get("subs"), job.get("meta"), job.get("chapters")),
            "outtmpl": os.path.join(dest, "%(title)s.%(ext)s"), "progress_hooks": [hook],
            "postprocessor_hooks": [pp_hook], "noprogress": True, "quiet": True, "no_warnings": True}
    jar = None
    if job.get("cookies"):
        # The extension sends its live cookie jar: every on-disk browser DB here is either
        # locked by the running browser or app-bound encrypted, so cookiesfrombrowser fails.
        import tempfile  # drags shutil + random in, and only a cookie job ever needs it
        fd, jar = tempfile.mkstemp(prefix="ytdlp-cookies-", suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf8") as f:
            f.write(job["cookies"])
        opts["cookiefile"] = jar

    threading.Thread(target=keepalive, daemon=True).start()

    def fetch():
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(job["url"])["title"]

    try:
        try:
            title = fetch()
        except yt_dlp.utils.DownloadError as e:
            if not (opts.get("writesubtitles") and SUB_FAIL.search(str(e))):
                raise
            # subtitles are decoration, and nothing has downloaded yet: drop them and get the
            # video rather than lose both
            send(state="running", msg="subtitles unavailable - continuing without them")
            for k in ("writesubtitles", "writeautomaticsub", "subtitleslangs"):
                opts.pop(k, None)
            opts["postprocessors"] = [p for p in opts["postprocessors"]
                                      if p["key"] != "FFmpegEmbedSubtitle"]
            title = fetch()
        send(state="done", msg=title, dir=dest)
    except Exception as e:
        clean = re.sub(r"\x1b\[[0-9;]*m", "", str(e)).replace("ERROR: ", "")  # yt-dlp colours these
        hint = " - yt-dlp is probably out of date: run install.bat again" if STALE.search(clean) else ""
        send(state="error", msg=clean[:200] + hint)
    finally:
        if jar:
            os.unlink(jar)  # session cookies must not linger in temp
    os._exit(0)  # frames are flushed as they are sent


def main():
    job = recv()
    if not job:
        return
    if job.get("cmd") == "pick":
        return send(state="picked", dest=pick_folder() or "")
    if job.get("dest"):
        # normpath so the frames read the same as they did under pathlib: the folder dialog hands
        # back forward slashes on Windows, and this is what the panel shows back to the user.
        dest = os.path.normpath(os.path.expanduser(job["dest"]))
        if not os.path.isdir(dest):
            return send(state="error", msg=f"Folder not found: {dest}")
    else:
        dest = DESKTOP
        os.makedirs(dest, exist_ok=True)
    threading.Thread(target=download, args=(job, dest), daemon=True).start()
    # main thread stays free to hear "cancel", or EOF when the browser drops the port
    recv()
    for f in PARTS:
        try:
            os.remove(f)  # do not leave half-files behind in the folder
        except OSError:
            pass
    # plain os._exit would orphan a running ffmpeg child, so take the whole tree down
    if os.name == "nt":
        import subprocess  # only the cancel path shells out; ~4ms of imports off every spawn
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(os.getpid())],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os._exit(1)


def check_opts():
    """The half of selftest needing no network: option building and error classification.

    Run alone with:  python native_host.py --check-opts
    """
    import importlib.util  # build_opts probes for mutagen lazily, so the test has to as well
    keys = lambda o: [p["key"] for p in o["postprocessors"]]  # noqa: E731
    pp = lambda o, k: next(p for p in o["postprocessors"] if p["key"] == k)  # noqa: E731

    assert build_opts("video", "mp4", "1080")["format"] == \
        "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]"
    assert build_opts("video", "mkv", "best")["format"] == "bv*+ba/b"
    assert all(build_opts(m, f, "best")["noplaylist"] for m, f in [("video", "mp4"), ("audio", "mp3")])
    assert build_opts("video", "webm", "720")["merge_output_format"] == "webm"
    a = build_opts("audio", "mp3", "192")["postprocessors"][0]
    assert (a["preferredcodec"], a["preferredquality"]) == ("mp3", "192")
    assert build_opts("audio", "wav", "best")["postprocessors"][0]["preferredquality"] == "0"
    assert not keys(build_opts("video", "mp4", "best"))  # nothing asked for, nothing added

    v = build_opts("video", "mp4", "1080", subs=True, meta=True)
    assert v["writesubtitles"] and v["writeautomaticsub"] and v["writethumbnail"]
    assert keys(v) == ["FFmpegEmbedSubtitle", "FFmpegMetadata", "EmbedThumbnail"], keys(v)
    # webm and wav cannot hold a cover image: asking anyway fails the whole download
    w = build_opts("video", "webm", "best", meta=True)
    assert "writethumbnail" not in w and keys(w) == ["FFmpegMetadata"], w
    assert "writethumbnail" not in build_opts("audio", "wav", "best", meta=True)
    # ogg-family cover art goes through mutagen, and yt-dlp raises without it
    opus = build_opts("audio", "opus", "best", meta=True)
    assert bool(importlib.util.find_spec("mutagen")) == ("writethumbnail" in opus), opus
    # subtitles are video-only, and audio must be extracted before anything is embedded into it
    assert "writesubtitles" not in build_opts("audio", "mp3", "best", subs=True)
    m = build_opts("audio", "mp3", "192", meta=True)
    assert keys(m) == ["FFmpegExtractAudio", "FFmpegMetadata", "EmbedThumbnail"], keys(m)

    assert build_opts("video", "mp4", "best", subs=True)["subtitleslangs"] == ["en"]

    # wav and flac accept the chapter metadata and silently discard it, so it is not requested:
    # with nothing else asked for that leaves no postprocessor to run at all
    for f in ("wav", "flac"):
        assert keys(build_opts("audio", f, "best", chapters=True)) == ["FFmpegExtractAudio"], f
        t = build_opts("audio", f, "best", meta=True, chapters=True)
        assert not pp(t, "FFmpegMetadata")["add_chapters"], t
    # ...while the audio containers that do keep chapters still get them
    for f in ("mp3", "m4a", "opus"):
        assert pp(build_opts("audio", f, "best", chapters=True), "FFmpegMetadata")["add_chapters"], f
    # chapters ride on the metadata postprocessor, but must not drag cover art in with them
    c = build_opts("video", "mp4", "best", chapters=True)
    assert keys(c) == ["FFmpegMetadata"] and "writethumbnail" not in c, c
    assert c["postprocessors"][0] == {"key": "FFmpegMetadata", "add_metadata": False,
                                      "add_chapters": True}, c
    b = build_opts("video", "mp4", "best", meta=True, chapters=True)
    assert keys(b) == ["FFmpegMetadata", "EmbedThumbnail"], keys(b)
    assert b["postprocessors"][0]["add_metadata"] and b["postprocessors"][0]["add_chapters"]
    assert not build_opts("video", "mp4", "best", meta=True)["postprocessors"][0]["add_chapters"]

    assert STALE.search("Unable to extract player response")
    assert STALE.search("Requested format is not available")
    assert not STALE.search("Video unavailable")  # a dead video, not a stale extractor
    assert SUB_FAIL.search("Unable to download video subtitles for 'en': HTTP Error 429")
    assert SUB_FAIL.search("Cannot write video subtitles file foo.en.vtt")
    assert not SUB_FAIL.search("Video unavailable")  # must not swallow a real download failure

    # the keepalive must stay quiet while progress frames are flowing, and speak up once the
    # pipe has gone silent for 15s - that is the whole point of it
    import io as _io
    global PIPE
    real, PIPE = PIPE, _io.BytesIO()
    try:
        send(state="running", pct=1)
        assert PIPE.tell() and time.monotonic() - SENT[0] < 1  # send() stamps SENT
        t = threading.Thread(target=keepalive, daemon=True)
        t.start()
        n = PIPE.tell()
        time.sleep(7)
        assert PIPE.tell() == n, "keepalive spoke while the pipe was still fresh"
        SENT[0] -= 20  # pretend a long merge has been silent
        time.sleep(7)
        assert PIPE.tell() > n, "keepalive stayed silent through a 20s gap"
    finally:
        STOP.set()
        t.join(timeout=6)
        PIPE = real
    print("check_opts ok")


def selftest():
    import glob, subprocess, tempfile  # main() and download() import these lazily now

    check_opts()

    def run(job, cancel_after=None):
        """Drive a real child the way Chrome does: the pipe stays open for the whole job."""
        proc = subprocess.Popen([sys.executable, "-u", __file__], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        b = json.dumps(job).encode()
        proc.stdin.write(struct.pack("@I", len(b)) + b)
        proc.stdin.flush()
        if cancel_after is not None:
            time.sleep(cancel_after)
            c = json.dumps({"cmd": "cancel"}).encode()
            try:
                proc.stdin.write(struct.pack("@I", len(c)) + c)
                proc.stdin.flush()
            except OSError:
                pass  # it already finished
        out = proc.stdout.read()
        proc.wait(timeout=90)
        frames, buf = [], out
        while buf:
            n = struct.unpack("@I", buf[:4])[0]
            frames.append(json.loads(buf[4:4 + n]))
            buf = buf[4 + n:]
        return frames

    dud = "https://www.youtube.com/watch?v=zzzzznope"
    frames = run({"url": dud, "mode": "video"})
    assert frames and frames[-1]["state"] == "error", frames

    bad = run({"url": "x", "dest": "Z:/nope/nowhere"})
    assert bad and "Folder not found" in bad[0]["msg"], bad

    pat = os.path.join(tempfile.gettempdir(), "ytdlp-cookies-*")
    before = set(glob.glob(pat))
    run({"url": dud, "cookies": "# Netscape HTTP Cookie File" + chr(10)})
    assert not set(glob.glob(pat)) - before, "cookie file left behind in temp"

    started = time.monotonic()
    run({"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "mode": "video", "quality": "360"},
        cancel_after=0.4)
    took = time.monotonic() - started
    assert took < 40, f"cancel did not stop the host ({took:.0f}s)"

    print(f"selftest ok - {len(frames)} frame(s), cancel honoured in {took:.1f}s")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--check-opts" in sys.argv:
        check_opts()
    else:
        main()
