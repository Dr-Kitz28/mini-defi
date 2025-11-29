# Mini-DeFi Production Servers Startup Script
# This script starts both the Hardhat blockchain node and the frontend web server

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Mini-DeFi Production Server Startup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if npm packages are installed
if (-not (Test-Path "$ScriptDir\node_modules")) {
    Write-Host "[1/4] Installing dependencies..." -ForegroundColor Yellow
    Set-Location $ScriptDir
    npm install
} else {
    Write-Host "[1/4] Dependencies already installed" -ForegroundColor Green
}

# Check if contracts are compiled
if (-not (Test-Path "$ScriptDir\artifacts\contracts")) {
    Write-Host "[2/4] Compiling smart contracts..." -ForegroundColor Yellow
    npx hardhat compile
} else {
    Write-Host "[2/4] Contracts already compiled" -ForegroundColor Green
}

# Start Hardhat node in background
Write-Host "[3/4] Starting Hardhat blockchain node on port 8545..." -ForegroundColor Yellow
$hardhatJob = Start-Job -ScriptBlock {
    Set-Location $using:ScriptDir
    npx hardhat node
}
Start-Sleep -Seconds 3

# Check if Hardhat is running
$hardhatCheck = Test-NetConnection -ComputerName 127.0.0.1 -Port 8545 -WarningAction SilentlyContinue
if ($hardhatCheck.TcpTestSucceeded) {
    Write-Host "    Hardhat node running at http://localhost:8545" -ForegroundColor Green
} else {
    Write-Host "    Warning: Hardhat node may not have started yet" -ForegroundColor Yellow
}

# Deploy contracts
Write-Host "    Deploying contracts..." -ForegroundColor Yellow
Set-Location $ScriptDir
$deployOutput = npx hardhat run scripts/deploy.js --network localhost 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "    Contracts deployed successfully" -ForegroundColor Green
}

# Deploy many assets if script exists
if (Test-Path "$ScriptDir\scripts\deploy-many-assets.js") {
    Write-Host "    Deploying 100 assets..." -ForegroundColor Yellow
    npx hardhat run scripts/deploy-many-assets.js --network localhost 2>&1 | Out-Null
    Write-Host "    100 assets deployed" -ForegroundColor Green
}

# Start frontend server
Write-Host "[4/4] Starting frontend server on port 3000..." -ForegroundColor Yellow
Set-Location "$ScriptDir\frontend"
$frontendJob = Start-Job -ScriptBlock {
    Set-Location "$using:ScriptDir\frontend"
    python -m http.server 3000
}
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Servers Started Successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Blockchain Node:  http://localhost:8545" -ForegroundColor White
Write-Host "  Frontend App:     http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C to stop all servers" -ForegroundColor Yellow
Write-Host ""

# Keep script running and handle cleanup
try {
    while ($true) {
        Start-Sleep -Seconds 5
        # Check if jobs are still running
        $hardhatStatus = Get-Job -Id $hardhatJob.Id -ErrorAction SilentlyContinue
        $frontendStatus = Get-Job -Id $frontendJob.Id -ErrorAction SilentlyContinue
        
        if ($hardhatStatus.State -eq "Failed" -or $frontendStatus.State -eq "Failed") {
            Write-Host "A server has stopped unexpectedly" -ForegroundColor Red
            break
        }
    }
} finally {
    Write-Host "`nShutting down servers..." -ForegroundColor Yellow
    Stop-Job -Job $hardhatJob -ErrorAction SilentlyContinue
    Stop-Job -Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $hardhatJob -ErrorAction SilentlyContinue
    Remove-Job -Job $frontendJob -ErrorAction SilentlyContinue
    Write-Host "Servers stopped" -ForegroundColor Green
}
