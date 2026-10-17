@echo off
title PrintHub - Desktop Installer
echo ====================================================
echo Launching PrintHub Desktop Installer v1.0.6...
echo ====================================================
for %%F in ("%~dp0installer\*.exe") do (
    start "" "%%F"
    exit
)
echo [ERROR] No installer found in installer folder!
pause
