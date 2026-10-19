# Commit, push and (optionally) send out an update, all in one go.
#
#   Easiest:  double-click release.bat
#   Or:       powershell -ExecutionPolicy Bypass -File scripts\release.ps1
#   Skip the version question:  scripts\release.ps1 0.6.0
#   Push only, no update:       scripts\release.ps1 -NoRelease

param(
    [string]$Version,
    [string]$Message,
    [switch]$NoRelease
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }

# run git and stop if it fails
function RunGit {
    & git @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed (exit code $LASTEXITCODE)" }
}

# run git and just hand back the output ($null if it failed)
function GitOut {
    $out = & git @args 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $out
}

function YesNo($question, $defaultYes) {
    if ($defaultYes) { $hint = "[Y/n]" } else { $hint = "[y/N]" }
    $answer = (Read-Host "$question $hint").Trim().ToLower()
    if ($answer -eq "") { return $defaultYes }
    return ($answer -eq "y" -or $answer -eq "yes")
}

function ReadText($path) { return [System.IO.File]::ReadAllText((Join-Path $PWD.Path $path)) }
function WriteText($path, $text) {
    # UTF-8 without a BOM, so JSON and TOML files stay valid
    [System.IO.File]::WriteAllText((Join-Path $PWD.Path $path), $text, (New-Object System.Text.UTF8Encoding($false)))
}

