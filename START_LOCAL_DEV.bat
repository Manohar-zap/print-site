@echo off
title PrintHub - Local Dev Server
echo ====================================================
echo Starting PrintHub Local Dev Server on port 3000...
echo ====================================================
cd /d "%~dp0printhub-electron\printhub-user"
start "" http://localhost:3000/
start "" http://localhost:3000/shopkeeper.html
npm run dev
pause
