// Shared UI: mounted both in the YouTube page (content.js) and in the popup (popup.js).
const YTDLP_OPTS = {
  video: {
    formats: ["mp4", "mkv", "webm"],
    qualities: [["best", "Best available"], ["2160", "2160p (4K)"], ["1440", "1440p"],
                ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"]],
  },
  audio: {
    formats: ["mp3", "m4a", "opus", "wav", "flac"],
    qualities: [["best", "Best available"], ["320", "320 kbps"], ["192", "192 kbps"], ["128", "128 kbps"]],
  },
};

// What each container can actually hold, so we never offer an option that cannot work.
// Cover art: yt-dlp embeds thumbnails only in mp3, mkv/mka, ogg/opus/flac and m4a/mp4/m4v/mov,
// and RAISES on anything else rather than skipping — which fails the whole download.
// Chapters: checked against ffmpeg 7.1.1 — they survive mp3, m4a, opus, mp4, mkv and webm,
// and are written then silently dropped by wav and flac.
// Plain title/artist tags survive everywhere, wav and webm included, which is why a format that
// cannot take a cover image keeps that checkbox rather than losing the tags with it.
const YTDLP_NO_COVER = ["wav", "webm"];
const YTDLP_NO_CHAPTERS = ["wav", "flac"];

const YTDLP_CSS = `
.ytdlp-panel{width:300px;box-sizing:border-box;padding:14px;border-radius:14px;
  background:var(--yt-spec-menu-background,#282828);color:var(--yt-spec-text-primary,#f1f1f1);
  font:400 13px/1.4 Roboto,"Segoe UI",Arial,sans-serif;
  border:1px solid var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));
  box-shadow:0 8px 28px rgba(0,0,0,.45)}
.ytdlp-panel *{box-sizing:border-box;font-family:inherit}
.ytdlp-head{display:flex;margin-bottom:6px}
.ytdlp-head:empty{display:none}
.ytdlp-x{margin-left:auto;border:0;background:none;color:var(--yt-spec-text-secondary,#aaa);
  font-size:18px;line-height:1;padding:0 2px;cursor:pointer;min-width:24px;min-height:24px}
.ytdlp-x:hover{color:var(--yt-spec-text-primary,#f1f1f1)}
.ytdlp-seg{display:flex;background:var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));
  border-radius:9px;padding:3px;margin-bottom:12px}
.ytdlp-seg button{flex:1;border:0;background:none;color:var(--yt-spec-text-secondary,#aaa);
  padding:7px 0;border-radius:7px;cursor:pointer;font-size:13px;font-weight:500}
.ytdlp-seg button.on{background:var(--yt-spec-call-to-action,#3ea6ff);
  color:var(--yt-spec-base-background,#0f0f0f)}
.ytdlp-row{display:flex;gap:8px;margin-bottom:12px}
.ytdlp-row label{flex:1;font-size:11px;color:var(--yt-spec-text-secondary,#aaa);
  text-transform:uppercase;letter-spacing:.5px}
.ytdlp-row select,.ytdlp-folder input{width:100%;padding:8px;border-radius:8px;cursor:pointer;
  background:var(--yt-spec-base-background,#0f0f0f);
  color:var(--yt-spec-text-primary,#f1f1f1);font-size:13px;
  border:1px solid var(--yt-spec-10-percent-layer,rgba(255,255,255,.1))}
/* the native option list needs opaque colours of its own: it does not inherit the control's */
.ytdlp-row select option{background:var(--yt-spec-base-background,#0f0f0f);
  color:var(--yt-spec-text-primary,#f1f1f1)}
.ytdlp-row select{margin-top:5px}
.ytdlp-lbl{display:block;font-size:11px;color:var(--yt-spec-text-secondary,#aaa);
  text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
/* equal columns, so the three sit on one line at fixed positions instead of wrapping ragged */
.ytdlp-chks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.ytdlp-chk{display:flex;align-items:center;gap:6px;cursor:pointer;min-width:0;
  font-size:12px;line-height:16px;white-space:nowrap;padding:4px 0;
  color:var(--yt-spec-text-secondary,#aaa)}
.ytdlp-chk:hover{color:var(--yt-spec-text-primary,#f1f1f1)}
/* accent-color themes the native control, so there is no custom checkbox widget to maintain.
   The box is sized explicitly: the UA default is font-size dependent and drifts out of line. */
.ytdlp-chk input{flex:0 0 auto;width:13px;height:13px;margin:0;cursor:pointer;
  accent-color:var(--yt-spec-call-to-action,#3ea6ff)}
.ytdlp-folder{display:flex;gap:6px;margin-bottom:12px}
.ytdlp-folder input{flex:1;min-width:0;font-size:12px}
.ytdlp-folder input::placeholder{color:var(--yt-spec-text-secondary,#aaa);opacity:1}
.ytdlp-folder button{padding:0 11px;border:0;border-radius:8px;font-size:12px;cursor:pointer;
  background:var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));
  color:var(--yt-spec-text-primary,#f1f1f1)}
.ytdlp-folder button:hover{filter:brightness(1.35)}
.ytdlp-folder button.x{display:none;padding:0 10px;font-size:15px;line-height:1;
  min-width:24px;min-height:24px}
.ytdlp-go{width:100%;padding:10px;border:0;border-radius:9px;font-size:14px;font-weight:500;
  cursor:pointer;background:var(--yt-spec-text-primary,#f1f1f1);
  color:var(--yt-spec-base-background,#0f0f0f)}
.ytdlp-go:hover{opacity:.85}
.ytdlp-go.cancel{background:var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));
  color:var(--ytdlp-err,#ff8a80)}
.ytdlp-prog{margin-top:12px;display:none}
.ytdlp-bar{height:6px;border-radius:999px;overflow:hidden;
  background:var(--yt-spec-10-percent-layer,rgba(255,255,255,.1))}
.ytdlp-fill{height:100%;width:0;border-radius:999px;transition:width .25s ease;
  background:var(--yt-spec-call-to-action,#3ea6ff)}
.ytdlp-fill.busy{animation:ytdlp-pulse 1.1s ease-in-out infinite}
@keyframes ytdlp-pulse{50%{opacity:.45}}
.ytdlp-stat{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:11.5px;
  color:var(--yt-spec-text-secondary,#aaa);font-variant-numeric:tabular-nums}
.ytdlp-stat b{color:var(--yt-spec-text-primary,#f1f1f1);font-weight:500;font-size:12.5px}
.ytdlp-msg{margin-top:10px;min-height:16px;font-size:12px;word-break:break-word;
  color:var(--yt-spec-text-secondary,#aaa)}
.ytdlp-msg.err{color:var(--ytdlp-err,#ff8a80)}
.ytdlp-msg.ok{color:var(--ytdlp-ok,#5cc98a)}
/* dropdown anchored to the button, in document coordinates so it scrolls with the page */
.ytdlp-pop{position:absolute;z-index:3000;transform-origin:top left;animation:ytdlp-in .12s ease-out}
.ytdlp-pop::before{content:"";position:absolute;top:-6px;left:var(--ytdlp-arrow,24px);width:10px;
  height:10px;background:var(--yt-spec-menu-background,#282828);transform:rotate(45deg);
  border-left:1px solid var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));
  border-top:1px solid var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));border-radius:2px}
@keyframes ytdlp-in{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .ytdlp-pop,.ytdlp-fill.busy{animation:none}
  .ytdlp-fill{transition:none}
}
`;

// Split out of the sheet above because this is the only part every YouTube page needs: the
// toolbar button is injected at load, the panel usually never is.
const YTDLP_BTN_CSS = `
.ytdlp-btn{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 16px;border:0;
  border-radius:18px;background:var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));
  color:var(--yt-spec-text-primary,#f1f1f1);font:500 14px Roboto,Arial,sans-serif;cursor:pointer;
  white-space:nowrap;flex:0 0 auto;margin-left:8px}
.ytdlp-btn:hover{filter:brightness(1.4)}
/* .ytdlp-btn is only a fallback: normally we clone YouTube's own Share button */
/* The clone inherits YouTube's row CSS and carries sizes copied at inject time, so a narrow
   layout can stretch it. Pin the box here — author !important also beats those inline copies. */
#ytdlp-btn{flex:0 0 auto!important;align-self:center!important;width:auto!important;
  min-width:0!important;max-width:200px!important;white-space:nowrap!important;overflow:hidden}
`;

// ---------------------------------------------------------------- theme
// The CSS fallbacks above are YouTube's dark values, so a dark panel needs nothing but its
// status colours. A light one has to override every token, because it may have no live
// values to copy: the popup runs outside the page, and reads the last theme from storage.
const YTDLP_VARS = ["--yt-spec-menu-background", "--yt-spec-text-primary",
                    "--yt-spec-text-secondary", "--yt-spec-call-to-action",
                    "--yt-spec-base-background", "--yt-spec-10-percent-layer"];

// YouTube has no token for an error or a success state, and no single hex clears AA on both
// a near-black and a near-white panel, so these two are ours. Checked against the panel and
// against the 10-percent layer the Cancel button sits on - the lighter surface in dark mode:
// dark 4.7-7.1:1, light 4.6-6.3:1.
const YTDLP_DARK = { "--ytdlp-err": "#ff8a80", "--ytdlp-ok": "#5cc98a" };
const YTDLP_LIGHT = { "--ytdlp-err": "#c5221f", "--ytdlp-ok": "#0f7b3f",
                      "--yt-spec-menu-background": "#fff", "--yt-spec-text-primary": "#0f0f0f",
                      "--yt-spec-text-secondary": "#606060", "--yt-spec-call-to-action": "#065fd4",
                      "--yt-spec-base-background": "#fff",
                      "--yt-spec-10-percent-layer": "rgba(0,0,0,.1)" };

// theme = { dark, vars } - read live off the page by content.js, replayed from storage by
// the popup. Live values win over the defaults; a missing one leaves the default standing.
function ytdlpPaint(el, theme) {
  const dark = theme?.dark !== false;
  for (const [k, v] of Object.entries(dark ? YTDLP_DARK : YTDLP_LIGHT)) el.style.setProperty(k, v);
  for (const [k, v] of Object.entries(theme?.vars || {})) if (v) el.style.setProperty(k, v);
  // checkboxes and selects are drawn by the browser, not our CSS: tell it which way round
  el.style.colorScheme = dark ? "dark" : "light";
  return dark;
}

function ytdlpSheet(id, css) {
  if (!document.getElementById(id)) document.head.appendChild(h("style", { id, textContent: css }));
}

function h(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.flat());
  return e;
}

function ytdlpIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const p = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  p.setAttribute("d", "M12 3v11m0 0l4.5-4.5M12 14l-4.5-4.5M4 19h16");
  for (const [k, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "2",
      "stroke-linecap": "round", "stroke-linejoin": "round" })) p.setAttribute(k, v);
  svg.appendChild(p);
  return svg;
}

// getUrl: () => Promise<string>. onClose: optional, adds a close button. Returns the panel element.
function buildPanel(getUrl, onClose) {
  ytdlpSheet("ytdlp-panel-style", YTDLP_CSS);  // first open pays for the panel's CSS, not page load
  let mode = "video";
  let running = false;
  const fmtSel = h("select"), qSel = h("select");
  const msg = h("div", { className: "ytdlp-msg", role: "status", ariaLive: "polite" });
  const go = h("button", { className: "ytdlp-go", textContent: "Download" });
  const barFill = h("div", { className: "ytdlp-fill" });
  const statL = h("span"), statR = h("span");
  // a readOnly input never fires click from the keyboard, so it was a focusable dead end.
  // Browse does the same job and is reachable; keep this one pointer-only.
  const destIn = h("input", { placeholder: "Desktop", readOnly: true, tabIndex: -1,
                              title: "Click to choose a folder" });
  const browse = h("button", { textContent: "Browse", title: "Choose a folder" });
  const reset = h("button", { textContent: "×", className: "x", title: "Back to Desktop" });
  const prog = h("div", { className: "ytdlp-prog" },
    h("div", { className: "ytdlp-bar" }, barFill),
    h("div", { className: "ytdlp-stat" }, statL, statR));
  const vBtn = h("button", { textContent: "Video" }), aBtn = h("button", { textContent: "Audio" });
  const subsIn = h("input", { type: "checkbox" }), metaIn = h("input", { type: "checkbox" });
  const chapIn = h("input", { type: "checkbox" });
  const chapChk = h("label", { className: "ytdlp-chk", title: "Add chapter markers you can skip "
                    + "between in VLC or mpv, when the video has them" }, chapIn, "Chapters");
  const subsChk = h("label", { className: "ytdlp-chk", title: "Embed English captions" },
                    subsIn, "Subtitles");
  const metaChk = h("label", { className: "ytdlp-chk",  // short enough to fit its grid column
                    title: "Embed the thumbnail as cover art, plus title and artist tags" },
                    metaIn, "Cover art");

  const canCover = () => !YTDLP_NO_COVER.includes(fmtSel.value);
  const canChapters = () => !YTDLP_NO_CHAPTERS.includes(fmtSel.value);

  // Never offer what the chosen container cannot hold. Chapters are all-or-nothing, so that box
  // goes the way Subtitles does below. The cover-art box also writes title and artist tags, which
  // every format keeps, so it stays and says what it will actually do instead of vanishing and
  // taking working metadata with it.
  const syncCaps = () => {
    const cover = canCover();
    metaChk.lastChild.nodeValue = cover ? "Cover art" : "Metadata";
    metaChk.title = cover
      ? "Embed the thumbnail as cover art, plus title and artist tags"
      : `${fmtSel.value.toUpperCase()} cannot hold a cover image — title and artist tags only`;
    chapChk.style.visibility = canChapters() ? "" : "hidden";
  };

  const fill = (sel, items) => {
    sel.replaceChildren(...items.map(i => {
      const [v, t] = Array.isArray(i) ? i : [i, i.toUpperCase()];
      return h("option", { value: v, textContent: t });
    }));
  };

  const setMode = (m, saved = {}) => {
    mode = m;
    vBtn.className = m === "video" ? "on" : "";
    aBtn.className = m === "audio" ? "on" : "";
    // audio has nothing to embed subs into. visibility, not display: the cell keeps its
    // grid column, so Chapters and Cover art stay put instead of sliding left.
    subsChk.style.visibility = m === "video" ? "" : "hidden";
    fill(fmtSel, YTDLP_OPTS[m].formats);
    fill(qSel, YTDLP_OPTS[m].qualities);
    if (saved.fmt) fmtSel.value = saved.fmt;
    if (saved.quality) qSel.value = saved.quality;
    syncCaps();  // the format list just changed under us
  };

  const save = () => chrome.storage.local.set({
    prefs: { mode, fmt: fmtSel.value, quality: qSel.value, dest: destIn.value.trim(),
             subs: subsIn.checked, meta: metaIn.checked, chapters: chapIn.checked } });

  vBtn.onclick = () => { setMode("video"); save(); };
  aBtn.onclick = () => { setMode("audio"); save(); };
  fmtSel.onchange = () => { syncCaps(); save(); };
  qSel.onchange = subsIn.onchange = metaIn.onchange = chapIn.onchange = save;

  // quiet: restoring what storage just handed us is not a change, so do not write it back
  const setDest = (v, quiet) => {
    destIn.value = v || "";
    reset.style.display = v ? "block" : "none";
    if (!quiet) save();
  };

  const size = b => b == null ? "" : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB`
    : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
  const clock = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

  const folder = p => (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Desktop";

  // show() runs on every progress frame (4/sec). textContent and replaceChildren always
  // rebuild their children, so skip the write when the rendered value has not moved.
  const set = (el, prop, v) => { if (el["_" + prop] !== v) el[prop] = el["_" + prop] = v; };

  const show = s => {
    if (s.state === "picked") {
      if (s.dest) setDest(s.dest);  // empty means the dialog was cancelled: keep what we had
      return;
    }
    running = s.state === "running";
    set(go, "textContent", running ? "Cancel" : "Download");
    go.classList.toggle("cancel", running);
    if (s.state === "idle") return;
    const live = s.state === "running" && s.pct != null;
    if (prog._live !== live) prog.style.display = (prog._live = live) ? "block" : "none";
    // toggled outside the branch below: a finished job must not leave the class behind
    barFill.classList.toggle("busy", live && s.stage === "processing");
    if (live) {
      const pct = `${s.pct}%`;
      if (barFill._pct !== pct) barFill.style.width = barFill._pct = pct;
      const whole = `${Math.round(s.pct)}%`, rest = s.total ? ` of ${size(s.total)}` : "";
      if (statL._txt !== whole + rest) {
        statL._txt = whole + rest;
        statL.replaceChildren(h("b", { textContent: whole }), rest);
      }
      set(statR, "textContent",
        [s.speed && `${size(s.speed)}/s`, s.eta != null && `${clock(s.eta)} left`]
          .filter(Boolean).join("  ·  "));
    }
    set(msg, "className",
      "ytdlp-msg" + (s.state === "done" ? " ok" : s.state === "error" ? " err" : ""));
    set(msg, "textContent", s.state === "done" ? `Saved to ${folder(s.dir)}: ${s.msg}`
      : live ? s.label || "Downloading" : s.msg || "");
  };

  let port = null;
  const connect = () => {
    port = chrome.runtime.connect({ name: "ytdlp" });
    port.onMessage.addListener(show);
    port.onDisconnect.addListener(() => (port = null));
    return port;
  };
  connect();

  // the background worker sleeps when idle; reconnect if this port died with it
  // ponytail: no destroyed flag - every post() caller is a handler on a node that a closed panel
  // has already detached. Add one if anything ever posts from a timer: the reconnect below would
  // hand a live port a listener holding the whole detached panel.
  const post = m => {
    try { (port || connect()).postMessage(m); } catch { connect().postMessage(m); }
  };

  destIn.onclick = browse.onclick = () => post({ cmd: "pick" });
  reset.onclick = () => setDest("");

  go.onclick = async () => {
    if (running) return post({ cmd: "cancel" });
    set(msg, "className", "ytdlp-msg");   // through set(), or the cache goes stale and a
    set(msg, "textContent", "starting..."); // repeat of the last message would be skipped
    barFill.style.width = barFill._pct = "0%";
    post({ url: await getUrl(), mode, fmt: fmtSel.value, quality: qSel.value,
           dest: destIn.value.trim(), subs: subsIn.checked, meta: metaIn.checked,
           // the box keeps its tick so the preference survives a format switch, but a container
           // that drops chapters must not be asked for them
           chapters: chapIn.checked && canChapters() });
  };

  setMode("video");
  chrome.storage.local.get("prefs", ({ prefs }) => {
    if (!prefs) return;
    subsIn.checked = !!prefs.subs;
    chapIn.checked = !!prefs.chapters;
    metaIn.checked = !!prefs.meta;
    setMode(prefs.mode, prefs);
    setDest(prefs.dest, true);
  });

  const el = h("div", { className: "ytdlp-panel" },
    h("div", { className: "ytdlp-head" },
      onClose ? h("button", { className: "ytdlp-x", textContent: "\u00d7",
                              title: "Close", ariaLabel: "Close",
                              onclick: onClose }) : []),
    h("div", { className: "ytdlp-seg" }, vBtn, aBtn),
    h("div", { className: "ytdlp-row" },
      h("label", { textContent: "Format" }, fmtSel),
      h("label", { textContent: "Quality" }, qSel)),
    h("div", { className: "ytdlp-chks" }, subsChk, chapChk, metaChk),
    h("span", { className: "ytdlp-lbl", textContent: "Save to" }),
    h("div", { className: "ytdlp-folder" }, destIn, browse, reset),
    go, prog, msg);
  // a closed panel must drop its port, or the service worker never goes idle again. Null it too:
  // disconnect() fires no local onDisconnect, so the closure would keep the dead Port alive.
  el.ytdlpDestroy = () => { port?.disconnect(); port = null; };
  return el;
}