try {
    # ---------------------------------------------------------------- sanity checks
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git isn't installed (or isn't on your PATH)." }
    if ((GitOut rev-parse --is-inside-work-tree) -ne "true") { throw "This folder isn't a git repository." }
    $remote = GitOut remote get-url origin
    if (-not $remote) { throw "There's no GitHub remote called 'origin' yet. Connect it first:`n  git remote add origin https://github.com/YOU/REPO.git" }
    if (-not (GitOut config user.name) -or -not (GitOut config user.email)) {
        throw "Git doesn't know who you are yet. Run these once:`n  git config --global user.name ""Your Name""`n  git config --global user.email ""you@example.com"""
    }
    $branch = GitOut rev-parse --abbrev-ref HEAD

    Say ""
    Say "Windows Island - commit, push and release" "Cyan"
    Say "Branch: $branch" "DarkGray"

    # ---------------------------------------------------------------- what changed?
    $raw = GitOut status --porcelain
    $changes = @()
    if ($raw) { $changes = @($raw) }
    $doCommit = $changes.Count -gt 0

    if ($doCommit) {
        Say "`nChanged files:" "Yellow"
        RunGit status --short
        if (-not $Message) { $Message = Read-Host "`nCommit message (leave empty to cancel)" }
        $Message = "$Message".Trim()
        if (-not $Message) { Say "Cancelled. Nothing was changed."; exit 0 }
    }
    else {
        Say "`nNo new changes to commit." "Yellow"
        if ($NoRelease -or -not (YesNo "Send out the code as it is now as a new update anyway?" $false)) {
            Say "Nothing to do."
            exit 0
        }
    }

    # ---------------------------------------------------------------- update or just push?
    $release = -not $NoRelease
    if ($release -and -not $Version -and $doCommit) {
        $release = YesNo "`nSend this out as an update to your friends? (No = just save it to GitHub)" $true
    }

    if ($release) {
        if (-not (Test-Path "src-tauri/tauri.updater.conf.json")) {
            throw "Auto-update isn't set up yet. Run this once first:`n  powershell -ExecutionPolicy Bypass -File scripts\setup-updater.ps1"
        }
        $cargoText = ReadText "src-tauri/Cargo.toml"
        $m = [regex]::Match($cargoText, '(?m)^version\s*=\s*"(\d+\.\d+\.\d+)"')
        if (-not $m.Success) { throw "Couldn't find the version number in src-tauri\Cargo.toml" }
        $base = [version]$m.Groups[1].Value
        foreach ($t in @(GitOut tag --list "v*")) {
            if ($t -match '^v(\d+\.\d+\.\d+)$') {
                $tv = [version]$Matches[1]
                if ($tv -gt $base) { $base = $tv }
            }
        }
        $suggest = "{0}.{1}.{2}" -f $base.Major, $base.Minor, ($base.Build + 1)

        if (-not $Version) {
            $typed = (Read-Host "`nNew version number [$suggest] (press Enter to accept)").Trim()
            if ($typed) { $Version = $typed } else { $Version = $suggest }
        }
        $Version = $Version.TrimStart("v")
        if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Use a version like 0.6.0 (three numbers)." }
        if ([version]$Version -le $base) { throw "The version has to go up. The latest so far is $base, so use something higher (like $suggest)." }
        if (GitOut tag --list "v$Version") { throw "A release called v$Version already exists." }
    }

    # ---------------------------------------------------------------- confirm
    Say "`nHere's what will happen:" "Cyan"
    if ($doCommit) { Say "  1. Commit your changes: ""$Message""" }
    if ($release) { Say "  2. Set the version to $Version and tag it v$Version" }
    Say "  3. Push to GitHub ($branch)"
    if ($release) { Say "  4. GitHub builds the installer; you publish it, and your friends' apps update themselves" }
    if (-not (YesNo "`nGo ahead?" $true)) { Say "Cancelled. Nothing was changed."; exit 0 }
    Say ""

    # ---------------------------------------------------------------- commit
    if ($doCommit) {
        RunGit add -A
        # the message goes through a file, so quotes, & and % in it can't break anything
        $tmp = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmp, $Message, (New-Object System.Text.UTF8Encoding($false)))
            RunGit commit -F $tmp
        }
        finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    }

    # ---------------------------------------------------------------- version bump + tag
    if ($release) {
        $touched = @()

        $re = New-Object System.Text.RegularExpressions.Regex('(?m)^version\s*=\s*"[^"]*"')
        WriteText "src-tauri/Cargo.toml" ($re.Replace($cargoText, "version = ""$Version""", 1))
        $touched += "src-tauri/Cargo.toml"

        # if these files also carry a version, keep them matching (tauri.conf.json would otherwise win)
        $jsonRe = New-Object System.Text.RegularExpressions.Regex('(?m)^(\s*)"version"\s*:\s*"[^"]*"')
        foreach ($f in @("src-tauri/tauri.conf.json", "package.json")) {
            if (Test-Path $f) {
                $text = ReadText $f
                if ($jsonRe.IsMatch($text)) {
                    $v = $Version
                    WriteText $f ($jsonRe.Replace($text, { param($mm) $mm.Groups[1].Value + '"version": "' + $v + '"' }, 1))
                    $touched += $f
                }
            }
        }

        # Cargo.lock records the app's own version too; keep it in step so it doesn't show up as changed
        if (Test-Path "src-tauri/Cargo.lock") {
            $lock = ReadText "src-tauri/Cargo.lock"
            $lockRe = New-Object System.Text.RegularExpressions.Regex('(?s)(name = "windows-island"\r?\nversion = ")[^"]*(")')
            if ($lockRe.IsMatch($lock)) {
                $v = $Version
                WriteText "src-tauri/Cargo.lock" ($lockRe.Replace($lock, { param($mm) $mm.Groups[1].Value + $v + $mm.Groups[2].Value }, 1))
                $touched += "src-tauri/Cargo.lock"
            }
        }

        foreach ($f in $touched) { RunGit add -- $f }
        RunGit commit -m "Release v$Version"
        RunGit tag "v$Version"
    }

    # ---------------------------------------------------------------- push
    $upstream = GitOut rev-parse --abbrev-ref --symbolic-full-name '@{u}'
    if ($upstream) { RunGit push } else { RunGit push -u origin HEAD }
    if ($release) { RunGit push origin "v$Version" }

    # ---------------------------------------------------------------- done
    Say "`nDone! Your code is on GitHub." "Green"
    $web = $null
    if ("$remote" -match 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$') { $web = "https://github.com/$($Matches[1])/$($Matches[2])" }

    if ($release) {
        Say "`nGitHub is building v$Version now (about 10 minutes)." "Green"
        Say "When the build turns green:"
        Say "  1. Open Releases and click the draft called v$Version"
        Say "  2. Click 'Publish release'. That's what sends the update to your friends."
        if ($web -and (YesNo "`nOpen the build page in your browser?" $true)) { Start-Process "$web/actions" }
    }
    elseif ($web) {
        Say "$web" "DarkGray"
    }
}
catch {
    Say "`nSomething went wrong:" "Red"
    Say "  $($_.Exception.Message)" "Red"
    if ($_.Exception.Message -match "push") {
        Say "`nIf GitHub says your copy is behind, run this and then try again:" "Yellow"
        Say "  git pull --rebase"
    }
    exit 1
}
