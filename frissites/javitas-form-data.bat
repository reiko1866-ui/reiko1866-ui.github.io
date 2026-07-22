@echo off
title Divian — form-data / axios javitas
cd /d "%~dp0"

echo.
echo  Ha a szerver inditaskor ezt latod:
echo    Cannot find module 'form-data'
echo  akkor ez a script telepiti a hianyzo csomagokat.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  HIBA: Node.js nincs telepitve.
  pause
  exit /b 1
)

echo  npm install form-data axios ...
call npm.cmd install form-data axios
if errorlevel 1 (
  echo.
  echo  HIBA az npm install soran.
  pause
  exit /b 1
)

echo.
echo  Kesz. Inditsd ujra: leallitas-17321.bat majd inditas-teszt-tervezo.bat
echo.
pause
