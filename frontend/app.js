const logEl = document.getElementById("log");
const accountInfoEl = document.getElementById("accountInfo");
const statsEl = document.getElementById("stats");

let provider;
let signer;
let account;
let pool;
let token;
let tokenDecimals = 18;
let configData = null;

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

const POOL_ABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function borrow(uint256 amount)",
  "function repay(uint256 amount)",
  "function repayAll()",
  "function liquidate(address borrower, uint256 repayAmount)",
  "function maxBorrowable(address user) view returns (uint256)",
  "function currentDebt(address user) view returns (uint256)",
  "function deposits(address user) view returns (uint256)",
  "function totalDeposits() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function utilization() view returns (uint256)",
  "function irm() view returns (address)"
];

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const IRM_ABI = [
  "function getBorrowRatePerSecond(uint256 utilization) view returns (uint256)",
  "function currentAPR() view returns (uint256)",
  "function baseAPR() view returns (uint256)",
  "function slopeAPR() view returns (uint256)",
  "function slopeLowAPR() view returns (uint256)",
  "function slopeHighAPR() view returns (uint256)"
];

function log(message) {
  const now = new Date().toLocaleTimeString();
  logEl.textContent = `[${now}] ${message}\n` + logEl.textContent;
}

async function loadConfig() {
  try {
    const response = await fetch("config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Config fetch failed");
    configData = await response.json();
    log("Loaded config.json");
    const chainId = configData.defaultChainId;
    if (chainId) {
      applyConfigAddresses(chainId);
    }
  } catch (error) {
    log("Optional config.json not found or unreadable. Fill addresses manually or add the file.");
  }
}

function applyConfigAddresses(chainId) {
  if (!configData?.networks) return;
  const entry = configData.networks[String(chainId)];
  if (!entry) return;
  if (entry.pool) {
    document.getElementById("poolAddress").value = entry.pool;
  }
  if (entry.token) {
    document.getElementById("tokenAddress").value = entry.token;
  }
  log(`Applied addresses for chain ${chainId} from config`);
}

async function connectWallet() {
  if (!window.ethereum) {
    log("No wallet detected. Install MetaMask or a compatible wallet.");
    return;
  }

  provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  account = accounts[0];
  signer = await provider.getSigner();

  accountInfoEl.textContent = `Connected: ${account}`;
  try {
    const network = await provider.getNetwork();
    applyConfigAddresses(network.chainId.toString());
  } catch (error) {
    log("Unable to read network information.");
  }
  log("Wallet connected.");
}

async function ensureContracts() {
  if (!signer) {
    throw new Error("Connect your wallet first.");
  }

  const poolAddress = document.getElementById("poolAddress").value.trim();
  const tokenAddress = document.getElementById("tokenAddress").value.trim();

  if (!ethers.isAddress(poolAddress) || !ethers.isAddress(tokenAddress)) {
    throw new Error("Enter valid pool and token addresses.");
  }

  const signerAddress = await signer.getAddress();
  if (!pool || (await pool.getAddress()) !== poolAddress) {
    pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
    log(`Loaded pool @ ${poolAddress}`);
  }

  if (!token || (await token.getAddress()) !== tokenAddress) {
    token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    tokenDecimals = await token.decimals();
    log(`Loaded token @ ${tokenAddress}`);
  }

  return { signerAddress };
}

function parseAmountInput(elementId) {
  const raw = document.getElementById(elementId).value.trim();
  if (!raw) {
    throw new Error("Enter an amount first.");
  }
  if (Number(raw) <= 0) {
    throw new Error("Amount must be positive.");
  }
  return ethers.parseUnits(raw, tokenDecimals);
}

async function withTx(action, description) {
  try {
    log(`${description} ...`);
    const tx = await action();
    const receipt = await tx.wait();
    log(`${description} confirmed in block ${receipt.blockNumber}`);
    await refreshStats();
  } catch (error) {
    console.error(error);
    if (error?.info?.error?.data?.message) {
      log(`Error: ${error.info.error.data.message}`);
    } else {
      log(`Error: ${error.message}`);
    }
  }
}

async function handleDeposit() {
  const { signerAddress } = await ensureContracts();
  const amount = parseAmountInput("depositAmount");
  const poolAddress = await pool.getAddress();

  await withTx(async () => {
    const allowance = await token.allowance(signerAddress, poolAddress);
    if (allowance < amount) {
      await (await token.approve(poolAddress, amount)).wait();
      log("Approval completed.");
    }
    return pool.deposit(amount);
  }, "Deposit submitted");
}

async function handleWithdraw() {
  await ensureContracts();
  const amount = parseAmountInput("withdrawAmount");
  await withTx(() => pool.withdraw(amount), "Withdraw submitted");
}

async function handleBorrow() {
  await ensureContracts();
  const amount = parseAmountInput("borrowAmount");
  await withTx(() => pool.borrow(amount), "Borrow submitted");
}

