#!/bin/bash

# Load NVM
source ~/.nvm/nvm.sh

# Show versions
echo "Node.js version: $(node --version)"
echo "NPM version: $(npm --version)"

# Navigate to project directory
cd /mnt/d/Downloads/mini-defi-main/mini-defi-main

# Check if hardhat is available
if npx hardhat --version >/dev/null 2>&1; then
    echo "Hardhat is available"
    echo "Running tests..."
    echo "y" | npx hardhat test
else
    echo "Hardhat not found, trying to install dependencies..."
    npm install
    echo "Retrying test..."
    echo "y" | npx hardhat test
fi