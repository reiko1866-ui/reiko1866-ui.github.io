@echo off
title Divian — telefonos portal
cd /d "%~dp0"
set "URL="
if exist "..\aktualis-tunnel-url.txt" for /f "usebackq tokens=* delims=" %%A in ("..\aktualis-tunnel-url.txt") do (
  if not defined URL set "URL=%%A"
)
if exist "..\budaors\szerver-url.txt" if "%URL%"=="" for /f "usebackq tokens=* delims=" %%A in ("..\budaors\szerver-url.txt") do (
  if not defined URL set "URL=%%A"
)
if "%URL%"=="" (
  echo Nincs tunnel URL — a Vaci uti gepen inditsd az INDITAS.bat-ot.
  if exist "portal.html" start "" "portal.html"
  pause
  exit /b 1
)
echo Megnyitas: portal.html?base=%URL%
start "" "portal.html?base=%URL%"
exit /b 0
