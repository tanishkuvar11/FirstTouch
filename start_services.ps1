# FirstTouch SERVICES launcher — starts only the supporting cast that the three
# IBM technologies need (Ollama for Granite, plus the MCP server + Context Forge
# gateway + bootstrap that the What-If LangChain chain calls through). It does NOT
# start the backend or frontend; those run separately in their own terminals:
#   cd backend  ; python -m uvicorn main:app --port 8000 --reload
#   cd frontend ; npm run dev
# Idempotent: anything already running is left alone. Run:  ./start_services.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Ollama (IBM Granite)
function Test-Ollama {
  # 127.0.0.1 (not 'localhost') so we never wait on an IPv6 ::1 resolution that Ollama
  # is not listening on.
  try { Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -UseBasicParsing | Out-Null; return $true }
  catch { return $false }
}
if (Test-Ollama) {
  Write-Host '[ollama] already running' -ForegroundColor Green
} else {
  Write-Host '[ollama] not running - starting it (first boot can take a while)...' -ForegroundColor Yellow
  $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
  if (-not (Test-Path $ollama)) { $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source }
  if (-not $ollama) { Write-Host '[ollama] ollama.exe not found - install from https://ollama.com' -ForegroundColor Red }
  else {
    $env:OLLAMA_KEEP_ALIVE = '30m'
    $env:OLLAMA_NUM_PARALLEL = '2'
    Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden
    $up = $false
    # ~60s: Ollama's first launch (loading runners) can be slow; the old 21s gave up too early.
    for ($i = 0; $i -lt 60; $i++) { if (Test-Ollama) { $up = $true; break }; Start-Sleep -Seconds 1 }
    if ($up) { Write-Host '[ollama] up on 127.0.0.1:11434' -ForegroundColor Green }
    # Do NOT abort the whole launcher if Ollama is slow: Context Forge / What-If does not
    # need it (only Granite prose does, and that has its own fallback). Warn and continue.
    else { Write-Host '[ollama] not up yet - continuing anyway (Granite prose may lag on first use)' -ForegroundColor Yellow }
  }
}

# warm granite3.3:8b so the first assessment is fast (non-blocking)
Start-Process -FilePath 'powershell' -WindowStyle Hidden -ArgumentList @(
  '-NoProfile','-Command',
  "try { Invoke-WebRequest -Uri http://localhost:11434/api/generate -Method Post -TimeoutSec 120 -UseBasicParsing -Body '{""model"":""granite3.3:8b"",""prompt"":""hi"",""stream"":false}' | Out-Null } catch {}"
) | Out-Null

# 2. IBM Context Forge stack (MCP server + gateway + bootstrap)
function Test-Port($p) {
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$p/health" -TimeoutSec 2 -UseBasicParsing | Out-Null; return $true } catch { return $false }
}
# Kill whatever is listening on a port. A STALE server from a previous run squatting
# 9000/4444 is THE reason a relaunch silently fails ("only one usage of each socket
# address"), so we always clear the port before launching for a guaranteed clean start.
function Clear-Port($p) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      Write-Host "  [clear] freeing port $p (stopping PID $($c.OwningProcess) $($proc.ProcessName))" -ForegroundColor DarkYellow
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  Start-Sleep -Milliseconds 400
}
$cfVenv = "$root\.cf-venv\Scripts\python.exe"
$cfServer = "$root\.cf-venv\Scripts\mcpgateway-server.exe"
if (Test-Path $cfVenv) {
  $secret = 'firsttouch_dev_jwt_secret_key_0123456789abcdef'
  $encSecret = 'firsttouch_dev_encryption_secret_0123456789abc'

  # 2a. MCP server (conda python) on :9000 — the real xT engine as MCP tools
  Clear-Port 9000
  Write-Host '[mcp] launching FirstTouch MCP server on :9000' -ForegroundColor Cyan
  # -NoExit keeps the window open if the server crashes, so the error is VISIBLE.
  Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoProfile','-NoExit','-Command',
    "`$host.UI.RawUI.WindowTitle='FirstTouch MCP :9000'; `$env:PYTHONUTF8='1'; cd '$root\backend'; python mcp_server.py; Write-Host '[mcp] server exited - read the error above (bad import?)' -ForegroundColor Red"
  ) | Out-Null

  # 2b. Context Forge gateway (its own venv) on :4444
  Clear-Port 4444
  Write-Host '[contextforge] launching gateway on :4444' -ForegroundColor Cyan
  $cfEnv = "`$env:PYTHONUTF8='1';`$env:PYTHONIOENCODING='utf-8';`$env:HOST='127.0.0.1';`$env:PORT='4444';`$env:JWT_SECRET_KEY='$secret';`$env:AUTH_ENCRYPTION_SECRET='$encSecret';`$env:BASIC_AUTH_USER='admin';`$env:BASIC_AUTH_PASSWORD='Firsttouch!2022dev';`$env:AUTH_REQUIRED='false';`$env:MCP_REQUIRE_AUTH='false';`$env:CACHE_TYPE='memory';`$env:REDIS_ENABLED='false';`$env:RATE_LIMIT_ENABLED='false';`$env:DATABASE_URL='sqlite:///./cf_gateway.db';`$env:FEDERATION_ENABLED='true';`$env:SSRF_ALLOW_LOCALHOST='true'"
  Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoProfile','-NoExit','-Command', "`$host.UI.RawUI.WindowTitle='FirstTouch Gateway :4444'; $cfEnv; cd '$root\backend'; & '$cfServer'; Write-Host '[gateway] exited - read the error above' -ForegroundColor Red"
  ) | Out-Null

  # 2c. Wait for the gateway to actually answer, THEN bootstrap (federate + token).
  Write-Host '[contextforge] waiting for gateway to be ready...' -ForegroundColor Cyan
  $gwReady = $false
  for ($i = 0; $i -lt 30; $i++) { if (Test-Port 4444) { $gwReady = $true; break }; Start-Sleep -Milliseconds 800 }
  if ($gwReady) {
    Write-Host '[contextforge] federating MCP server + minting token' -ForegroundColor Cyan
    # run bootstrap INLINE (not a separate window) so this script waits for it to finish
    # and the token is guaranteed written before the verify step below runs.
    $env:PYTHONUTF8 = '1'; $env:JWT_SECRET_KEY = $secret
    $env:CF_GATEWAY = 'http://127.0.0.1:4444'; $env:FT_MCP_URL = 'http://127.0.0.1:9000/mcp'
    Push-Location "$root\backend"
    & $cfVenv cf_bootstrap.py
    Pop-Location
  } else {
    Write-Host '[contextforge] gateway did not come up in time - check the Gateway window' -ForegroundColor Red
  }
} else {
  Write-Host '[contextforge] .cf-venv not found - skipping; What-If uses in-process engine' -ForegroundColor Yellow
}

