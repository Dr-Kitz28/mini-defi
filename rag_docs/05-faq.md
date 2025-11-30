# Frequently Asked Questions

## Getting Started

### How do I connect my wallet?
Click the "Connect Wallet" button in the top-right corner. MetaMask will prompt you to connect. Make sure you're on the Hardhat Local network (Chain ID 31337).

### What network should I use?
For testing, use Hardhat Local network:
- Network Name: Hardhat Local
- RPC URL: http://127.0.0.1:8545
- Chain ID: 31337
- Currency: ETH

### How do I get test tokens?
Test tokens are automatically minted when contracts are deployed. If you need more, you can import a Hardhat test account that has pre-minted tokens.

## Depositing

### How do I deposit assets?
1. Connect your wallet
2. Select assets in the Asset Browser
3. Click the Deposit tab
4. Set proportions (must total 100%)
5. Enter total amount
6. Click Execute Deposit
7. Confirm in MetaMask

### What happens when I deposit?
You receive "shares" representing ownership of the pool. As borrowers pay interest, the pool grows, making your shares worth more.

### Can I deposit multiple assets at once?
Yes! Select multiple assets, set proportions, and execute a batch deposit. This is more gas-efficient than individual deposits.

## Borrowing

### How do I borrow assets?
1. First, deposit assets as collateral
2. Select assets you want to borrow
3. Click the Borrow tab
4. Enter amount (limited by your collateral)
5. Execute the borrow

### How much can I borrow?
Your max borrow = Collateral Value × Collateral Factor. For example, with $1000 collateral and 75% factor, you can borrow up to $750.

### What's a collateral factor?
It's the percentage of your deposit that can be used as collateral. Stablecoins typically have higher factors (safer), volatile assets have lower factors.

## Health Factor

### What is health factor?
Health Factor = (Collateral × Collateral Factor) / Total Borrows. It measures how safe your position is.

### What's a safe health factor?
- Above 1.5: Safe zone (recommended)
- 1.0 to 1.5: Caution zone
- Below 1.0: Liquidation risk!

### How do I improve my health factor?
1. Deposit more collateral
2. Repay some of your debt
3. Withdraw less when withdrawing

## Liquidation

### What is liquidation?
When your health factor drops below 1.0, anyone can repay part of your debt and receive your collateral at a discount.

### How do I avoid liquidation?
- Keep health factor above 1.5
- Monitor asset prices
- Set up alerts
- Repay debt if health factor drops

### Can I liquidate others?
Yes! Go to the Liquidate tab, enter the borrower's address, select assets, and execute. You'll receive collateral + liquidation bonus.

## Interest Rates

### How are interest rates determined?
Rates are dynamic based on utilization (borrowed / deposited). Higher utilization = higher rates.

### Do I earn interest on deposits?
Yes! Depositors earn supply APY. The rate depends on borrower demand.

### How is interest calculated?
Interest accrues per block based on the current borrow rate. Rates can change with utilization.

## AI Assistant

### How do I use the AI chat?
Click the chat icon in the bottom-right corner. Type your question and press Enter or click Send.

### What commands are available?
- `/local` - Toggle local AI mode (uses Mistral-7B)
- `/status` - Check current AI mode and server status
- `/setkey YOUR_KEY` - Set OpenAI API key
- `/clearkey` - Remove saved API key

### The AI isn't responding, what should I do?
1. Check if you have an API key set (use /status)
2. Try /local to use offline mode
3. Refresh the page and try again

## Technical Issues

### The website won't load assets
1. Make sure Hardhat node is running (npx hardhat node)
2. Make sure contracts are deployed
3. Check browser console for errors

### MetaMask shows wrong network
1. Open MetaMask settings
2. Add or switch to Hardhat Local network
3. Use Chain ID 31337

### Transactions are failing
1. Check you have enough ETH for gas
2. Make sure you approved token spending
3. Check health factor if borrowing/withdrawing
