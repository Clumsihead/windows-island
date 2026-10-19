@echo off
setlocal
cd /d "%~dp0"
title Windows Island - commit, push and release
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" %*
echo.
pause
