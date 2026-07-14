# Balsa Construction Ops — startup logic.
# Starts the server in the background only if it isn't already running
# (so double-clicking the launcher a second time doesn't try to start a
# second copy and fail), waits for it to come up, then opens it in a
# clean app-style window with no address bar or browser tabs.

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$isRunning = Test-NetConnection -ComputerName localhost -Port 3000 -WarningAction SilentlyContinue -InformationLevel Quiet

if (-not $isRunning) {
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $appDir -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

Start-Process "msedge" -ArgumentList "--app=http://localhost:3000"
