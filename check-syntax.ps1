$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot "build-portable.ps1"),
    [ref]$null,
    [ref]$errors
)
if ($errors.Count -eq 0) {
    Write-Host "No syntax errors found." -ForegroundColor Green
} else {
    $errors | ForEach-Object {
        Write-Host ("Line {0}: {1}" -f $_.Extent.StartLineNumber, $_.Message) -ForegroundColor Red
    }
}
