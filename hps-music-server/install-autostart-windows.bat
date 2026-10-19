@echo off
REM Run this ONCE (right-click > Run as administrator).
REM The server will then start by itself every time this PC turns on, and restart if it ever stops.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org and run this again. & pause & exit /b 1)
schtasks /Create /F /TN "HPS Music Room server" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "\"%~dp0start-server.bat\""
netsh advfirewall firewall add rule name="HPS Music Room" dir=in action=allow protocol=TCP localport=8080 >nul
schtasks /Run /TN "HPS Music Room server"
echo.
echo Done! The server is running and will start automatically after every restart.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo Tablets and phones on the school Wi-Fi use:  http:%%a:8080
echo Teacher dashboard:  http://localhost:8080/admin
pause
