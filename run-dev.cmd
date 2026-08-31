@echo off
rem Launch wrapper for the Vite dev server. Referenced by .claude/launch.json
rem in the Claude Code working directory (avoids space-in-path issues with npm).
cd /d "%~dp0"
call npm run dev
