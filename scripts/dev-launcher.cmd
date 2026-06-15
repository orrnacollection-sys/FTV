@echo off
REM Wrapper for Claude Preview — ensures Node is on PATH, then runs Next.js directly
REM (bypasses pnpm's deps-status check which trips on ignored build scripts).
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\AppData\Roaming\npm;%PATH%"
npx --no-install next dev
