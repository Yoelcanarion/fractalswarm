# Records the $0 reference runs (fake LLM, sim clock) of the default paths into OUT\<Label>.
# Runs and the ledger go to that dir, never to the shared runs dir or the real ledger.
# Use it before and after a change, then diff with scripts/refs/compare_refs.py:
#   powershell -NoProfile -File scripts/refs/record_refs.ps1 -Out C:\scratch\ref -Label before
#   ... change, merge or check out ...
#   powershell -NoProfile -File scripts/refs/record_refs.ps1 -Out C:\scratch\ref -Label after
#   uv run python scripts/refs/compare_refs.py C:\scratch\ref\before C:\scratch\ref\after
# -NoBench skips the 32-cell fake matrix (about 2 minutes).
param(
    [Parameter(Mandatory)][string]$Out,
    [Parameter(Mandatory)][string]$Label,
    [switch]$NoBench
)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dir = Join-Path $Out $Label
New-Item -ItemType Directory -Force $dir | Out-Null
$env:FRACTALSWARM_RUNS_DIR = Join-Path $dir 'runs'
$env:FRACTALSWARM_LEDGER_PATH = Join-Path $dir 'ledger.sqlite'
Set-Location $repo
$log = Join-Path $dir 'log.txt'
"label=$Label head=$(git rev-parse --short HEAD) start=$(Get-Date -Format s)" | Out-File $log -Encoding utf8

$t2 = 'tasks/examples/t2-conference.yaml'
$runs = @(
    @('t2-swarm-C0', $t2, 'swarm', 'C0'),
    @('t2-swarm-killhalf', $t2, 'swarm', 'kill-half'),
    @('t2-swarm-C3', $t2, 'swarm', 'C3'),
    @('t2-central-C0', $t2, 'central', 'C0'),
    @('t2-central-killhalf', $t2, 'central', 'kill-half'),
    @('t2-central-C3', $t2, 'central', 'C3'),
    @('t2-single-killhalf', $t2, 'single', 'kill-half'),
    @('t2-pipeline-killhalf', $t2, 'pipeline', 'kill-half'),
    @('t2-attack-C0', 'tasks/examples/t2-attack.yaml', 'swarm', 'C0'),
    @('t1-swarm-C0', 'tasks/examples/t1-extraction.yaml', 'swarm', 'C0'),
    @('t3-swarm-C0', 'tasks/examples/t3-web-report.yaml', 'swarm', 'C0')
)
foreach ($r in $runs) {
    $t = Get-Date
    $result = uv run --no-sync fractalswarm run $r[1] --scenario $r[2] --chaos $r[3] --run-id $r[0] 2>&1 | Select-Object -Last 1
    "{0,-22} exit={1} {2,5:N0}s  {3}" -f $r[0], $LASTEXITCODE, ((Get-Date) - $t).TotalSeconds, (($result | Out-String).Trim()) | Out-File $log -Append -Encoding utf8
}
if (-not $NoBench) {
    $t = Get-Date
    uv run --no-sync fractalswarm bench bench/matrix.yaml --fake --out (Join-Path $dir 'bench') 2>&1 | Out-Null
    "bench exit={0} {1,5:N0}s" -f $LASTEXITCODE, ((Get-Date) - $t).TotalSeconds | Out-File $log -Append -Encoding utf8
}
"done=$(Get-Date -Format s)" | Out-File $log -Append -Encoding utf8
Get-Content $log
