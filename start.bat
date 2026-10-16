@echo off
setlocal enabledelayedexpansion
title VectorSearch Engine & Console

echo ======================================================================
echo             VectorSearch: AVX2 C++ Vector Database Console
echo ======================================================================
echo.

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"
set "PYTHONPATH=%ROOT_DIR%;%ROOT_DIR%python"

echo [1/2] Starting VectorSearch Backend Engine (run_server.py)...
start "VectorSearch Backend" cmd /k "title VectorSearch Backend API && cd /d %ROOT_DIR% && set PYTHONPATH=%ROOT_DIR%;%ROOT_DIR%python && python run_server.py"

echo [2/2] Starting VectorSearch React Console on 0.0.0.0:5173...
cd /d "%ROOT_DIR%frontend"
start "VectorSearch Frontend" cmd /k "title VectorSearch Console && cd /d %ROOT_DIR%frontend && npm run dev -- --host 0.0.0.0 --port 5173"

echo.
echo ======================================================================
echo   VectorSearch Console: http://localhost:5173  or  http://127.0.0.1:5173
echo   Backend Swagger API:  http://127.0.0.1:8000/docs
echo ======================================================================
echo.
echo Launching your browser to http://localhost:5173 in 3 seconds...
timeout /t 3 >nul
start http://localhost:5173

echo.
echo Both services are active in separate terminals.
pause
