<#
.SYNOPSIS
    Extract only the chat JSON files from large Google Takeout archives.

.DESCRIPTION
    A Google Chat Takeout export bundles every image and video shared in the
    conversations, so it can run to tens of gigabytes. The message text lives
    only in messages.json and is usually a few megabytes.

    This script reads each archive's index without unpacking it, so even a
    30 GB export is scanned quickly.

    Requires nothing beyond the PowerShell that ships with Windows.

    NOTE: this file is deliberately pure ASCII. Windows PowerShell 5.1 reads
    .ps1 files as the system ANSI codepage unless they carry a UTF-8 BOM, so
    non-ASCII characters in the source would be mangled into parse errors.

.EXAMPLE
    .\ExtractChatJson.ps1 -Path . -List

.EXAMPLE
    .\ExtractChatJson.ps1 -Path . -Group "some group name"
#>

[CmdletBinding()]
param(
    # Folder holding the Takeout zips, or a single zip file
    [Parameter(Mandatory = $true)]
    [string]$Path,

    # Part of the group name to extract
    [string]$Group = "",

    # Only list the groups; extract nothing
    [switch]$List,

    # Show every archive entry belonging to the matched group, with sizes and
    # which archive each one came from. Use this to check whether a group's
    # messages were split across several Takeout parts.
    [switch]$Inspect,

    # Where to write the result; defaults to <source folder>\chat-json
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Add-Type -AssemblyName System.IO.Compression.FileSystem

# --- Locate the archives ------------------------------------------------
if (-not (Test-Path $Path)) {
    Write-Host "Path not found: $Path" -ForegroundColor Red
    exit 1
}

$item = Get-Item $Path
if ($item.PSIsContainer) {
    $zips = @(Get-ChildItem -Path $Path -Filter *.zip -File | Sort-Object Name)
    $baseDir = $item.FullName
} else {
    $zips = @($item)
    $baseDir = $item.DirectoryName
}

if ($zips.Count -eq 0) {
    Write-Host "No .zip files in: $Path" -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $baseDir "chat-json"
}

Write-Host ""
Write-Host "Scanning $($zips.Count) archive(s):" -ForegroundColor Cyan
foreach ($z in $zips) {
    $sizeMB = [math]::Round($z.Length / 1048576, 1)
    Write-Host ("  {0}  ({1} MB)" -f $z.Name, $sizeMB)
}
Write-Host ""
Write-Host "This can take several minutes. Please wait." -ForegroundColor Yellow

# --- Helpers ------------------------------------------------------------
function Read-ZipEntryText {
    param($Entry)
    $stream = $Entry.Open()
    try {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-SpaceFolder {
    param([string]$EntryPath)
    $parts = $EntryPath -split "/"
    if ($parts.Count -lt 2) { return "" }
    return $parts[$parts.Count - 2]
}

# --- Pass 1: map every space folder to its display name -----------------
$spaces = @{}

foreach ($z in $zips) {
    Write-Host ""
    Write-Host "Reading $($z.Name) ..." -ForegroundColor Cyan
    $archive = [System.IO.Compression.ZipFile]::OpenRead($z.FullName)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.Name -ne "group_info.json") { continue }

            $folder = Get-SpaceFolder $entry.FullName
            # DM folders are one-to-one private chats, not groups
            if ($folder -notlike "Space*") { continue }
            if ($spaces.ContainsKey($folder)) { continue }

            $name = "(unnamed)"
            try {
                $info = Read-ZipEntryText $entry | ConvertFrom-Json
                if ($info.name) { $name = [string]$info.name }
            } catch {
                $name = "(name unreadable)"
            }
            $spaces[$folder] = $name
        }
    } finally {
        $archive.Dispose()
    }
    Write-Host ("  groups found so far: {0}" -f $spaces.Count)
}

if ($spaces.Count -eq 0) {
    Write-Host ""
    Write-Host "No group spaces found in these archives." -ForegroundColor Yellow
    Write-Host "Check that Google Chat was selected in the Takeout export."
    exit 1
}

