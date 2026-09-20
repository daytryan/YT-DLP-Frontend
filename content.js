// Puts a Download button in the YouTube action row, right of Share, with a dropdown under it.
//
// Every step that touches YouTube's DOM degrades rather than breaks:
//   named selectors -> structural search -> our own styling -> a button near the title.
// The downloader itself never depends on the page, and the toolbar popup keeps working even
// if all of this fails.
// only the button rules on every page; the panel's ~3.7KB sheet goes in when it is first opened
ytdlpSheet("ytdlp-style", YTDLP_BTN_CSS);
let panel, anchor, href = location.href, misses = 0, fixes = 0;
const SETTLE = 3;  // ticks to wait for a donor to show up in an otherwise empty row
const FIXES = 3;   // re-seats allowed per page before we live with the seat we have
const LOOSE = 8;   // failed attempts at a real row before settling for a button near the title

function closePanel() {
  if (panel) document.getElementById("ytdlp-btn")?.setAttribute("aria-expanded", "false");
  panel?.ytdlpDestroy?.();
  panel?.remove();
  panel = null;
  anchor = null;  // do not retain a detached button
}

// absolute + page coordinates: pops out of the button and scrolls with it, unlike position:fixed
function place() {
  if (!panel || !anchor?.isConnected) return;
  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth || 300;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 12));
  panel.style.top = `${r.bottom + scrollY + 10}px`;
  panel.style.left = `${left + scrollX}px`;
  panel.style.setProperty("--ytdlp-arrow",
    `${Math.max(16, Math.min(r.left + r.width / 2 - left, w - 26))}px`);
}

// YouTube defines its theme variables on ytd-app, and our panel is appended to <body> as a
// sibling of it, so nothing inherits. Copy the live values over at open time and the panel
// follows the page's own theme, light or dark, including any future retheme.
function readTheme() {
  const app = document.querySelector("ytd-app");
  const src = getComputedStyle(app || document.documentElement);
  const vars = {};
  for (const v of YTDLP_VARS) {
    const val = src.getPropertyValue(v).trim();
    if (val) vars[v] = val;  // absent token: ytdlpPaint's default stands
  }
  return { dark: document.documentElement.hasAttribute("dark") || !!app?.hasAttribute("dark"),
           vars };
}

let painted = "";

function paint(el) {
  const theme = readTheme();
  ytdlpPaint(el, theme);
  // the toolbar popup has no YouTube page to read, so leave it the last theme we saw here
  const json = JSON.stringify(theme);
  if (json !== painted) chrome.storage.local.set({ theme: (painted = json, theme) });
}

function openPanel(btn) {
  closePanel();
  anchor = btn;
  panel = buildPanel(async () => location.href, closePanel);
  panel.classList.add("ytdlp-pop");
  paint(panel);
  document.body.appendChild(panel);
  place();
  panel.querySelector("button,input,select")?.focus();
  btn.setAttribute("aria-expanded", "true");
}

addEventListener("click", e => {
  if (panel && !panel.contains(e.target) && !e.target.closest("#ytdlp-btn")) closePanel();
}, true);
addEventListener("keydown", e => e.key === "Escape" && closePanel());
addEventListener("yt-navigate-start", closePanel);  // nice-to-have; the poll covers it if renamed
// Those copied sizes are measured once, so after a resize they describe the old layout. Drop the
// button and let the poll re-clone it against the new one.
let resized;
addEventListener("resize", () => {
  place();
  clearTimeout(resized);
  resized = setTimeout(() => {
    document.getElementById("ytdlp-btn")?.remove();
    misses = fixes = 0;  // the layout moved, so allow re-seating against the new one
  }, 250);
});

// ponytail: checkVisibility() would answer from style instead of forcing a layout, but it counts
// a zero-size box as visible, and "laid out at all" is exactly what isRow asks. Consecutive reads
// with no write between them cost one flush, not one each, so the swap bought ~nothing anyway.
const visible = el => !!el && el.getClientRects().length > 0;
const labelOf = b => (b.getAttribute("aria-label") || b.title || b.textContent || "").trim();

