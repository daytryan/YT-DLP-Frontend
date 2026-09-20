// Checks the two bits of content.js that decide where the Download button sits, and that
// together caused it to render underneath Share. Pulls the real code out of the source so the
// test cannot drift from it.   run: node test-wrapped.js
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync("extension/content.js", "utf8");
const grab = re => src.match(re)[0];

const { wrapped, isRow, shownGap } = eval(`(() => {
  ${grab(/const visible = el =>.*/)}
  ${grab(/const rowKids = el =>[\s\S]*?;\n/)}
  ${grab(/const isRow = el =>.*/)}
  ${grab(/function wrapped\(btn\)[\s\S]*?\n}/)}
  ${grab(/function shownGap\(row\)[\s\S]*?\n}/)}
  return { wrapped, isRow, shownGap };
})()`);

// ---- wrapped(): did we land on our own line under Share?
const el = (top, height = 32) => ({ getBoundingClientRect: () => ({ top, height }), offsetHeight: height });
const row = (btn, ...sibs) => (btn.parentElement = { children: [...sibs, btn] }, btn);

assert.equal(wrapped(row(el(100), el(100), el(100))), false, "same line is fine");
assert.equal(wrapped(row(el(148), el(100), el(100))), true, "a line below Share is a wrap");
assert.equal(wrapped(row(el(104), el(100))), false, "8px of sub-pixel jitter is not a wrap");
assert.equal(wrapped(row(el(148, 0), el(100))), false, "not laid out yet proves nothing");
assert.equal(wrapped(row(el(148), el(0, 0), el(148))), false, "zero-height siblings do not count");
assert.equal(wrapped(row(el(100), el(148))), false, "the stand-in sits above by design");
assert.equal(wrapped(row(el(100))), false, "no siblings, nothing to be off from");

// ---- shownGap(): the spacing the row actually renders, not the margin it claims.
// The bug this rules out: fallback rows report margin 0, which left us flush against Share.
const box = (left, right, top = 0) => ({ getBoundingClientRect: () => ({ left, right, top, height: 32 }) });
const gapRow = (...kids) => ({ children: kids });

assert.equal(shownGap(gapRow(box(0, 100), box(108, 200), box(208, 300))), 8, "the row's own rhythm");
assert.equal(shownGap(gapRow(box(0, 100), box(108, 200), box(240, 330))), 8,
             "a wide group break is not the spacing - the narrowest real gap is");
assert.equal(shownGap(gapRow(box(0, 100), box(100, 200))), 8,
             "a row that reports no spacing at all still must not seat us flush");
assert.equal(shownGap(gapRow(box(0, 100))), 8, "one child, nothing to learn, keep the default");
assert.equal(shownGap(gapRow(box(0, 100), box(108, 200), box(0, 100, 60))), 8,
             "a child on the next line is not a gap");
assert.equal(shownGap(gapRow(box(0, 100), box(112, 200))), 12, "a 12px row gives us 12px");

// The real YouTube watch row, measured 2026-09-20: [like|dislike][Share Ask Save] then the
// overflow button 8px later. Its honest reading is 8px, and the 0px between the two clusters
// is a group seam, not the rhythm.
assert.equal(shownGap(gapRow(box(814, 999), box(999, 1299), box(1307, 1347))), 8,
             "the live watch row spaces its groups 8px apart");

// The bug this rules out, and why the order of operations is the fix rather than any filter.
// Seated, our button is left out of the child list but NOT out of the layout: the pair it sits
// between then reads as one gap with the whole button inside it. Same row, after a 95px button
// lands behind the Share cluster and shoves the overflow button along - the row still renders
// 8px, but the only pair left to measure now spans 103px:
assert.equal(shownGap(gapRow(box(814, 999), box(999, 1299), box(1402, 1442))), 103,
             "a button in the layout poisons the only pair there is - so never measure seated");
// and the g > 0 filter cannot save us: it throws away the honest 0px seam between the two
// clusters first, which is what leaves the poisoned pair unopposed.

// So the guard is the call site: it has to read the gap while the row is still just the row.
// Cheap to check, and the only thing standing between a future edit and the 103px hole.
const injectSrc = grab(/function inject\(loose\)[\s\S]*?\n}/);
assert.ok(injectSrc.indexOf("shownGap(row)") < injectSrc.indexOf("seat.after(btn)"),
          "inject() must measure the row's gap before putting the button in it");

// ---- isRow(): a button row, or a wrapper we must not seat ourselves in?
const node = (tag, { shown = true, kids = [], button = false } = {}) => ({
  tagName: tag, children: kids, parentElement: null,
  getClientRects: () => (shown ? [{}] : []),
  querySelector: () => (button ? {} : null),
});
const pill = () => node("YT-BUTTON-VIEW-MODEL", { button: true });

assert.equal(isRow(node("DIV", { kids: [pill(), pill()] })), true, "like + share is a row");
// the actual bug: #actions-inner wraps one child, #menu, so \"after Share\" means after the menu
assert.equal(isRow(node("DIV", { kids: [node("DIV", { button: true })] })), false,
             "#actions-inner holds one child and is not a row");
assert.equal(isRow(node("DIV", { kids: [pill(), node("DIV", { shown: false, button: true })] })), false,
             "#menu-during-ads is not laid out, so it does not make a row");
