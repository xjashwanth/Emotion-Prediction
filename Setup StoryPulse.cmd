@echo off
setlocal
cd /d "%~dp0"
title StoryPulse - One-time setup
where py >nul 2>nul
if errorlevel 1 (
  python setup_local.py
) else (
  py setup_local.py
)
if errorlevel 1 (
  echo.
  echo Setup did not finish. Check the error above and your internet connection.
  pause
  exit /b 1
)
echo.
echo Setup complete. Open "Start StoryPulse.cmd" to launch the webpage.
pause