// ---------------------------------------------------------------- where the button goes

const NAMED_ROWS = ["#top-level-buttons-computed", "ytd-watch-metadata #actions-inner",
                    "ytd-watch-metadata #actions", "#menu-container #top-level-buttons-computed"];

// #above-the-fold and #primary-inner also exist on the home and search feeds, where a
// structural scan would walk the whole video grid. Only answer on a watch page.
const metaBlock = () => document.querySelector("ytd-watch-metadata") ||
  (location.pathname === "/watch" && (document.querySelector("#above-the-fold") ||
                                      document.querySelector("#primary-inner")));

// A row is something with at least two button-bearing children sitting side by side. That
// matters: #actions and #actions-inner match by name but are wrappers around a single child,
// #menu. Seating us "next to Share" inside one of those means next to the whole menu, which
// drops a full-width button onto its own line underneath it — the bug this rules out. They only
// win the name check while #top-level-buttons-computed is still being laid out, so waiting a
// tick for the real row costs nothing.
const rowKids = el => [...el.children]
  .filter(c => visible(c) && (c.tagName === "BUTTON" || c.querySelector("button")));
const isRow = el => visible(el) && rowKids(el).length >= 2;

// If every name above is renamed, find the row by shape instead: the widest set of side-by-side
// buttons in the metadata block. Layout outlives ids and class names.
function discoverRow() {
  const meta = metaBlock();
  if (!meta) return null;
  let best = null, count = 1;
  for (const el of meta.querySelectorAll("div,span,ytd-menu-renderer")) {
    if (!visible(el)) continue;
    const kids = rowKids(el);
    if (kids.length <= count) continue;
    const tops = kids.map(k => k.getBoundingClientRect().top);
    if (Math.max(...tops) - Math.min(...tops) > 8) continue;  // must sit on one horizontal line
    best = el;
    count = kids.length;
  }
  return best;
}

const findRow = () => NAMED_ROWS.map(s => document.querySelector(s)).find(isRow) || discoverRow();

// the row's own child that holds `el`, so we insert between siblings rather than inside a widget
function rowChild(row, el) {
  for (let n = el; n && n !== row; n = n.parentElement) if (n.parentElement === row) return n;
}

// Segmented halves (like/dislike) have mismatched corner radii — true whatever they are called.
function pillish(b) {
  if (!visible(b) || b.id === "ytdlp-btn" || b.offsetHeight < 24) return false;
  const cs = getComputedStyle(b);
  return cs.borderTopLeftRadius === cs.borderTopRightRadius;
}

// Share by name when we can read it, otherwise the last standalone pill — which is where Share
// sits anyway. Keeps working when YouTube is not in English.
function pickDonor(row) {
  const pills = [...row.querySelectorAll("button")].filter(pillish);
  return pills.find(b => /share/i.test(labelOf(b))) || pills[pills.length - 1] || null;
}

// ---------------------------------------------------------------- building the button

function setLabel(el, text) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeValue.trim()) { n.nodeValue = text; return true; }
  }
  return false;  // icon-only button, which is a fine match for an icon-only row
}

function plainButton() {
  const btn = h("button", { className: "ytdlp-btn" });
  btn.append(ytdlpIcon(), "Download");
  return btn;
}

// Clone YouTube's own button so ours matches by construction: same box, font, hover and theme,
// and it follows along when they restyle.
function cloneButton(donor) {
  const btn = donor.cloneNode(true);  // a plain <button>, so no Polymer re-init on insert
  for (const a of ["id", "aria-pressed", "aria-disabled", "disabled"]) btn.removeAttribute(a);
  btn.setAttribute("aria-label", "Download with yt-dlp");
  btn.title = "Download with yt-dlp";
  const svg = btn.querySelector("svg");
  if (svg) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.replaceChildren(ytdlpIcon().firstChild);
    const size = getComputedStyle(donor.querySelector("svg"));
    svg.style.width = size.width;
    svg.style.height = size.height;
  } else {
    btn.prepend(ytdlpIcon());
  }
  setLabel(btn, "Download");
  // A bare clone leaves its view-model wrapper behind, and with it any sizing that came from
  // wrapper-scoped rules or CSS vars. Copy what the live original computes.
  const box = getComputedStyle(donor);
  // no minWidth: the donor's is a stretch vector we never want, and #ytdlp-btn pins the rest
  for (const prop of ["height", "padding", "fontSize", "fontWeight", "fontFamily",
                      "lineHeight", "letterSpacing", "borderRadius"]) btn.style[prop] = box[prop];
  btn.style.flex = "0 0 auto";
  return btn;
}

