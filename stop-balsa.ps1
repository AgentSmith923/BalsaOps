# Balsa Construction Ops — shutdown logic.
# Finds and stops only the specific Node process running this app's
# server.js (not any other Node process that might happen to be running
# on this computer), so this is safe to use even on a machine that runs
# other Node-based tools too.

$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*server.js*' }

if ($procs) {
    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Host "Balsa Construction Ops has been stopped."
} else {
    Write-Host "Balsa Construction Ops wasn't running."
}

Start-Sleep -Seconds 2
