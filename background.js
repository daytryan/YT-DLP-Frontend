// Relays panel ports <-> the native host. Chrome starts the host process on connect and reaps
// it when the port closes, so nothing is running between downloads.
const HOST = "com.ytdlp.bridge";
const NOT_INSTALLED = "Native host not installed — run install.bat";
// age-gated, members-only and private videos all fail with one of these. Match whole phrases:
// a bare /age/ also hits "webpage", which sent every network blip down the cookie retry.
const NEEDS_LOGIN = new RegExp(["sign in", "cookie", "confirm your age", "age[- ]restricted",
  "members-only", "private video", "inappropriate for some users"].join("|"), "i");
const ui = new Set();
let host = null;
let cancelling = false;
let last = { state: "idle", msg: "" };

function broadcast(m) {
  last = m;
  for (const p of ui) try { p.postMessage(m); } catch { ui.delete(p); }
}

chrome.runtime.onConnect.addListener(port => {
  ui.add(port);
  port.onDisconnect.addListener(() => ui.delete(port));
  port.postMessage(last);  // catch up a panel that was just opened mid-download
  port.onMessage.addListener(m => (m.cmd === "cancel" ? cancel() : start(m)));
});

// The host cleans up its part-file and exits on its own, so ask rather than kill the port.
function cancel() {
  if (!host) return;
  cancelling = true;
  broadcast({ state: "running", msg: "cancelling..." });
  try { host.postMessage({ cmd: "cancel" }); } catch { host.disconnect(); }
}

// yt-dlp cannot read this browser's cookies itself: the DB is locked while the browser runs and
// app-bound encrypted on Windows. In here the live jar is just an API call.
async function youtubeCookies() {
  const rows = [];
  for (const domain of ["youtube.com", "google.com"]) {
    for (const c of await chrome.cookies.getAll({ domain })) {
      rows.push([c.domain, c.hostOnly ? "FALSE" : "TRUE", c.path, c.secure ? "TRUE" : "FALSE",
                 Math.floor(c.expirationDate || 0), c.name, c.value].join("\t"));
    }
  }
  return rows.length ? "# Netscape HTTP Cookie File\n" + rows.join("\n") + "\n" : "";
}

// ponytail: cookies are fetched only after a login-shaped failure, so ordinary downloads never
// put session cookies on disk. Drop the guard and always attach if you want one less round trip.
async function retryWithLogin(job, failure) {
  broadcast({ state: "running", msg: "needs your login - retrying with cookies..." });
  const cookies = await youtubeCookies();
  if (!cookies) return broadcast(failure);  // not signed in here: report the original error
  start({ ...job, cookies });
}

function start(job) {
  // ponytail: one download at a time; give `host` a Map keyed by job id if you want a queue
  if (host) return broadcast({ state: "running", msg: last.msg || "another download is running" });
  cancelling = false;
  const retried = !!job.cookies;  // read now: postMessage below drops the jar off `job`
  const h = chrome.runtime.connectNative(HOST);
  host = h;
  h.onMessage.addListener(m => {
    if (m.state === "error" && !job.cmd && !retried && NEEDS_LOGIN.test(m.msg)) {
      host = null;
      h.disconnect();
      return retryWithLogin(job, m);
    }
    broadcast(m);
    if (m.state !== "running") { host = null; h.disconnect(); }  // done: let Chrome reap the host
  });
  h.onDisconnect.addListener(() => {
    if (host !== h) return;  // we hung up on purpose after a finished job
    host = null;
    if (cancelling) {
      cancelling = false;
      return broadcast({ state: "cancelled", msg: "Cancelled" });
    }
    const err = chrome.runtime.lastError?.message || "";
    broadcast({ state: "error", msg: /not found|forbidden|Access/i.test(err) ? NOT_INSTALLED
                                     : err || "download host stopped unexpectedly" });
  });
  h.postMessage(job);
  // postMessage already serialised the jar to the host, but the listener above pins `job` for the
  // whole download - so a few hundred KB of session secrets would sit in the worker until it ends.
  job.cookies = null;
  if (!job.cmd) broadcast({ state: "running", msg: "starting..." });  // a folder pick is not a job
}
