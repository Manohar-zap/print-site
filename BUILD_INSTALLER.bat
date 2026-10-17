@echo off
title PrintHub - Build Desktop App Installer
echo ====================================================
echo Building PrintHub Desktop Windows Installer (.exe)...
echo ====================================================
cd /d "%~dp0printhub-electron"
call npm run build:win
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed! Check terminal output above.
    pause
    exit /b %ERRORLEVEL%
)

echo [OK] Copying installer to root \installer folder...
node -e "const fs = require('fs'); fs.copyFileSync('%~dp0printhub-electron/dist/Printhub Setup 1.0.0.exe', '%~dp0installer/Printhub Setup 1.0.0.exe'); console.log('[SUCCESS] Installer copied to installer/Printhub Setup 1.0.0.exe');"
pause
