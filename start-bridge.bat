@echo off
rem Relay between reforger-mapper (browser) and the Arma Reforger Workbench. Leave this window open.
cd /d "%~dp0"
npm run bridge
pause
