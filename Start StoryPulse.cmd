@echo off
setlocal
cd /d "%~dp0"
title StoryPulse - Local webpage
if not exist ".venv\Scripts\python.exe" (
  echo Please run "Setup StoryPulse.cmd" once to prepare this laptop.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" launch.py
if errorlevel 1 (
  echo.
  echo StoryPulse could not start. Read the message above.
  echo You can run "Setup StoryPulse.cmd" to repair the environment.
  pause
)