assert.equal(isRow(node("DIV", { shown: false, kids: [pill(), pill()] })), false, "a hidden row is not ready");
assert.equal(isRow(node("DIV", { kids: [node("SPAN"), node("SPAN")] })), false, "no buttons, no row");

console.log("ok - the button sits in a real row, at the spacing the row renders");

// ---- tick(): every tick re-checks placement, and a wrap is never a state it comes to rest in.
// Same trick as above - the real tick() is pulled from the source so this cannot drift from it.
const tickSrc = grab(/function tick\(\)[\s\S]*?\n}/);

// Stubs stand in for everything tick() leans on. `measured` counts the calls that force a
// layout, `reseats` the times it pulled the button to try a better seat.
function drive(ticks, { hidden = false, wrap = false } = {}) {
  const c = { measured: 0, reseats: 0 };
  // hasAttribute reports the stand-in flag, so the give-up path has somewhere to settle
  const btn = { isConnected: true, loose: false, hasAttribute() { return this.loose },
                remove() { c.reseats++; this.isConnected = false } };
  const env = {
    document: { hidden, fullscreenElement: null, getElementById: () => btn },
    location: { href: "u", pathname: "/watch" },
    wrapped: () => (c.measured++, wrap),
    findRow: () => (c.measured++, true),
    visible: () => true, metaBlock: () => ({}), place() {}, closePanel() {}, watchRow() {},
    // a fresh button, the way the real one re-seats; `loose` is inject()'s stand-in path
    inject: loose => (btn.loose = !!loose, btn.isConnected = true),
  };
  const tick = new Function(...Object.keys(env), `
    let misses = 0, fixes = 0, panel = null, href = "u";
    const FIXES = ${grab(/const FIXES = \d+/).split("= ")[1]};
    ${tickSrc}
    return tick;
  `)(...Object.values(env));
  for (let i = 0; i < ticks; i++) tick();
  return (c.loose = btn.loose, c);
}

// Placement is re-checked every tick, so a wrap can never be on screen for more than one of
// them. This is the property the calm gate used to trade away for a few ms a second.
assert.equal(drive(60).measured, 60, "every tick must re-check where the button is");
assert.equal(drive(60, { hidden: true }).measured, 0, "a hidden tab must measure nothing");
// A genuinely wrapped button re-seats until FIXES says stop, then spends one more pull dropping
// to the stand-in, which is the only seat that cannot wrap.
assert.equal(drive(60, { wrap: true }).reseats, 4, "a wrapping button must use all its re-seats");
// Settling must never mean settling wrapped - the seat it comes to rest on is the stand-in.
assert.equal(drive(120, { wrap: true }).loose, true, "it must never come to rest under Share");
assert.equal(drive(120).loose, false, "a row that suits us is not traded for the stand-in");
// ...and once there it stops pulling the button around rather than flickering forever.
assert.equal(drive(120, { wrap: true }).reseats, 4, "the stand-in is an end state, not a loop");

console.log("ok - placement re-checked every tick, and never at rest wrapped");

// ---- the UI and the native host each carry their own table of what a container can hold.
// Two tables that must agree and cannot see each other, so check they still do. Verified with
// ffmpeg 7.1.1 and yt-dlp 2026.08.19: chapters survive everywhere except wav and flac, and
// yt-dlp embeds cover art only in mp3, mkv/mka, ogg/opus/flac and m4a/mp4/m4v/mov.
const panelSrc = fs.readFileSync("extension/panel.js", "utf8");
const hostSrc = fs.readFileSync("native_host.py", "utf8");
const jsList = re => JSON.parse(panelSrc.match(re)[1]);
const pySet = re => hostSrc.match(re)[1].split(",").map(t => t.trim().replace(/"/g, "")).filter(Boolean);

const offered = [...panelSrc.matchAll(/formats: (\[[^\]]*\])/g)].flatMap(m => JSON.parse(m[1]));
const noCover = jsList(/YTDLP_NO_COVER = (\[[^\]]*\])/);
const noChapters = jsList(/YTDLP_NO_CHAPTERS = (\[[^\]]*\])/);
const thumbable = pySet(/THUMBABLE = \{([^}]*)\}/);
const hostNoChapters = pySet(/NO_CHAPTERS = \{([^}]*)\}/);

// Ground truth, measured with ffmpeg and read out of yt-dlp's source - not copied from either
// table, so a wrong table fails here instead of agreeing with itself.
const TRUTH = { mp3: { cover: true, chapters: true }, m4a: { cover: true, chapters: true },
                opus: { cover: true, chapters: true }, wav: { cover: false, chapters: false },
                flac: { cover: true, chapters: false }, mp4: { cover: true, chapters: true },
                mkv: { cover: true, chapters: true }, webm: { cover: false, chapters: true } };
assert.deepEqual([...offered].sort(), Object.keys(TRUTH).sort(),
                 "a format was added or dropped - give it a verdict in TRUTH and both tables");
for (const f of offered) {
  assert.equal(!noCover.includes(f), TRUTH[f].cover, `panel: cover art wrong for ${f}`);
  assert.equal(thumbable.includes(f), TRUTH[f].cover, `native host: cover art wrong for ${f}`);
  assert.equal(!noChapters.includes(f), TRUTH[f].chapters, `panel: chapters wrong for ${f}`);
  assert.equal(!hostNoChapters.includes(f), TRUTH[f].chapters, `native host: chapters wrong for ${f}`);
}
console.log(`ok - ${offered.length} formats agree across the panel, the native host and ffmpeg`);
