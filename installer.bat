@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Windows Island - build and install
set "EXIT_CODE=0"

rem Tools installed earlier in this session may not be on PATH yet, so add the usual spots.
set "PATH=%USERPROFILE%\.cargo\bin;%ProgramFiles%\nodejs;%PATH%"

echo.
echo ==============================================
echo   Windows Island - build and install
echo ==============================================
echo.
echo This checks your tools, builds the installer, and offers to run it.
echo The first build compiles a lot of Rust and can take 5 to 10 minutes.
echo.

rem ------------------------------------------------ Node.js
where node >nul 2>&1
if not errorlevel 1 goto node_ok
echo [!] Node.js was not found.
where winget >nul 2>&1
if errorlevel 1 goto node_manual
choice /c YN /m "Install Node.js LTS now with winget"
if errorlevel 2 goto node_manual
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto fail
echo.
echo Node.js is installed. CLOSE this window, open a new one, and run installer.bat again.
goto finish
:node_manual
echo Install Node.js 20 or newer from https://nodejs.org and run this script again.
goto fail_quiet
:node_ok
echo [ok] Node.js found.

rem ------------------------------------------------ Rust
where cargo >nul 2>&1
if not errorlevel 1 goto rust_ok
echo [!] Rust was not found.
where winget >nul 2>&1
if errorlevel 1 goto rust_manual
choice /c YN /m "Install Rust with winget"
if errorlevel 2 goto rust_manual
winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto fail
echo.
echo Rust is installed. CLOSE this window, open a new one, and run installer.bat again.
goto finish
:rust_manual
echo Install Rust from https://rustup.rs and run this script again.
goto fail_quiet
:rust_ok
echo [ok] Rust found.
where rustup >nul 2>&1
if errorlevel 1 goto msvc_check
rustup default stable-msvc
if errorlevel 1 goto fail

rem ------------------------------------------------ Visual Studio C++ Build Tools
:msvc_check
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto msvc_missing
"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath > "%TEMP%\island_vs.txt" 2>nul
set "VSSIZE=0"
for %%A in ("%TEMP%\island_vs.txt") do set "VSSIZE=%%~zA"
if %VSSIZE% GTR 0 goto msvc_ok
:msvc_missing
echo [!] The Visual Studio C++ Build Tools were not found. Rust needs them to link programs.
where winget >nul 2>&1
if errorlevel 1 goto msvc_manual
choice /c YN /m "Install them now with winget (large download, asks for admin)"
if errorlevel 2 goto msvc_manual
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
if errorlevel 1 goto fail
goto msvc_ok
:msvc_manual
echo Install the Desktop development with C++ workload from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and run this script again.
goto fail_quiet
:msvc_ok
echo [ok] C++ Build Tools found.

rem ------------------------------------------------ npm packages
echo.
echo [1/2] Installing npm packages...
if exist package-lock.json goto npm_ci
call npm install
goto npm_done
:npm_ci
call npm ci
:npm_done
if errorlevel 1 goto fail

rem ------------------------------------------------ build
echo.
echo [2/2] Building the installer...
call npm run tauri build
if errorlevel 1 goto fail

rem ------------------------------------------------ find the installer
set "SETUP="
for /f "delims=" %%F in ('dir /b /o-d "src-tauri\target\release\bundle\nsis\*-setup.exe" 2^>nul') do if not defined SETUP set "SETUP=src-tauri\target\release\bundle\nsis\%%F"
if not defined SETUP goto nosetup

if not exist release mkdir release
copy /y "%SETUP%" release >nul

echo.
echo ==============================================
echo   Done. Your installer is ready:
echo   %SETUP%
echo   A copy is in the release folder.
echo ==============================================
echo.
choice /c YN /m "Run the installer now"
if errorlevel 2 goto finish
start "" "%SETUP%"
goto finish

:nosetup
echo.
echo The build finished but no -setup.exe was found in src-tauri\target\release\bundle\nsis
goto fail

:fail
echo.
echo Something went wrong. Scroll up to read the error message.
:fail_quiet
set "EXIT_CODE=1"

:finish
echo.
pause
exit /b %EXIT_CODE%
