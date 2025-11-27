/*
  Demo script (in-process) that simulates multiple relayers signing a TokensSent
  message and an aggregator submitting aggregated signatures to Gateway.receiveTokens.

  Usage (local hardhat):
    node relayer/demo.js

  It expects a running local node (hardhat) and will use the first accounts to:
  - deploy a gateway with relayers and threshold
  - deploy a MockERC20 and WrappedToken
  - set supported tokens, mint tokens to a user
  - user calls sendTokens to lock funds
  - relayers sign messageHash and aggregator submits aggregated signatures to receiveTokens
*/

require('dotenv').config();
const { ethers } = require('hardhat');
const rlpUtil = require('../test/utils/rlpValidator')(ethers);

// Simple CLI arg parsing (no external deps)
function getArg(name) {
  const prefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

const RPC_URL = getArg('rpc') || process.env.RPC_URL || 'http://127.0.0.1:8545';
const ACCOUNTS_ARG = getArg('accounts') || '0,1,2,3';
const ACCOUNT_INDEXES = ACCOUNTS_ARG.split(',').map(s => parseInt(s.trim(), 10));
// FAST_MODE can be overridden by passing options to `run(opts)` or via CLI --fast
const FAST_ARG = getArg('fast');
const CLI_FAST_MODE = FAST_ARG === '1' || FAST_ARG === 'true' || FAST_ARG === 'yes';

function prettyLog(k, v) {
  console.log(`${k.toString().padEnd(32)}: ${v}`);
}

async function run(opts = {}) {
  // If we're running under Hardhat's runtime (npx hardhat run), prefer its helpers
  let provider;
  let deployer, user, relayer1, relayer2;
  let deployerAddr, userAddr, relayer1Addr, relayer2Addr;
  if (typeof ethers.getSigners === 'function') {
    // Hardhat environment: use ethers.getSigners()
    const signers = await ethers.getSigners();
    deployer = signers[0];
    user = signers[1] || signers[0];
    relayer1 = signers[2] || signers[0];
    relayer2 = signers[3] || signers[0];
    deployerAddr = await deployer.getAddress();
    userAddr = await user.getAddress();
    relayer1Addr = await relayer1.getAddress();
    relayer2Addr = await relayer2.getAddress();
    provider = ethers.provider;
  } else {
    // Plain node/runtime: construct a JsonRpcProvider and use RPC-unlocked signers
    provider = new ethers.JsonRpcProvider(RPC_URL);
    // get the node accounts (addresses) and map requested indexes to those addresses
    const nodeAccounts = await provider.listAccounts();
    const requested = ACCOUNT_INDEXES.map(i => (Number.isInteger(i) ? i : 0));
    // prefer numeric index signers (provider.getSigner(index)) which behave consistently
    const indexFor = (idx) => (requested[idx] ?? idx) || 0;
    const deployerIndex = indexFor(0);
    const userIndex = indexFor(1);
    const relayer1Index = indexFor(2);
    const relayer2Index = indexFor(3);

    deployer = provider.getSigner(deployerIndex);
    user = provider.getSigner(userIndex);
    relayer1 = provider.getSigner(relayer1Index);
    relayer2 = provider.getSigner(relayer2Index);

    deployerAddr = nodeAccounts[deployerIndex] || nodeAccounts[0];
    userAddr = nodeAccounts[userIndex] || nodeAccounts[1] || nodeAccounts[0];
    relayer1Addr = nodeAccounts[relayer1Index] || nodeAccounts[2] || nodeAccounts[0];
    relayer2Addr = nodeAccounts[relayer2Index] || nodeAccounts[3] || nodeAccounts[0];
  }

  const relayers = [relayer1Addr, relayer2Addr];
  const signatureThreshold = 2;

  // compute effective fast mode: opts.fast -> CLI flag -> false
  const FAST_MODE = Boolean(opts && opts.fast) || CLI_FAST_MODE || false;

  // helper to optionally wait for tx confirmations with timeout and retries
  async function maybeWait(tx, options = {}) {
    if (!tx) return tx;
    const timeoutMs = options.timeoutMs || 60000;
    const retries = typeof options.retries === 'number' ? options.retries : 1;
    if (FAST_MODE) return tx;

    let attempt = 0;
    while (true) {
      try {
          // prefer tx.wait() which works with ethers ContractTransaction
          if (tx && typeof tx.wait === 'function') {
            await tx.wait();
          } else {
            // fallback: wait for tx hash to be mined via provider if available
            if (provider && tx && tx.hash) {
              await provider.pollingWaitForTransaction
                ? await provider.pollingWaitForTransaction(tx.hash, timeoutMs)
                : null;
            }
          }
        return tx;
      } catch (e) {
        attempt += 1;
        console.error(`maybeWait: attempt ${attempt} failed for tx ${tx.hash}`, e && e.message ? e.message : e);
        if (attempt > retries) throw e;
        // small backoff before retrying
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  const Gateway = await ethers.getContractFactory('Gateway');
  const gateway = await Gateway.connect(deployer).deploy(deployerAddr, relayers, signatureThreshold);
  await gateway.waitForDeployment();
  prettyLog('Gateway deployed', gateway.target);

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const token = await MockERC20.connect(deployer).deploy('Demo Token', 'DMT');
  await token.waitForDeployment();
  prettyLog('Mock token deployed', token.target);

  const WrappedToken = await ethers.getContractFactory('WrappedToken');
  const wrapped = await WrappedToken.connect(deployer).deploy('Wrapped DMT', 'wDMT', gateway.target);
  await wrapped.waitForDeployment();
  prettyLog('Wrapped token deployed', wrapped.target);

  const network = await provider.getNetwork();
  // normalize chainId to a Number to avoid mixing BigInt and Number types
  const chainId1 = Number(network.chainId);
  const chainId2 = chainId1 + 1;

  await gateway.connect(deployer).setGateway(chainId2, gateway.target);
  await gateway.connect(deployer).setGateway(chainId1, gateway.target);
  await gateway.connect(deployer).setSupportedToken(token.target, true, wrapped.target);

  // mint some tokens to user
  await token.connect(deployer).mint(await user.getAddress(), ethers.parseEther('100'));
  prettyLog('minted tokens to user', await user.getAddress());

  // user approves gateway and sends tokens
  await token.connect(user).approve(gateway.target, ethers.parseEther('10'));
  prettyLog('user approved gateway', await user.getAddress());
  const tx = await gateway.connect(user).sendTokens(token.target, ethers.parseEther('10'), chainId2);
  await maybeWait(tx);
  prettyLog('user called sendTokens tx', tx.hash);

  // construct messageHash same as contracts
  const messageHash = ethers.keccak256(ethers.solidityPacked([
    'address','address','uint256','uint256','string'
  ], [await user.getAddress(), token.target, ethers.parseEther('10'), chainId1, 'receive']));

  // relayers sign
  const sig1 = await relayer1.signMessage(ethers.getBytes(messageHash));
  const sig2 = await relayer2.signMessage(ethers.getBytes(messageHash));
  prettyLog('relayers signed', `${sig1.slice(0,10)}... ${sig2.slice(0,10)}...`);

  // aggregator submits directly
  // When running under Hardhat runtime prefer the Signer objects from getSigners()
  const aggSigner = (typeof ethers.getSigners === 'function') ? deployer : provider.getSigner(0);
  const gatewayAsAgg = gateway.connect(aggSigner);

  const receiveTx = await gatewayAsAgg.receiveTokens(await user.getAddress(), token.target, ethers.parseEther('10'), chainId1, [sig1, sig2]);
  await maybeWait(receiveTx);
  prettyLog('receiveTokens executed', receiveTx.hash);

  const balanceWrapped = await wrapped.balanceOf(await user.getAddress());
  prettyLog('user wrapped balance', ethers.formatEther(balanceWrapped));

  // --- Merkle batch proof demo ---
  // We'll create multiple sendTokens events/messages, build a batched merkle tree of
  // minimal RLP-style receipts (prefix 0xc0 + messageHash), submit the receiptsRoot
  // to the light client, and then submit proofs for each receipt to the Gateway.
  const amounts = [ethers.parseEther('1'), ethers.parseEther('2'), ethers.parseEther('3')];

  // Deploy a LightClientMerkle (owner = deployer)
  const LightClientMerkle = await ethers.getContractFactory('LightClientMerkle');
  const lc = await LightClientMerkle.connect(deployer).deploy();
  await lc.waitForDeployment();
  prettyLog('LightClientMerkle deployed', lc.target);

  // For each amount, call sendTokens to simulate messages being emitted on source chain.
  const receipts = [];
  for (let i = 0; i < amounts.length; i++) {
    const a = amounts[i];
    await token.connect(user).approve(gateway.target, a);
    const tx = await gateway.connect(user).sendTokens(token.target, a, chainId2);
    await maybeWait(tx);

    // Build the same packed message and then a minimal RLP-like receipt
    const messageHash = ethers.keccak256(ethers.solidityPacked([
      'address','address','uint256','uint256','string','bytes32'
    ], [await user.getAddress(), token.target, a, chainId1, 'receive_proof', ethers.ZeroHash]));

    const receiptRLP = rlpUtil.makeReceiptRLP(messageHash);
    const leaf = ethers.keccak256(receiptRLP);
    receipts.push({ receiptRLP, leaf });
  prettyLog('prepared receipt for amount', ethers.formatEther(a));
  }
  const leaves = receipts.map(r => r.leaf);
  prettyLog('building merkle from leaves', leaves.length);
  const { root, proofs, paths } = rlpUtil.buildMerkle(leaves);

  // Build and show merkle root
  prettyLog('merkle root', root);

  // Submit receiptsRoot to light client (owner = deployer)
  const headerId = root;
  try {
    const headerTx = await lc.connect(deployer).submitHeader(headerId, root);
    await maybeWait(headerTx);
    prettyLog('submitted header/receiptsRoot to light client tx', headerTx.hash);
  } catch (err) {
    console.error('submitHeader failed', err);
    throw err;
  }

  // For each receipt, submit a proof to Gateway and collect results
  const proofsSubmitted = [];
  for (let i = 0; i < receipts.length; i++) {
    const { receiptRLP, leaf } = receipts[i];
    const siblings = proofs[i];
    const path = paths[i];
    const proofEncoded = new ethers.AbiCoder().encode(['bytes','bytes32[]','bytes'], [receiptRLP, siblings, path]);
    const amount = amounts[i];
    // convert path (Uint8Array) to hex for clearer logging
    const pathHex = (paths[i] && paths[i].length) ? ethers.hexlify(paths[i]) : '0x';
    prettyLog(`submitting proof ${i}`, `leaf=${leaf} amount=${ethers.formatEther(amount)} path=${pathHex} siblings=${siblings.length}`);
    try {
      const proofTx = await gatewayAsAgg.receiveTokensWithProof(await user.getAddress(), token.target, amount, chainId1, headerId, proofEncoded, lc.target);
      await maybeWait(proofTx, { timeoutMs: opts.timeoutMs || 60000, retries: opts.retries || 1 });
      prettyLog(`submitted proof ${i} tx`, proofTx.hash);
      proofsSubmitted.push({ index: i, leaf, path: pathHex, txHash: proofTx.hash, amount: ethers.formatEther(amount) });
    } catch (err) {
      console.error(`proof submit ${i} failed`, err && err.message ? err.message : err);
      proofsSubmitted.push({ index: i, leaf, path: pathHex, error: err && err.message ? err.message : String(err) });
    }
  }

  const finalBalance = await wrapped.balanceOf(await user.getAddress());
  prettyLog('user wrapped balance after batch merkle', ethers.formatEther(finalBalance));

  // Return a structured summary for programmatic use
  return {
    gateway: gateway.target,
    token: token.target,
    wrapped: wrapped.target,
    lightClient: lc.target,
    receiptsRoot: root,
    proofsSubmitted,
    finalBalance: ethers.formatEther(finalBalance)
  };
}

// Export run for programmatic use in tests. When executed directly, run with CLI-derived options.
module.exports = { run };

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}
