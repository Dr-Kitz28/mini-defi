@echo off
REM Mini-DeFi Quick Start Script for Windows
REM This batch file starts the Hardhat node and frontend server

echo ============================================
echo   Mini-DeFi Quick Start
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Python is not installed. Please install Python first.
    pause
    exit /b 1
)

echo [1/4] Installing dependencies...
call npm install

echo [2/4] Compiling contracts...
call npx hardhat compile

echo [3/4] Starting Hardhat node in new window...
start "Hardhat Node" cmd /k "npx hardhat node"
timeout /t 5 /nobreak >nul

echo [4/4] Deploying contracts and starting frontend...
call npx hardhat run scripts/deploy.js --network localhost

if exist "scripts\deploy-many-assets.js" (
    echo Deploying 100 assets...
    call npx hardhat run scripts/deploy-many-assets.js --network localhost
)

echo.
echo Starting frontend server...
cd frontend
start "Frontend Server" cmd /k "python -m http.server 3000"

echo.
echo ============================================
echo   Servers Started!
echo ============================================
echo.
echo   Blockchain: http://localhost:8545
echo   Frontend:   http://localhost:3000
echo.
echo   Close the opened windows to stop servers.
echo.
pause
