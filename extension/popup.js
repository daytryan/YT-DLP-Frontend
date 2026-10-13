// The popup runs outside YouTube, so it cannot read the page's theme: content.js saves the
// last one it painted. Before any YouTube visit, follow the OS instead - which is what
// YouTube's own default ("device theme") would have done anyway.

// no button sheet here: that one styles the in-page toolbar button, which the popup has no
// business drawing. buildPanel brings the panel's own.
const panel = buildPanel(async () =>
  (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url);
document.body.appendChild(panel);

const apply = theme => {
  const dark = ytdlpPaint(panel, theme);
  document.body.style.background = dark ? "#181818" : "#f9f9f9";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};

// paint from the OS synchronously, so the popup never flashes the wrong colour while the
// stored theme is still being read
apply({ dark: !matchMedia("(prefers-color-scheme: light)").matches });
chrome.storage.local.get("theme", ({ theme }) => theme && apply(theme));
