# Installe le robot local de l'item 101 : une tâche planifiée Windows qui lance
# scripts/snapshot-city-feed.js chaque jour à 12 h 30 (le script ne travaille que tous les
# 15 jours, et rattrape un jour manqué dès que le PC est allumé). À lancer une seule fois :
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-city-robot.ps1
#
# Pour l'enlever :  Unregister-ScheduledTask -TaskName 'FontainebleauLive - Agenda Ville'
# Journal du robot : %LOCALAPPDATA%\FontainebleauLive\robot.log

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$name = 'FontainebleauLive - Agenda Ville'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\scripts\snapshot-city-feed.js`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 12:30
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force `
  -Description "Item 101 : copie du flux RSS de la Ville de Fontainebleau tous les 15 jours, poussée sur GitHub." | Out-Null
Write-Host "Tâche '$name' installée (tous les jours à 12 h 30, avec $node)."

# Première copie tout de suite, pour vérifier que la lecture et le push marchent.
Write-Host "Première copie..."
& $node "$repo\scripts\snapshot-city-feed.js" --force
if ($LASTEXITCODE -eq 0) { Write-Host "OK : copie poussée sur GitHub." }
else { Write-Host "Échec : voir $env:LOCALAPPDATA\FontainebleauLive\robot.log" }
