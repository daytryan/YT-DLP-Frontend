"""Register the native host with Chrome so it starts on demand. Run: install.bat"""
import json, shutil, subprocess, sys, winreg
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = "com.ytdlp.bridge"
BROWSERS = {"Chrome": r"Software\Google\Chrome", "Edge": r"Software\Microsoft\Edge",
            "Chromium": r"Software\Chromium", "Brave": r"Software\BraveSoftware\Brave-Browser"}

# YouTube breaks yt-dlp's extractors every few weeks, so always pull the newest one rather than
# only installing when it is missing. Re-running install.bat is the fix for "it stopped working".
print("installing/updating yt-dlp...")
if subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "yt-dlp", "mutagen"]).returncode:
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        sys.exit("could not install yt-dlp - check your internet connection and retry")
    print("  update failed (offline?) - keeping the version already installed")

bat = HERE / "host.bat"
bat.write_text(f'@echo off\r\n"{sys.executable}" -u "{HERE / "native_host.py"}"\r\n')

manifest = HERE / f"{NAME}.json"
manifest.write_text(json.dumps({
    "name": NAME, "description": "yt-dlp bridge", "path": str(bat), "type": "stdio",
    "allowed_origins": [f"chrome-extension://{(HERE / 'extension-id.txt').read_text().strip()}/"],
}, indent=2))

found = []
for label, base in BROWSERS.items():
    try:
        winreg.OpenKey(winreg.HKEY_CURRENT_USER, base).Close()  # skip browsers that aren't here
    except FileNotFoundError:
        continue
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"{base}\NativeMessagingHosts\{NAME}") as k:
        winreg.SetValue(k, "", winreg.REG_SZ, str(manifest))
    found.append(label)

print(f"registered for: {', '.join(found) or 'nothing found - is Chrome installed?'}")
print(f"host: {bat}\n\nNow load '{HERE / 'extension'}' at chrome://extensions (Developer mode ->")
print("Load unpacked). Remove any older copy first - the extension ID changed.")

# yt-dlp shells out to ffmpeg for every merge and every audio format. Without it the extension
# installs fine and then fails on the first download, which reads like a bug in the extension.
if not shutil.which("ffmpeg"):
    print("\nWARNING: ffmpeg is not on your PATH. Video merging and every audio format need it.")
    print("  Install it with:  winget install Gyan.FFmpeg   (then reopen your terminal)")