# 3. Verify the Context Forge stack actually came up
# Turns silent failure into a clear PASS/FAIL. A common failure is a STALE process
# still holding 9000/4444 from a previous run, so the new server cannot bind and
# dies; a DOWN result below reflects that, with the cause shown in the MCP/Gateway
# windows. Clear-Port above frees those ports on each launch to avoid it.
if (Test-Path $cfVenv) {
  Write-Host ''
  Write-Host '[verify] waiting for the Context Forge stack to come up...' -ForegroundColor Cyan
  $okMcp = $false; $okGw = $false
  for ($i = 0; $i -lt 25; $i++) {
    if (-not $okMcp) { try { $t = New-Object Net.Sockets.TcpClient; $t.Connect('127.0.0.1', 9000); $okMcp = $t.Connected; $t.Close() } catch {} }
    if (-not $okGw)  { $okGw = Test-Port 4444 }
    if ($okMcp -and $okGw) { break }
    Start-Sleep -Milliseconds 800
  }
  Start-Sleep -Seconds 3   # give the bootstrap window a moment to write the token
  $tok = Test-Path "$root\backend\.cf_token"
  Write-Host ('  MCP server   :9000   ' + $(if ($okMcp) { 'UP' } else { 'DOWN' })) -ForegroundColor $(if ($okMcp) { 'Green' } else { 'Red' })
  Write-Host ('  Gateway      :4444   ' + $(if ($okGw)  { 'UP' } else { 'DOWN' })) -ForegroundColor $(if ($okGw)  { 'Green' } else { 'Red' })
  Write-Host ('  Token .cf_token      ' + $(if ($tok)  { 'present' } else { 'MISSING' })) -ForegroundColor $(if ($tok) { 'Green' } else { 'Red' })
  if ($okMcp -and $okGw -and $tok) {
    Write-Host '[verify] Context Forge stack is READY - What-If will use the real gateway path.' -ForegroundColor Green
  } else {
    Write-Host '[verify] Context Forge NOT fully up. Check the MCP/Gateway windows for an error' -ForegroundColor Yellow
    Write-Host '         (usually "port already in use" from a stale process - see the note in this script).' -ForegroundColor Yellow
    Write-Host '         What-If still works via the in-process fallback until this is fixed.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Supporting services:' -ForegroundColor Green
Write-Host '  Ollama        http://localhost:11434   (IBM Granite)'
Write-Host '  MCP server    http://localhost:9000    (xT engine as MCP tools)'
Write-Host '  Context Forge http://localhost:4444    (MCP gateway -> What-If LangChain chain)'
Write-Host ''
Write-Host 'Start the app in two terminals:' -ForegroundColor Cyan
Write-Host '  cd backend  ; python -m uvicorn main:app --port 8000 --reload'
Write-Host '  cd frontend ; npm run dev'