async function handleRepay() {
  const { signerAddress } = await ensureContracts();
  const amount = parseAmountInput("repayAmount");
  const poolAddress = await pool.getAddress();

  await withTx(async () => {
    const allowance = await token.allowance(signerAddress, poolAddress);
    if (allowance < amount) {
      await (await token.approve(poolAddress, amount)).wait();
      log("Approval completed.");
    }
    return pool.repay(amount);
  }, "Repay submitted");
}

async function handleRepayAll() {
  const { signerAddress } = await ensureContracts();
  const poolAddress = await pool.getAddress();
  const debt = await pool.currentDebt(signerAddress);
  if (debt === 0n) {
    log("Nothing to repay.");
    return;
  }

  await withTx(async () => {
    const allowance = await token.allowance(signerAddress, poolAddress);
    if (allowance < debt) {
      await (await token.approve(poolAddress, debt)).wait();
      log("Approval completed.");
    }
    return pool.repayAll();
  }, "Repay all submitted");
}

async function handleLiquidate() {
  const { signerAddress } = await ensureContracts();
  const borrower = document.getElementById("liquidateAddress").value.trim();
  if (!ethers.isAddress(borrower)) {
    throw new Error("Enter a valid borrower address.");
  }
  const amount = parseAmountInput("liquidateAmount");
  const poolAddress = await pool.getAddress();

  await withTx(async () => {
    const allowance = await token.allowance(signerAddress, poolAddress);
    if (allowance < amount) {
      await (await token.approve(poolAddress, amount)).wait();
      log("Approval completed.");
    }
    return pool.liquidate(borrower, amount);
  }, "Liquidation submitted");
}

async function refreshStats() {
  try {
    const { signerAddress } = await ensureContracts();
    const [deposit, debt, maxBorrow, totalDeposits, totalBorrows, liquidity, balance, symbol, util, irmAddress] =
      await Promise.all([
        pool.deposits(signerAddress),
        pool.currentDebt(signerAddress),
        pool.maxBorrowable(signerAddress),
        pool.totalDeposits(),
        pool.totalBorrows(),
        pool.availableLiquidity(),
        token.balanceOf(signerAddress),
        token.symbol(),
        pool.utilization(),
        pool.irm()
      ]);

    const format = (bn) => ethers.formatUnits(bn, tokenDecimals);
    const formatPercent = (bn) => (Number(ethers.formatUnits(bn, 18)) * 100).toFixed(2);
    const rateModel = new ethers.Contract(irmAddress, IRM_ABI, signer.provider ?? provider);

    let borrowRatePerSecond = 0n;
    try {
      borrowRatePerSecond = await rateModel.getBorrowRatePerSecond(util);
    } catch (err) {
      console.warn("Unable to fetch borrow rate", err);
    }

    const borrowAPR = borrowRatePerSecond * SECONDS_PER_YEAR;

    let adaptiveAPR = null;
    try {
      adaptiveAPR = await rateModel.currentAPR();
    } catch (_) {
      adaptiveAPR = null;
    }
    let aprLabel;
    if (borrowRatePerSecond === 0n && adaptiveAPR === null) {
      aprLabel = "0.00% (idle)";
    } else if (adaptiveAPR !== null) {
      aprLabel = `${(Number(ethers.formatUnits(adaptiveAPR, 18)) * 100).toFixed(2)}% (adaptive)`;
    } else {
      aprLabel = `${(Number(ethers.formatUnits(borrowAPR, 18)) * 100).toFixed(2)}% (variable)`;
    }

    statsEl.innerHTML = `
<strong>Token:</strong> ${symbol}<br />
<strong>Your balance:</strong> ${format(balance)} ${symbol}<br />
<strong>Your deposits:</strong> ${format(deposit)} ${symbol}<br />
<strong>Your debt:</strong> ${format(debt)} ${symbol}<br />
<strong>Max you can borrow:</strong> ${format(maxBorrow)} ${symbol}<br />
<strong>Pool deposits:</strong> ${format(totalDeposits)} ${symbol}<br />
<strong>Pool borrows:</strong> ${format(totalBorrows)} ${symbol}<br />
<strong>Available liquidity:</strong> ${format(liquidity)} ${symbol}<br />
<strong>Utilization:</strong> ${formatPercent(util)}%<br />
<strong>Borrow APR:</strong> ${aprLabel}`;
  } catch (error) {
    console.error(error);
    statsEl.textContent = error.message;
  }
}

function bootstrap() {
  loadConfig();
  document.getElementById("connectWallet").addEventListener("click", connectWallet);
  document.getElementById("depositBtn").addEventListener("click", () => handleDeposit());
  document.getElementById("withdrawBtn").addEventListener("click", () => handleWithdraw());
  document.getElementById("borrowBtn").addEventListener("click", () => handleBorrow());
  document.getElementById("repayBtn").addEventListener("click", () => handleRepay());
  document.getElementById("repayAllBtn").addEventListener("click", () => handleRepayAll());
  document.getElementById("liquidateBtn").addEventListener("click", () => handleLiquidate());
  document.getElementById("refreshStats").addEventListener("click", () => refreshStats());
  log("Ready. Connect your wallet to begin.");
}

document.addEventListener("DOMContentLoaded", bootstrap);