# --- List mode ----------------------------------------------------------
if ($List) {
    Write-Host ""
    Write-Host ("Found {0} group(s):" -f $spaces.Count) -ForegroundColor Green
    Write-Host ""
    foreach ($key in ($spaces.Keys | Sort-Object { $spaces[$_] })) {
        Write-Host ("  {0,-22}  {1}" -f $key, $spaces[$key])
    }
    Write-Host ""
    Write-Host 'Now run again with -Group "part of the name" to extract one.' -ForegroundColor Cyan
    Write-Host ""
    exit 0
}

# --- Decide what to extract ---------------------------------------------
if ([string]::IsNullOrWhiteSpace($Group)) {
    Write-Host ""
    Write-Host "Specify -Group, or use -List to see the group names first." -ForegroundColor Yellow
    exit 1
}

# Match either the display name or the folder ID. The folder ID is pure
# ASCII, which lets the caller avoid typing non-ASCII on the command line
# when the console codepage would mangle it.
$wanted = @($spaces.Keys | Where-Object {
    $spaces[$_].Contains($Group) -or $_.Contains($Group)
})

if ($wanted.Count -eq 0) {
    Write-Host ""
    Write-Host ("No group name contains: {0}" -f $Group) -ForegroundColor Yellow
    Write-Host "Run with -List to see the exact names."
    exit 1
}

Write-Host ""
Write-Host ("Matched {0} group(s):" -f $wanted.Count) -ForegroundColor Green
foreach ($w in $wanted) { Write-Host ("  {0}  =  {1}" -f $w, $spaces[$w]) }

# --- Inspect mode: report every entry for the matched group --------------
if ($Inspect) {
    Write-Host ""
    Write-Host "Every archive entry for the matched group(s):" -ForegroundColor Green
    Write-Host ""
    Write-Host ("  {0,-34} {1,14}  {2}" -f "ENTRY", "BYTES", "ARCHIVE")
    Write-Host ("  {0,-34} {1,14}  {2}" -f ("-" * 34), ("-" * 14), ("-" * 30))

    $jsonCount = 0
    foreach ($z in $zips) {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($z.FullName)
        try {
            foreach ($entry in $archive.Entries) {
                $folder = Get-SpaceFolder $entry.FullName
                if ($wanted -notcontains $folder) { continue }
                if ($entry.Name -notlike "*.json") { continue }
                $jsonCount++
                Write-Host ("  {0,-34} {1,14:N0}  {2}" -f $entry.Name, $entry.Length, $z.Name)
            }
        } finally {
            $archive.Dispose()
        }
    }

    Write-Host ""
    if ($jsonCount -gt 2) {
        Write-Host "More than one messages.json exists for this group." -ForegroundColor Yellow
        Write-Host "The export is split across parts; send all of them for analysis."
    } else {
        Write-Host "Only one messages.json exists, so nothing was skipped." -ForegroundColor Cyan
        Write-Host "If messages are missing, the export itself is incomplete."
    }
    Write-Host ""
    exit 0
}

# --- Pass 2: extract the JSON for those groups --------------------------
$null = New-Item -ItemType Directory -Force -Path $OutDir
$totalFiles = 0
$totalBytes = 0L

foreach ($z in $zips) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($z.FullName)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.Name -ne "messages.json" -and $entry.Name -ne "group_info.json") { continue }

            $folder = Get-SpaceFolder $entry.FullName
            if ($wanted -notcontains $folder) { continue }

            $destDir = Join-Path $OutDir $folder
            $null = New-Item -ItemType Directory -Force -Path $destDir
            $destFile = Join-Path $destDir $entry.Name
            if (Test-Path $destFile) { continue }

            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destFile, $true)
            $totalFiles++
            $totalBytes += $entry.Length
        }
    } finally {
        $archive.Dispose()
    }
}

if ($totalFiles -eq 0) {
    Write-Host ""
    Write-Host "Matched the group, but found no messages.json." -ForegroundColor Yellow
    Write-Host "Put all the Takeout zip parts in one folder and run again."
    exit 1
}

$sizeKB = [math]::Round($totalBytes / 1024, 1)
Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host ("  Extracted {0} file(s), {1} KB total" -f $totalFiles, $sizeKB)
Write-Host ("  Location: {0}" -f $OutDir)
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Open that folder and send messages.json." -ForegroundColor Cyan
Write-Host ""

try { Start-Process explorer.exe $OutDir } catch { }
