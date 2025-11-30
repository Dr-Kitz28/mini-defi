# Troubleshooting Guide

## Connection Issues

### "Connect Wallet" button not working
**Symptoms:** Clicking Connect Wallet does nothing or shows error.

**Solutions:**
1. Make sure MetaMask extension is installed
2. Refresh the page and try again
3. Check browser console (F12) for errors
4. Try a different browser

### "Wrong Network" error
**Symptoms:** MetaMask shows wrong network or transactions fail.

**Solutions:**
1. Open MetaMask → Settings → Networks
2. Add network with these settings:
   - Network Name: Hardhat Local
   - RPC URL: http://127.0.0.1:8545
   - Chain ID: 31337
   - Currency: ETH
3. Switch to this network

### "No provider found"
**Symptoms:** Error message about missing provider.

**Solutions:**
1. Install MetaMask browser extension
2. Unlock MetaMask if locked
3. Refresh the page

## Asset Loading Issues

### Assets not showing in browser
**Symptoms:** Asset Browser is empty or shows loading.

**Solutions:**
1. Check if Hardhat node is running:
   ```powershell
   npx hardhat node
   ```
2. Check if contracts are deployed:
   ```powershell
   npx hardhat run scripts/deploy.js --network localhost
   npx hardhat run scripts/deploy-many-assets.js --network localhost
   ```
3. Check `deployed-contracts.json` has correct addresses
4. Refresh the page

### Prices showing as $0.00
**Symptoms:** Asset prices are zero.

**Solutions:**
1. Price oracle might not be set up
2. Try refreshing the page
3. Check console for oracle errors

## Transaction Issues

### "Insufficient funds"
**Symptoms:** Transaction fails with insufficient funds.

**Solutions:**
1. Check you have enough ETH for gas
2. Check you have enough of the token you're depositing
3. Import a funded Hardhat test account

### "Transaction reverted"
**Symptoms:** Transaction fails after submitting.

**Solutions:**
1. Check health factor if borrowing/withdrawing
2. Make sure you approved token spending
3. Check console for revert reason
4. Amount might exceed limits

### "User rejected transaction"
**Symptoms:** Nothing happens after MetaMask popup.

**Solutions:**
1. Click Confirm in MetaMask popup
2. Check MetaMask for pending requests
3. Try the transaction again

## Health Factor Issues

### Health factor is 0 or undefined
**Symptoms:** Health factor shows 0 or N/A.

**Solutions:**
1. You might not have any borrows (HF only applies to borrowers)
2. Refresh the page to update
3. Check if you have active positions

### Health factor dropping unexpectedly
**Symptoms:** Health factor decreasing without action.

**Solutions:**
1. Collateral asset prices may have dropped
2. Interest may have accrued on borrows
3. Deposit more collateral or repay debt

## AI Chat Issues

### AI not responding
**Symptoms:** Chat shows typing forever or no response.

**Solutions:**
1. Type `/status` to check AI mode
2. Try `/local` to switch to offline mode
3. Check internet connection
4. API key may be invalid - use `/setkey NEW_KEY`

### "Rate limit reached" error
**Symptoms:** Error about API quota.

**Solutions:**
1. Wait a few minutes and try again
2. Type `/local` to use local AI mode
3. Check OpenAI account for billing issues

### Local AI not working
**Symptoms:** /local mode fails or shows error.

**Solutions:**
1. Make sure local RAG server is running:
   ```powershell
   python scripts/local_rag_server.py
   ```
2. Check if model file exists in `models/` folder
3. Install Python dependencies:
   ```powershell
   pip install -r requirements-local-rag.txt
   ```

## Display Issues

### Theme not changing
**Symptoms:** Light/dark mode toggle not working.

**Solutions:**
1. Check browser supports CSS variables
2. Clear browser cache
3. Try a different browser

### Layout broken on mobile
**Symptoms:** UI looks wrong on phone/tablet.

**Solutions:**
1. Website is optimized for desktop
2. Try landscape mode
3. Zoom out if elements overlap

### Buttons not clicking
**Symptoms:** Buttons appear but don't respond.

**Solutions:**
1. Wait for page to fully load
2. Check for JavaScript errors in console
3. Disable browser extensions that might interfere
4. Try a different browser

## Server Issues

### Hardhat node crashed
**Symptoms:** All transactions fail, assets won't load.

**Solutions:**
1. Restart Hardhat node:
   ```powershell
   npx hardhat node
   ```
2. Re-deploy contracts (addresses will change):
   ```powershell
   npx hardhat run scripts/deploy.js --network localhost
   npx hardhat run scripts/deploy-many-assets.js --network localhost
   ```
3. Refresh the frontend

### Frontend server not starting
**Symptoms:** Can't access http://localhost:8000.

**Solutions:**
1. Check if port 8000 is in use
2. Try a different port:
   ```powershell
   npx http-server frontend -p 3000
   ```
3. Use Python server instead:
   ```powershell
   cd frontend
   python -m http.server 3000
   ```
