@echo off
rem Stops the local server window started by start.bat
taskkill /fi "WINDOWTITLE eq AvatarServer*" /t /f >nul 2>&1
echo Server stopped. You can close this window.
timeout /t 3 >nul
