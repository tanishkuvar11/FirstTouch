@echo off
REM Double-click this (or run "start.bat") to launch FirstTouch.
REM It starts Ollama if needed, then the backend and frontend.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
