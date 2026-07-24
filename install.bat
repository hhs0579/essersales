@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
echo Node: & node -v
echo npm:  & npm -v
npm install
pause
