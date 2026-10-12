@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-project-manager.ps1" -OpenBrowser
if errorlevel 1 pause
