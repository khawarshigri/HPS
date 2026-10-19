@echo off
schtasks /End /TN "HPS Music Room server" >nul 2>nul
schtasks /Delete /F /TN "HPS Music Room server"
netsh advfirewall firewall delete rule name="HPS Music Room" >nul
echo Auto-start removed.
pause
