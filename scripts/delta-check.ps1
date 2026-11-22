# StoreKeeper delta check. Run it yourself in the project root (PowerShell): .\scripts\delta-check.ps1
# Options: -SkipTests (builds and file checks only), -TestCommand "npm test"
param([switch]$SkipTests, [string]$TestCommand = "npm test")
$ErrorActionPreference = "Continue"
$results = @()
$sw = [System.Diagnostics.Stopwatch]::StartNew()
function Say($m) { Write-Host ("[" + $sw.Elapsed.ToString("mm\:ss") + "] " + $m) -ForegroundColor Cyan }
function Add-Result($name, $ok, $detail) {
  $script:results += [pscustomobject]@{ Check = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail }
}

Say "Checking wiring and git"
# 1. Wiring: committed copy must equal the handoff copy
$a = "docs\handoff\journey-wiring.json"; $b = "src\pos\wiring.json"
if ((Test-Path $a) -and (Test-Path $b)) {
  # Hash the text with line endings normalised: git on Windows may turn LF into CRLF in the working copy.
  function Get-TextHash($path) {
    $t = [System.IO.File]::ReadAllText((Resolve-Path $path)) -replace "`r`n", "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($t))) -replace "-", "")
  }
  $ha = Get-TextHash $a; $hb = Get-TextHash $b
  Add-Result "Wiring hash" ($ha -eq $hb) ("handoff " + $ha.Substring(0,8) + " / src " + $hb.Substring(0,8) + " (line endings ignored)")
  try { Get-Content $b -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null; Add-Result "Wiring is valid JSON" $true "" } catch { Add-Result "Wiring is valid JSON" $false $_.Exception.Message }
} else { Add-Result "Wiring hash" $false "a wiring file is missing" }

# 2. Nothing from the handoff folders is tracked
$tracked = git ls-files docs/handoff agent-handoff 2>$null
Add-Result "No handoff files tracked" ([string]::IsNullOrWhiteSpace(($tracked -join ""))) (($tracked | Select-Object -First 3) -join ", ")

# 3. Clean tree
$dirty = git status --porcelain 2>$null
Add-Result "Working tree clean" ([string]::IsNullOrWhiteSpace(($dirty -join ""))) (($dirty | Select-Object -First 3) -join "; ")

# 4. Builds (to a temp folder so dist is not touched)
function Run-Build($label, $envMap) {
  Say ("Running " + $label + " (a few minutes, no output until done)")
  $out = Join-Path $env:TEMP ("sk-build-" + [guid]::NewGuid().ToString("N").Substring(0,8))
  $saved = @{}
  foreach ($k in $envMap.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envMap[$k]) }
  $log = npx vite build --outDir $out --emptyOutDir 2>&1
  $ok = ($LASTEXITCODE -eq 0)
  foreach ($k in $envMap.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
  Add-Result $label $ok $(if ($ok) { "" } else { ($log | Select-Object -Last 5) -join " | " })
}
Run-Build "Build (default)" @{}
$flags = git grep -h -o -E "VITE_ENABLE_[A-Z0-9_]+" -- src 2>$null | Sort-Object -Unique
$off = @{}; foreach ($f in $flags) { $off[$f] = "false" }
Run-Build ("Build (all " + $flags.Count + " VITE_ENABLE_* false)") $off

# 5. Full test suite: output goes to a log, only the summary is printed
if (-not $SkipTests) {
  $log = Join-Path $env:TEMP "sk-tests.log"
  Say "Running the full test suite. This is the long one. Watch it with: Get-Content $log -Wait -Tail 5"
  Invoke-Expression "$TestCommand *> `"$log`""
  $code = $LASTEXITCODE
  $tail = Get-Content $log -Tail 12
  $sum = ($tail | Select-String -Pattern "(pass|fail|tests)" | Select-Object -Last 4) -join " | "
  Add-Result "Full test suite" ($code -eq 0) ($sum + "  (log: $log)")
}

Say "Done"
$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object { $_.Result -eq "FAIL" })
if ($failed.Count -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green } else { Write-Host ("" + $failed.Count + " CHECK(S) FAILED") -ForegroundColor Red }
Write-Host "Not covered here: receipts compile only when VITE_ENABLE_POS_RECEIPTS is exactly 'true' (its own test), and the real-browser widths (see the width screenshots script, if you use it)."