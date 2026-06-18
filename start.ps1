# FirstTouch launcher — guarantees Ollama (IBM Granite) is running, then brings
# up the backend and frontend. Just run:  ./start.ps1   from the project root.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Ollama
function Test-Ollama {
  try { Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -TimeoutSec 2 -UseBasicParsing | Out-Null; return $true }
  catch { return $false }
}

if (Test-Ollama) {
  Write-Host '[ollama] already running' -ForegroundColor Green
} else {
  Write-Host '[ollama] not running - starting it...' -ForegroundColor Yellow
  $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
  if (-not (Test-Path $ollama)) { $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source }
  if (-not $ollama) { Write-Host '[ollama] ollama.exe not found - install from https://ollama.com' -ForegroundColor Red; exit 1 }

  # keep both Granite models resident and allow assess + prose to run together;
  # the serve process inherits these from this shell
  $env:OLLAMA_KEEP_ALIVE = '30m'
  $env:OLLAMA_NUM_PARALLEL = '2'
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden

  $up = $false
  for ($i = 0; $i -lt 30; $i++) { if (Test-Ollama) { $up = $true; break }; Start-Sleep -Milliseconds 700 }
  if ($up) { Write-Host '[ollama] up on 127.0.0.1:11434' -ForegroundColor Green }
  else { Write-Host '[ollama] failed to start in time - check manually' -ForegroundColor Red; exit 1 }
}

# warm granite3.3:8b so the first assessment is fast (non-blocking)
Start-Process -FilePath 'powershell' -WindowStyle Hidden -ArgumentList @(
  '-NoProfile','-Command',
  "try { Invoke-WebRequest -Uri http://localhost:11434/api/generate -Method Post -TimeoutSec 120 -UseBasicParsing -Body '{""model"":""granite3.3:8b"",""prompt"":""hi"",""stream"":false}' | Out-Null } catch {}"
) | Out-Null

# 2. IBM Context Forge stack (MCP server + gateway)
# The What-If feature reasons through a LangChain chain that calls the xT engine
# as an MCP tool federated by the IBM Context Forge gateway. If the gateway venv
# is missing, we skip this and the backend falls back to the in-process engine.
function Test-Port($p) {
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$p/health" -TimeoutSec 2 -UseBasicParsing | Out-Null; return $true } catch { return $false }
}
$cfVenv = "$root\.cf-venv\Scripts\python.exe"
$cfServer = "$root\.cf-venv\Scripts\mcpgateway-server.exe"
if (Test-Path $cfVenv) {
  $secret = 'firsttouch_dev_jwt_secret_key_0123456789abcdef'
  $encSecret = 'firsttouch_dev_encryption_secret_0123456789abc'

  # 2a. MCP server (conda python) on :9000 — exposes the real xT engine as tools
  $mcpUp = $false
  try { $t = New-Object Net.Sockets.TcpClient; $t.Connect('127.0.0.1', 9000); $mcpUp = $t.Connected; $t.Close() } catch {}
  if ($mcpUp) {
    Write-Host '[mcp] MCP server already running on :9000' -ForegroundColor Green
  } else {
    Write-Host '[mcp] launching FirstTouch MCP server on :9000' -ForegroundColor Cyan
    Start-Process -FilePath 'powershell' -WindowStyle Minimized -ArgumentList @(
      '-NoProfile','-Command',
      "`$env:PYTHONUTF8='1'; cd '$root\backend'; python mcp_server.py"
    ) | Out-Null
  }

  # 2b. Context Forge gateway (its own venv) on :4444
  if (Test-Port 4444) {
    Write-Host '[contextforge] gateway already running' -ForegroundColor Green
  } else {
    Write-Host '[contextforge] launching gateway on :4444' -ForegroundColor Cyan
    $cfEnv = "`$env:PYTHONUTF8='1';`$env:PYTHONIOENCODING='utf-8';`$env:HOST='127.0.0.1';`$env:PORT='4444';`$env:JWT_SECRET_KEY='$secret';`$env:AUTH_ENCRYPTION_SECRET='$encSecret';`$env:BASIC_AUTH_USER='admin';`$env:BASIC_AUTH_PASSWORD='Firsttouch!2022dev';`$env:AUTH_REQUIRED='false';`$env:MCP_REQUIRE_AUTH='false';`$env:CACHE_TYPE='memory';`$env:REDIS_ENABLED='false';`$env:RATE_LIMIT_ENABLED='false';`$env:DATABASE_URL='sqlite:///./cf_gateway.db';`$env:FEDERATION_ENABLED='true';`$env:SSRF_ALLOW_LOCALHOST='true'"
    Start-Process -FilePath 'powershell' -WindowStyle Minimized -ArgumentList @(
      '-NoProfile','-Command', "$cfEnv; cd '$root\backend'; & '$cfServer'"
    ) | Out-Null
  }

  # 2c. Bootstrap: wait for gateway, mint token, federate the MCP server
  Write-Host '[contextforge] federating MCP server + minting token' -ForegroundColor Cyan
  Start-Process -FilePath 'powershell' -WindowStyle Minimized -ArgumentList @(
    '-NoProfile','-Command',
    "`$env:PYTHONUTF8='1';`$env:JWT_SECRET_KEY='$secret';`$env:CF_GATEWAY='http://127.0.0.1:4444';`$env:FT_MCP_URL='http://127.0.0.1:9000/mcp'; cd '$root\backend'; & '$cfVenv' cf_bootstrap.py; Start-Sleep 4"
  ) | Out-Null
} else {
  Write-Host '[contextforge] .cf-venv not found - skipping; What-If uses in-process engine' -ForegroundColor Yellow
}

# 3. Backend
Write-Host '[backend] launching uvicorn on :8000' -ForegroundColor Cyan
Start-Process -FilePath 'powershell' -ArgumentList @(
  '-NoExit','-Command',
  "cd '$root\backend'; python -m uvicorn main:app --port 8000 --reload"
) | Out-Null

# 4. Frontend
Write-Host '[frontend] launching vite on :5173' -ForegroundColor Cyan
Start-Process -FilePath 'powershell' -ArgumentList @(
  '-NoExit','-Command',
  "cd '$root\frontend'; npm run dev"
) | Out-Null

Write-Host ''
Write-Host 'FirstTouch is starting:' -ForegroundColor Green
Write-Host '  Ollama       http://localhost:11434'
if (Test-Path $cfVenv) {
  Write-Host '  MCP server   http://localhost:9000  (xT engine as MCP tools)'
  Write-Host '  Context Forge http://localhost:4444  (MCP gateway, federates the above)'
}
Write-Host '  Backend      http://localhost:8000  (health: /health)'
Write-Host '  Frontend     http://localhost:5173  (or http://[::1]:5173)'
