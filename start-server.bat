@echo off
title Nowtobook Flight Proxy Server
echo ==================================================
echo   Starting Nowtobook Backend Server (Port 5000)
echo ==================================================
cd /d "%~dp0server"

set "PATH=C:\Users\R_manish\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;%PATH%"

echo Checking Node version:
node -v
echo.
echo Server starting... Please keep this window open while using the website!
echo.

node server.js
if errorlevel 1 (
    echo.
    echo [ERROR] Server could not start or closed with an error.
    pause
)
