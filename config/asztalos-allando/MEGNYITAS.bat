@echo off
cd /d "%~dp0"
set "U="
if exist asztalos-url.txt for /f "usebackq tokens=* delims=" %%A in ("asztalos-url.txt") do if not defined U set "U=%%A"
if "%U%"=="" (start "" "portal.html" & exit /b 1)
start "" "%U%"
