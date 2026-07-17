@echo off
title AI Kids Animation Studio Launcher
echo ===================================================
echo     AI Kids Animation Studio - Startup Script
echo ===================================================
echo.

:: Detect if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed! Please install Node.js ^(v18+^) to run the frontend.
    pause
    exit /b 1
)

:: Detect if Python is installed
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed! Please install Python 3.10+ to run the backend.
    pause
    exit /b 1
)

echo [1/3] Installing Python Backend Dependencies...
cd backend
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Failed to install Python dependencies. Please check your Python environment.
)
cd ..

echo.
echo [2/3] Installing Frontend Node.js Dependencies...
cd frontend
if not exist node_modules (
    echo node_modules not found, running npm install...
    call npm install
) else (
    echo node_modules already exists. Skipping install.
)
cd ..

echo.
echo [3/3] Starting Backend & Frontend Servers...
echo.
echo ---------------------------------------------------
echo  * Backend running at: http://127.0.0.1:8000
echo  * Frontend running at: http://localhost:3001
echo ---------------------------------------------------
echo.
echo Launching services...
echo.

:: Start FastAPI Backend in a new window
start "FastAPI Backend (Port 8000)" cmd /k "cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

:: Start Next.js Frontend in a new window
start "Next.js Frontend (Port 3001)" cmd /k "cd frontend && npm run dev"

echo.
echo [SUCCESS] Both servers are starting up in separate terminal windows.
echo - You can view the API doc at: http://127.0.0.1:8000/docs
echo - You can open the Web App at: http://localhost:3001
echo.
pause
