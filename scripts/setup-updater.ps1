# One-time setup for auto-updates. Run it from the project root:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-updater.ps1
#
# It (1) creates the signing key, (2) writes src-tauri\tauri.updater.conf.json using the
# GitHub repo from your git remote, and (3) uploads the key to GitHub as a secret.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

# ---- 1. which GitHub repo? (read from your git remote)
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { throw "No git remote called 'origin'. Connect your GitHub repo first: git remote add origin https://github.com/YOU/REPO.git" }
if ($remote -notmatch 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$') { throw "Origin doesn't look like a GitHub URL: $remote" }
$owner = $Matches[1]
$repo  = $Matches[2]
Write-Host "Repository: $owner/$repo"

# ---- 2. signing key (an existing key is never overwritten)
$keyDir  = Join-Path $env:USERPROFILE ".tauri"
$keyFile = Join-Path $keyDir "windows-island.key"
$pubFile = "$keyFile.pub"

if (Test-Path $keyFile) {
    Write-Host "Using the existing signing key: $keyFile"
} else {
    New-Item -ItemType Directory -Force $keyDir | Out-Null
    Write-Host ""
    Write-Host "Creating your update-signing key."
    Write-Host "You'll be asked for a password: press Enter twice for none, or choose one and remember it."
    Write-Host ""
    npm run tauri signer generate -- -w $keyFile
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pubFile)) { throw "Key generation failed." }
}
$pub = (Get-Content $pubFile -Raw).Trim()

# ---- 3. updater config, merged in only for release builds
$conf = [ordered]@{
    bundle  = [ordered]@{ createUpdaterArtifacts = $true }
    plugins = [ordered]@{
        updater = [ordered]@{
            pubkey    = $pub
            endpoints = @("https://github.com/$owner/$repo/releases/latest/download/latest.json")
            windows   = [ordered]@{ installMode = "passive" }
        }
    }
}
$json    = $conf | ConvertTo-Json -Depth 10
$outPath = Join-Path $PWD.Path "src-tauri\tauri.updater.conf.json"
# UTF-8 *without* a BOM: Tauri's JSON parser rejects a BOM.
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote src-tauri\tauri.updater.conf.json"

# ---- 4. give GitHub the private key so its build can sign releases
$uploaded = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
    gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Uploading the signing key to GitHub secrets..."
        Get-Content $keyFile -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$owner/$repo"
        $sec = Read-Host "Password you chose for the key (press Enter if none)" -AsSecureString
        $pw  = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        if ($pw) { $pw | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$owner/$repo" }
        $uploaded = $true
    }
}
if (-not $uploaded) {
    Write-Host ""
    Write-Host "Add these two secrets by hand: GitHub repo > Settings > Secrets and variables > Actions > New repository secret"
    Write-Host "  TAURI_SIGNING_PRIVATE_KEY           = the full contents of $keyFile"
    Write-Host "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  = your key password (skip this one if you chose none)"
}

Write-Host ""
Write-Host "Done. Next:"
Write-Host "  1. BACK UP $keyFile somewhere safe (password manager, USB stick)."
Write-Host "     If you lose it, installed copies can never update again and everyone must reinstall."
Write-Host "  2. git add src-tauri/tauri.updater.conf.json"
Write-Host "     git commit -m 'Enable auto-update'"
Write-Host "  3. Ship a release:  powershell -ExecutionPolicy Bypass -File scripts\release.ps1 0.5.0"
