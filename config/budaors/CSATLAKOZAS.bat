@echo off
title Divian — Budaors csatlakozas (Vaci ut szerver)
cd /d "%~dp0"
set "URL="
if exist "szerver-url.txt" for /f "usebackq tokens=* delims=" %%A in ("szerver-url.txt") do (
  if not defined URL set "URL=%%A"
)
if "%URL%"=="" (
  echo Nincs szerver-url.txt — a Vaci uti gepen inditsd az INDITAS.bat-ot,
  echo majd OneDrive-on varj a Divian-Budaors mappa frissulesere.
  if exist "portal.html" start "" "portal.html"
  pause
  exit /b 1
)
echo Megnyitas: %URL%/tavoli/
start "" "%URL%/tavoli/"
exit /b 0