function wire(btn) {
  btn.id = "ytdlp-btn";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.onclick = () => (panel ? closePanel() : openPanel(btn));
  return btn;
}

// Did we wrap onto our own line underneath the row? Same 8px tolerance discoverRow() uses.
// Measured against whatever our siblings are right now, not against a donor we remembered:
// YouTube swaps those nodes out as the page hydrates, and a remembered one that goes detached
// measures as a zero rect, which silently turned this check off for the rest of the page.
// Only siblings ABOVE us count, so the fallback button we deliberately put on its own line
// above the title never reads as wrapped. Nothing laid out yet is not evidence of anything.
function wrapped(btn) {
  const top = btn.getBoundingClientRect().top;
  let highest = Infinity;
  for (const sib of btn.parentElement?.children || []) {
    const r = sib === btn ? null : sib.getBoundingClientRect();
    if (r?.height) highest = Math.min(highest, r.top);
  }
  return btn.offsetHeight > 0 && top - highest > 8;
}

// What the row actually renders between two of its own children, whatever produces it —
// margins, a flex gap, or wrapper padding. Reading the seat's margin instead only works on rows
// that happen to space with margins; the fallback rows report 0 and leave us glued to Share.
// The narrowest real gap is the row's rhythm; a wider one is a group break, not spacing.
//
// Measure BEFORE our button is in the row, never after. Leaving it out of the child list does
// not take it out of the layout: the pair it sits between then measures as one "gap" with the
// whole button inside it, and that reading becomes our margin. Live on YouTube that turned the
// row's real 8px into 103px (a 95px button plus its 8px gap) — the visible hole beside Download.
// The g > 0 filter hides the mistake rather than catching it, because this row's honest reading
// is 0px between the like cluster and the Share cluster, so the poisoned pair is the only
// candidate left.
function shownGap(row) {
  const kids = [...row.children].filter(c => c.getBoundingClientRect().height > 0);
  const gaps = [];
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
    if (Math.abs(a.top - b.top) <= 8) gaps.push(Math.round(b.left - a.right));
  }
  const real = gaps.filter(g => g > 0);
  return real.length ? Math.min(...real) : 8;  // no row puts two pills edge to edge
}

function inject(loose) {
  const row = loose ? null : findRow();
  // No row, or none we can sit in cleanly after LOOSE tries: a plain button above the title
  // reads as deliberate, which a full-width one wedged under Share never does.
  if (!row || misses >= LOOSE) {
    const meta = metaBlock();  // last resort: at least put it near the title
    if (!visible(meta)) return false;
    const loose = wire(plainButton());
    loose.dataset.ytdlpLoose = "";  // stand-in: step aside as soon as a real row turns up
    loose.style.margin = "8px 0";
    meta.prepend(loose);
    return true;
  }
  const donor = pickDonor(row);
  // The row element usually exists before YouTube fills it in. Injecting into an empty one
  // strands us at the end of a half-built row, so wait for a donor instead of taking a bad seat.
  if (!donor && misses < SETTLE) return false;
  // Read the row's rhythm while the row is still its own: once we are in it, the pair we sit
  // between measures as our own width instead. See shownGap().
  const gap = shownGap(row);
  const donorText = donor ? labelOf(donor) : "";
  let btn = wire(donor ? cloneButton(donor) : plainButton());
  const seat = donor && rowChild(row, donor);
  if (seat) seat.after(btn); else row.appendChild(btn);  // after() returns undefined: no ?? here
  // Trust but verify: never leave a collapsed button, or one still reading "Share"
  if (btn.offsetHeight < 16 || btn.offsetWidth < 16 ||
      (donorText && btn.textContent.trim() === donorText)) {
    const plain = wire(plainButton());
    btn.replaceWith(plain);
    btn = plain;
  }
  // Spacing goes on last, so the stand-in swapped in above gets it too rather than falling back
  // to .ytdlp-btn's guess. What lands between us and the seat is the seat's own margin-right
  // plus ours, so subtract theirs off the target instead of double-counting it.
  if (seat) {
    const mr = parseFloat(getComputedStyle(seat).marginRight) || 0;
    btn.style.marginLeft = `${Math.max(0, gap - mr)}px`;
    btn.style.marginRight = `${mr}px`;
  }
  // Landed on our own line under Share — a row still mid-layout, or one we misread. Never keep
  // that seat: it is the whole visible bug, and the poll gets another go in a second. LOOSE
  // above guarantees we still end up with a working button if no row ever suits us.
  if (wrapped(btn)) {
    btn.remove();
    return false;
  }
  return btn.offsetHeight > 0;
}

