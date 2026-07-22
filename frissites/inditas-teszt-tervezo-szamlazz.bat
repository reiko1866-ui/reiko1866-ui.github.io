@echo off
title Divian teszt + Cyncly + Szamlazz.hu (piszkozat)
cd /d "%~dp0"

echo.
echo  Divian Kalkulator - TESZT + Cyncly + Szamlazz.hu API
echo  Mappa: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  HIBA: Node.js nincs telepitve. https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\playwright" (
  echo  HIBA: Futtasd elobb: install-fuggosegek.bat
  pause
  exit /b 1
)

if not exist "%~dp0szamlazz-agent-key.txt" (
  echo  HIBA: Hianyzik a szamlazz-agent-key.txt fajl a mappaban.
  echo  Masold at a peldat: szamlazz-agent-key.txt.example
  pause
  exit /b 1
)

set "SZAMLAZZ_LOCAL_ONLY=0"
set "SZAMLAZZ_USE_API=1"
set "SZAMLAZZ_DRAFT_ONLY=1"
set "SZAMLAZZ_USE_SANDBOX=true"
set "SZAMLAZZ_DEBUG_SAVE=1"
set "SZAMLAZZ_USE_MARDOHOME_SELLER=1"
set "SZAMLAZZ_USE_DEMO=0"
set "DIVIAN_PLAYWRIGHT_NO_CHANNEL=0"
set "DIVIAN_PLAYWRIGHT_CHANNEL=chrome"
set "DIVIAN_FAST_START=1"

node "%~dp0tools\free-port-17321.js" >nul 2>&1
node "%~dp0tools\clear-chrome-profile-lock.js" >nul 2>&1
timeout /t 1 /nobreak >nul

echo  Bizonylat: Szamlazz.hu API - CSAK ELONEZET (PDF, nincs a fiokban)
echo  Debug mentes: Asztal\Szamlazz ellenorzes (XML + PDF)
echo  Kulcs fajl: szamlazz-agent-key.txt
echo  Cyncly: a telepitett Google Chrome-ot hasznaljuk
echo  Arajanlat: http://localhost:17321/arajanlat.html
echo.
echo  FONTOS: ezt az ablakot NE zard be - futnia kell a hatterben.
echo  Leallitas: Ctrl+C
echo.

node "%~dp0divian-playwright-forwarder.js"
set "SERVER_EXIT=%ERRORLEVEL%"

echo.
if "%SERVER_EXIT%"=="0" (
  echo  A szerver leallt.
) else (
  echo  HIBA: a szerver leallt (kod %SERVER_EXIT%^).
)
echo.
pause
exit /b %SERVER_EXIT%
