@echo off
REM Starts only the supporting services (Ollama + MCP + Context Forge gateway).
REM The backend and frontend run separately in their own terminals.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_services.ps1"
echo.
pause
