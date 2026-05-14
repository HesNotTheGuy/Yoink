#Requires -Version 5.1
<#
.SYNOPSIS
  Removes the Yoink for Premiere CEP panel.

.DESCRIPTION
  Deletes %APPDATA%\Adobe\CEP\extensions\com.yoink.premiere\.
  Leaves PlayerDebugMode registry keys and %APPDATA%\Yoink\ data alone
  (they may be used by other Adobe extensions / the Yoink desktop app).

  Restart Premiere after running.
#>

$ErrorActionPreference = 'Stop'

$extDest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.yoink.premiere'

if (Test-Path $extDest) {
    Remove-Item -Path $extDest -Recurse -Force
    Write-Host "Removed $extDest" -ForegroundColor Green
} else {
    Write-Host "Not installed at $extDest - nothing to remove." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "Restart Premiere to take effect." -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: PlayerDebugMode registry keys and %APPDATA%\Yoink\ data folder were left intact." -ForegroundColor DarkGray
