@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Cozy Shelves - Deutsche Sprachausgabe einrichten
cd /d "%~dp0"

echo ======================================================================
echo  Cozy Shelves - Deutsche Sprachausgabe (Kartoffelbox / Chatterbox) einrichten
echo ======================================================================
echo.
echo  Dieses Skript legt eine Python-Umgebung im Ordner
echo     %~dp0venv
echo  an, installiert PyTorch (CUDA) und chatterbox-tts und laedt die Modelle
echo  von huggingface.co herunter (ca. 5 GB). Das dauert je nach Internet-
echo  verbindung 10 bis 30 Minuten. Voraussetzungen: Python 3.10 - 3.12,
echo  NVIDIA-Treiber, ca. 8 GB freier Speicher.
echo.

rem ---------------------------------------------------------------- Python finden
set "PY="
for %%V in (3.11 3.12 3.10) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1 && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; raise SystemExit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)" >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo FEHLER: Es wurde kein Python 3.10, 3.11 oder 3.12 gefunden.
  echo.
  echo Bitte Python 3.11 von https://www.python.org/downloads/windows/ installieren
  echo ^(im Installer "Add python.exe to PATH" anhaken^) und dieses Skript danach
  echo erneut starten.
  echo.
  pause
  exit /b 1
)
echo Verwende Python: %PY%
%PY% --version
echo.

rem ---------------------------------------------------------------- venv anlegen
if not exist "venv\Scripts\python.exe" (
  echo Erstelle virtuelle Umgebung "venv" ...
  %PY% -m venv venv
  if errorlevel 1 (
    echo FEHLER: Die virtuelle Umgebung konnte nicht erstellt werden.
    pause
    exit /b 1
  )
)

rem ---------------------------------------------------------------- Installation + Modelle
venv\Scripts\python.exe setup_tts.py %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo ======================================================================
  echo  FEHLER: Die Einrichtung ist fehlgeschlagen ^(Code %RC%^). Siehe Meldungen oben.
  echo  Haeufige Ursachen: keine Internetverbindung, zu wenig Speicherplatz,
  echo  falsche Python-Version. Das Skript kann einfach erneut gestartet werden.
  echo ======================================================================
) else (
  echo ======================================================================
  echo  FERTIG - die deutsche Sprachausgabe ist eingerichtet.
  echo  Cozy Shelves jetzt ^(neu^) starten und in einem deutschen Buch "Vorlesen" waehlen.
  echo ======================================================================
)
echo.
pause
exit /b %RC%
