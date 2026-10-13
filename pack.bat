@echo off
rem Builds the shareable zip straight from the working copy, so what you send is what you run.
rem Deliberately excludes extension-key.pem, host.bat and com.ytdlp.bridge.json: the signing key
rem is private, and the other two hold absolute paths from this machine (install.py writes them).
powershell -NoProfile -Command "Compress-Archive -Path extension,extension-id.txt,install.bat,install.py,native_host.py,README.md,test-wrapped.js -DestinationPath youtube-downloader-share.zip -Force"
echo Wrote youtube-downloader-share.zip
