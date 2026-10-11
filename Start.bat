@echo off
pushd "%~dp0"
node server.js %*
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%
