@echo off
setlocal
cd /d "%~dp0"
set PORT=8017

rem ---- find Chrome ----
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

rem ---- start local server (minimized window titled AvatarServer) ----
start "AvatarServer" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"

rem ---- wait a moment for the server ----
timeout /t 2 /nobreak >nul

rem ---- open the app in kiosk (fullscreen) mode ----
if defined CHROME (
  start "" "%CHROME%" --new-window --kiosk --no-first-run --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --user-data-dir="%~dp0chrome-profile" http://localhost:%PORT%/
) else (
  echo Chrome not found - opening default browser instead.
  start "" http://localhost:%PORT%/
)

echo.
echo App started.  To quit: press Alt+F4 in the app window, then run stop.bat
echo (You can close THIS window - the server keeps running in the minimized window.)
timeout /t 8 >nul
