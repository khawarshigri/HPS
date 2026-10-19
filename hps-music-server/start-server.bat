@echo off
title HPS Music Room server
cd /d "%~dp0"
:loop
echo Starting HPS Music Room server...
node server.js
echo Server stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
