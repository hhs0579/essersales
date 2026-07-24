@echo off
set "NVM_HOME=%LOCALAPPDATA%\nvm"
set "NVM_SYMLINK=C:\nvm4w\nodejs"
set "PATH=%NVM_SYMLINK%;%NVM_HOME%;%PATH%"
call "%NVM_HOME%\nvm.exe" use 22.22.3
set "PATH=%NVM_SYMLINK%;%PATH%"
echo.
echo Node:
"%NVM_SYMLINK%\node.exe" -v
echo.
echo 이 창에서:
echo   cd /d "%~dp0.."
echo   npm run preview
echo.
cmd /k