// ponytail: a flat 1s poll, and no cleverness about skipping it. YouTube is an SPA that rebuilds
// this row on every navigation, so the poll has to run anyway; having it re-check placement every
// time costs one getBoundingClientRect — measured on a live watch page, 0.1ms when the page's
// layout is already clean and 9.6ms when our read is what forces it, against a frame the browser
// was about to lay out regardless. An observer-driven version of this (wake only when the row
// mutates or resizes) was measurably cheaper and wrong: every wake-up it missed — a sibling
// growing, a container rewrapping a level further up — left the button visibly out of line for
// as long as it took the next sweep to come round.
// Ceiling: a wrap is corrected within one tick, not instantly. If a second ever proves too slow to
// the eye, an IntersectionObserver band across the row's first line reports the move for free.
function tick() {
  if (document.hidden || document.fullscreenElement) return;  // nothing to see, so nothing to fix
  if (href !== location.href) {  // SPA navigation, without relying on YouTube's custom event
    href = location.href;
    misses = fixes = 0;
    closePanel();
  }
  // the URL shape is a hint, not a requirement: a visible metadata block also means "watch page"
  if (location.pathname !== "/watch" && !visible(metaBlock())) return closePanel();
  const placed = document.getElementById("ytdlp-btn");
  let giveUp = false;
  if (placed?.isConnected) {
    // The row keeps reflowing after the button is in: the primary column narrows when the
    // sidebar mounts, and late buttons (Clip, Thanks, the overflow menu) arrive seconds in —
    // any of which can wrap an already-correct button onto its own line under Share. So keep
    // checking for the life of the page rather than for a few ticks after load, and let a
    // stand-in near the title give way once a real row exists. FIXES caps both, so a row that
    // is genuinely too narrow settles instead of flickering, and an open panel is never yanked
    // out from under the user.
    const loose = placed.hasAttribute("data-ytdlp-loose");
    const redo = loose ? !!findRow() : wrapped(placed);
    // A settled seat is as done as a clean one; an open panel blocking a needed re-seat is not.
    // Settled only ever means the stand-in, though: a wrapped button is never one we live with.
    if (panel || !redo || (loose && fixes >= FIXES)) return place();
    // Out of re-seats and still under Share: take the stand-in above the title instead. It sits
    // on its own line by design, so it cannot wrap, which makes it a real end state — where
    // freezing in the wrapped seat left the glitch on screen until the page was reloaded.
    if (fixes >= FIXES) giveUp = true; else fixes++;
    placed.remove();
    misses = 0;
  }
  closePanel();  // the row was rebuilt, so our old anchor is gone
  // back off if this page truly has no row, so a redesign cannot cost a scan every second forever
  if (misses >= 10 && misses % 10) return void misses++;
  misses = inject(giveUp) ? 0 : misses + 1;
}
setInterval(tick, 1000);
