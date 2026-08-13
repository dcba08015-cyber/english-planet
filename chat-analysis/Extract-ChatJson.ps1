<#
.SYNOPSIS
    從 Google Takeout 的大型 zip 裡，只取出指定群組的聊天記錄 JSON。

.DESCRIPTION
    Google Chat 的 Takeout 匯出會包含群組裡分享過的所有圖片與影片，
    動輒數十 GB。但訊息文字只存在 messages.json，通常只有幾 MB。

    這支腳本直接讀取 zip 的檔案索引，不解壓整個壓縮檔，
    所以就算來源是 10GB 也能在很短時間內完成。

    需要 Windows 內建的 PowerShell 即可，不必安裝任何軟體。

.EXAMPLE
    # 先列出壓縮檔裡有哪些群組
    .\Extract-ChatJson.ps1 -Path "D:\Googlechat對話紀錄" -List

.EXAMPLE
    # 取出名稱含「技術客服」的群組
    .\Extract-ChatJson.ps1 -Path "D:\Googlechat對話紀錄" -Group "技術客服"
#>

[CmdletBinding()]
param(
    # 存放 Takeout zip 的資料夾（也可直接指向單一 zip）
    [Parameter(Mandatory = $true)]
    [string]$Path,

    # 要取出的群組名稱（部分文字即可，例如「技術客服」）
    [string]$Group = "",

    # 只列出群組清單，不取出任何檔案
    [switch]$List,

    # 輸出位置，預設是來源資料夾底下的 chat-json
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Add-Type -AssemblyName System.IO.Compression.FileSystem

# --- 找出要處理的 zip ---------------------------------------------------
if (-not (Test-Path $Path)) {
    Write-Host "找不到路徑：$Path" -ForegroundColor Red
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
    Write-Host "資料夾裡沒有 zip 檔：$Path" -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $baseDir "chat-json"
}

Write-Host ""
Write-Host "要掃描 $($zips.Count) 個壓縮檔：" -ForegroundColor Cyan
foreach ($z in $zips) {
    $mb = [math]::Round($z.Length / 1MB, 1)
    Write-Host ("  {0}  ({1} MB)" -f $z.Name, $mb)
}

# --- 讀出 zip 裡某個項目的文字內容 -------------------------------------
function Read-ZipEntryText {
    param($Entry)
    $stream = $Entry.Open()
    try {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}

# 從 zip 內的路徑取出所屬聊天室的資料夾名稱
function Get-SpaceFolder {
    param([string]$EntryPath)
    $parts = $EntryPath -split "/"
    if ($parts.Count -lt 2) { return "" }
    return $parts[$parts.Count - 2]
}

# --- 第一輪：掃出所有群組與名稱 ----------------------------------------
$spaces = @{}    # 資料夾名稱 -> 群組顯示名稱

foreach ($z in $zips) {
    Write-Host ""
    Write-Host "掃描 $($z.Name) ..." -ForegroundColor Cyan
    $archive = [System.IO.Compression.ZipFile]::OpenRead($z.FullName)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.Name -ne "group_info.json") { continue }

            $folder = Get-SpaceFolder $entry.FullName
            # DM 是一對一私訊，不是群組，直接跳過
            if ($folder -notlike "Space*") { continue }
            if ($spaces.ContainsKey($folder)) { continue }

            $name = "(未命名)"
            try {
                $info = Read-ZipEntryText $entry | ConvertFrom-Json
                if ($info.name) { $name = [string]$info.name }
            } catch {
                $name = "(名稱讀取失敗)"
            }
            $spaces[$folder] = $name
        }
    } finally {
        $archive.Dispose()
    }
    Write-Host ("  目前累計找到 {0} 個群組" -f $spaces.Count)
}

if ($spaces.Count -eq 0) {
    Write-Host ""
    Write-Host "這些壓縮檔裡沒有找到任何群組（Space）。" -ForegroundColor Yellow
    Write-Host "確認匯出時有勾選 Google Chat；群組資料也可能在另一個 zip 裡。"
    exit 1
}

# --- -List 模式：印出清單就結束 ----------------------------------------
if ($List) {
    Write-Host ""
    Write-Host ("找到 {0} 個群組：" -f $spaces.Count) -ForegroundColor Green
    Write-Host ""
    foreach ($key in ($spaces.Keys | Sort-Object { $spaces[$_] })) {
        Write-Host ("  {0,-22}  {1}" -f $key, $spaces[$key])
    }
    Write-Host ""
    Write-Host '接著用 -Group "群組名稱的一部分" 取出你要的那個。' -ForegroundColor Cyan
    Write-Host ""
    exit 0
}

# --- 決定要取出哪些群組 -------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Group)) {
    Write-Host ""
    Write-Host "請用 -Group 指定要取出的群組，或用 -List 先看清單。" -ForegroundColor Yellow
    exit 1
}

$wanted = @($spaces.Keys | Where-Object { $spaces[$_] -like "*$Group*" })

if ($wanted.Count -eq 0) {
    Write-Host ""
    Write-Host "沒有群組的名稱含「$Group」。用 -List 看看實際名稱。" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host ("符合「{0}」的群組共 {1} 個：" -f $Group, $wanted.Count) -ForegroundColor Green
foreach ($w in $wanted) { Write-Host ("  {0}  =  {1}" -f $w, $spaces[$w]) }

# --- 第二輪：取出這些群組的 JSON ---------------------------------------
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
            if (Test-Path $destFile) { continue }   # 多個 zip 之間可能重複

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
    Write-Host "找到群組，但沒有取出任何 messages.json。" -ForegroundColor Yellow
    Write-Host "訊息檔可能在另一個 zip 裡，把四個 zip 都放進同一個資料夾再跑一次。"
    exit 1
}

$kb = [math]::Round($totalBytes / 1KB, 1)
Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host ("  取出 {0} 個檔案，共 {1} KB" -f $totalFiles, $kb)
Write-Host ("  位置：{0}" -f $OutDir)
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "打開上面那個資料夾，把裡面的 messages.json 傳出去即可。" -ForegroundColor Cyan
Write-Host ""

# 順便在檔案總管開啟輸出資料夾，省得自己找
try { Start-Process explorer.exe $OutDir } catch { }
