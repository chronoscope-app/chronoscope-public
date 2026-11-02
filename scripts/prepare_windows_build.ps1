<#
.SYNOPSIS
Prepare installed native Windows build tools and persistent caches; fail early on missing capabilities.
.DESCRIPTION
Process-local environment only. No source edits, cache deletion, builds or publication.
EnableDeveloperMode is an explicit, administrator-only one-time operation using Microsoft's
documented DWORD. It enables no Device Portal, discovery, SSH or antivirus exclusions.
https://learn.microsoft.com/windows/apps/get-started/developer-mode-features-and-debugging
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$BuildHome = (Join-Path $env:USERPROFILE '.chronoscope-build'),
    [string]$TargetDirectory,
    [string]$NodePath,
    [string]$PythonPath,
    [string]$SevenZipPath,
    [string]$Report,
    [ValidateRange(1, 32)][int]$TestThreads = 4,
    [ValidateRange(1, 16)][int]$CargoJobs = 2,
    [switch]$EnableDeveloperMode
)
$ErrorActionPreference = 'Stop'
$started = [DateTime]::UtcNow
$watch = [Diagnostics.Stopwatch]::StartNew()
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$BuildHome = [IO.Path]::GetFullPath($BuildHome)
if (-not $TargetDirectory) { $TargetDirectory = Join-Path $BuildHome 'target\windows-x86_64\rust-1.98.0' }
$TargetDirectory = [IO.Path]::GetFullPath($TargetDirectory)
if (-not $Report) { $Report = Join-Path $BuildHome ('receipts\preparation-' + $started.ToString('yyyyMMddTHHmmssfffZ') + '.json') }
$Report = [IO.Path]::GetFullPath($Report)
foreach ($directory in @($BuildHome, $TargetDirectory, [IO.Path]::GetDirectoryName($Report))) {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$receipt = [ordered]@{ format = 1; platform = 'windows-x86_64'; started_utc = $started.ToString('o');
    ready = $false; source_root = $root; build_home = $BuildHome; target_directory = $TargetDirectory;
    checks = @(); errors = @(); environment = [ordered]@{} }
function Add-Check([string]$Name, [bool]$Passed, $Detail) {
    $receipt.checks += [ordered]@{ name = $Name; passed = $Passed; detail = $Detail }
    Write-Host (('{0}: {1}' -f $Name, $(if ($Passed) { 'PASS' } else { 'FAIL' })))
}
function Find-VersionedTool($Candidates, [string]$Pattern) {
    foreach ($candidate in $Candidates) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        if ($candidate -match '\\WindowsApps\\') { continue } # Do not open a Store execution alias.
        try {
            $version = (& $candidate --version 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $version -match $Pattern) {
                return @{ path = [IO.Path]::GetFullPath($candidate); version = $version }
            }
        } catch { }
    }
    return $null
}
function Command-Path([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}
function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
function Read-DeveloperMode {
    $item = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
    if ($item) {
        $property = $item.PSObject.Properties['AllowDevelopmentWithoutDevLicense']
        if ($property) { return $property.Value }
    }
    return $null
}
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This preparation script requires Windows.' }
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $receipt.administrator = $admin
    $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
    $before = Read-DeveloperMode
    $receipt.developer_mode_before = $before
    if ($EnableDeveloperMode -and $before -ne 1) {
        if (-not $admin) {
            $receipt.errors += 'Developer Mode setup requires an administrator-approved PowerShell session. No elevation or policy bypass was attempted.'
        } elseif ($PSCmdlet.ShouldProcess($key, 'Set only AllowDevelopmentWithoutDevLicense DWORD to 1')) {
            New-Item -Path $key -Force | Out-Null
            New-ItemProperty -LiteralPath $key -Name AllowDevelopmentWithoutDevLicense -PropertyType DWord -Value 1 -Force | Out-Null
        }
    }
    $receipt.developer_mode_after = Read-DeveloperMode
    $workspace = [IO.Path]::GetDirectoryName($root)
    $nodeCandidates = @($NodePath, $env:CHRONOSCOPE_NODE)
    $nodeCandidates += @(Get-ChildItem -Path (Join-Path $workspace '.tools\node-v22.*-win-x64\node.exe') -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object FullName)
    $nodeCandidates += @(Command-Path 'node.exe')
    $node = Find-VersionedTool $nodeCandidates '^v22\.'
    $pythonCandidates = @($PythonPath, $env:CHRONOSCOPE_PYTHON)
    $pythonCandidates += @(Get-ChildItem -Path (Join-Path $env:APPDATA 'uv\python\cpython-3.13.*-windows-x86_64-none\python.exe') -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object FullName)
    $pythonCandidates += @(Command-Path 'python.exe')
    $python = Find-VersionedTool $pythonCandidates '^Python 3\.13\.'
    Add-Check 'node-22' ([bool]$node) $node
    Add-Check 'python-3.13' ([bool]$python) $python
    $npmCli = if ($node) { Join-Path ([IO.Path]::GetDirectoryName($node.path)) 'node_modules\npm\bin\npm-cli.js' } else { $null }
    $npmVersion = if ($npmCli -and (Test-Path -LiteralPath $npmCli)) { (& $node.path $npmCli --version | Out-String).Trim() } else { $null }
    Add-Check 'npm' ([bool]$npmVersion) @{ path = $npmCli; version = $npmVersion }
    $rustup = Command-Path 'rustup.exe'
    if (-not $rustup -and (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe'))) { $rustup = Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe' }
    $rustc = $null; $llvm = $null
    if ($rustup) {
        $rustc = (& $rustup which --toolchain 1.98.0 rustc 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $rustc)) { $rustc = $null }
    }
    if ($rustc) {
        $rustVersion = (& $rustc -Vv | Out-String).Trim()
        Add-Check 'rust-1.98.0' ($rustVersion -match '^rustc 1\.98\.0 ' -and $rustVersion -match 'host: x86_64-pc-windows-msvc') $rustVersion
        $toolchain = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($rustc))
        $llvm = Join-Path $toolchain 'lib\rustlib\x86_64-pc-windows-msvc\bin\llvm-objdump.exe'
        foreach ($component in @('cargo-clippy.exe', 'rustfmt.exe')) {
            Add-Check $component (Test-Path -LiteralPath (Join-Path $toolchain ('bin\' + $component))) $toolchain
        }
    } else { Add-Check 'rust-1.98.0' $false 'Install rustup toolchain 1.98.0 with clippy, rustfmt and llvm-tools-preview.' }
    Add-Check 'llvm-objdump' ([bool]$llvm -and (Test-Path -LiteralPath $llvm)) $llvm
    $zipCandidates = @($SevenZipPath, (Join-Path $workspace '.tools\7zip\7z.exe'), (Join-Path ${env:ProgramFiles} '7-Zip\7z.exe'), (Command-Path '7z.exe'))
    $zip = $zipCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    $zipVersion = if ($zip) { (& $zip i 2>&1 | Select-Object -First 4 | Out-String).Trim() } else { $null }
    Add-Check '7zip' ([bool]$zipVersion) @{ path = $zip; version = $zipVersion }
    $nsis = Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe'
    $nsisVersion = if (Test-Path -LiteralPath $nsis) { (& $nsis /VERSION | Out-String).Trim() } else { $null }
    Add-Check 'nsis' ([bool]$nsisVersion) @{ path = $nsis; version = $nsisVersion }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $linker = if (Test-Path -LiteralPath $vswhere) { (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe' | Select-Object -First 1) } else { $null }
    Add-Check 'msvc-x64-linker' ([bool]$linker) $linker
    $sdk = @(Get-ChildItem -Path (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Include\*\um\Windows.h') -ErrorAction SilentlyContinue | ForEach-Object FullName)
    Add-Check 'windows-sdk' ($sdk.Count -gt 0) $sdk
    $webview = @(foreach ($registry in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients', 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients', 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients')) {
        Get-ChildItem -LiteralPath $registry -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.name -match 'WebView2' -and $_.pv -and $_.pv -ne '0.0.0.0' } | Select-Object name, pv
    })
    Add-Check 'webview2-runtime' ($webview.Count -gt 0) $webview
    $env:RUSTUP_TOOLCHAIN = '1.98.0'
    $env:CARGO_INCREMENTAL = '0'
    $env:CARGO_BUILD_JOBS = "$CargoJobs"
    $env:RUST_TEST_THREADS = "$TestThreads"
    $env:CARGO_TARGET_DIR = $TargetDirectory
    $env:CHRONOSCOPE_BUILD_HOME = $BuildHome
    if (-not $env:CARGO_HOME) { $env:CARGO_HOME = Join-Path $env:USERPROFILE '.cargo' }
    if (-not $env:npm_config_cache) { $env:npm_config_cache = Join-Path $env:LOCALAPPDATA 'npm-cache' }
    $paths = @()
    if ($python) { $env:CHRONOSCOPE_PYTHON = $python.path; $paths += [IO.Path]::GetDirectoryName($python.path) }
    if ($node) { $env:CHRONOSCOPE_NODE = $node.path; $paths += [IO.Path]::GetDirectoryName($node.path) }
    if ($rustup) { $paths += [IO.Path]::GetDirectoryName($rustup) }
    if ($llvm) { $paths += [IO.Path]::GetDirectoryName($llvm) }
    if ($zip) { $paths += [IO.Path]::GetDirectoryName($zip) }
    $env:PATH = (@($paths) + @($env:PATH -split ';') | Where-Object { $_ } | Select-Object -Unique) -join ';'
    foreach ($name in @('RUSTUP_TOOLCHAIN', 'CARGO_INCREMENTAL', 'CARGO_BUILD_JOBS', 'RUST_TEST_THREADS', 'CARGO_TARGET_DIR', 'CARGO_HOME', 'npm_config_cache', 'CHRONOSCOPE_BUILD_HOME', 'CHRONOSCOPE_PYTHON', 'CHRONOSCOPE_NODE', 'PATH')) {
        $receipt.environment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $environmentFile = Join-Path $BuildHome 'environment.ps1'
    $lines = @('# Generated process-local build environment; does not alter user or machine PATH.')
    foreach ($name in $receipt.environment.Keys) { $lines += ('$env:' + $name + ' = ' + (Quote-Literal $receipt.environment[$name])) }
    [IO.File]::WriteAllLines($environmentFile, $lines, [Text.UTF8Encoding]::new($false))
    $receipt.environment_file = $environmentFile
    $system = Get-CimInstance Win32_OperatingSystem
    $receipt.memory = @{ total_bytes = [long]$system.TotalVisibleMemorySize * 1024; available_bytes = [long]$system.FreePhysicalMemory * 1024 }
    if ($python) {
        $probeText = (& $python.path -B (Join-Path $PSScriptRoot 'windows_build_probe.py') --root $root --scratch (Join-Path $BuildHome 'probes') | Out-String).Trim()
        $probe = $probeText | ConvertFrom-Json
        Add-Check 'real-symlink-and-release-profile-probe' ([bool]$probe.ready) $probe
    }
    $receipt.ready = @($receipt.checks | Where-Object { -not $_.passed }).Count -eq 0 -and $receipt.errors.Count -eq 0
} catch { $receipt.errors += $_.Exception.Message }
$receipt.finished_utc = [DateTime]::UtcNow.ToString('o')
$receipt.elapsed_seconds = $watch.Elapsed.TotalSeconds
$receipt.receipt = $Report
[IO.File]::WriteAllText($Report, ($receipt | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Host ('Receipt: ' + $Report)
if (-not $receipt.ready) { throw ('Windows build preparation is BLOCKED. Inspect ' + $Report) }
Write-Host ('Windows build environment READY. Reuse with: . ' + (Quote-Literal (Join-Path $BuildHome 'environment.ps1')))
