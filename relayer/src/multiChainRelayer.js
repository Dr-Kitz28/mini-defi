/*
 Multi-chain relayer (EVM-first) with adapter slots for BTC and Cosmos.
 - Watches GatewayV3 events on all configured EVM chains
 - Aggregates signatures off-chain
 - Submits mintWrapped / executeMessage on destination chain once quorum signatures are collected
*/
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

const config = JSON.parse(
  fs.readFileSync(__dirname + "/../multi-chain.config.json", "utf8")
);
const ABI = JSON.parse(
  fs.readFileSync(__dirname + "/../abi/GatewayV3.json", "utf8")
);

const relayerPk = process.env.RELAYER_PK;
if (!relayerPk) throw new Error("Missing RELAYER_PK");

const wallets = {};
const providers = {};

for (const [name, net] of Object.entries(config.evm)) {
  providers[name] = new ethers.JsonRpcProvider(net.rpcUrl);
  wallets[name] = new ethers.Wallet(relayerPk, providers[name]);
}

function hashMessage(fromChainId, toChainId, sender, target, data, value) {
  const domainTypeHash = ethers.keccak256(
    ethers.toUtf8Bytes(
      "CrossChainMessage(uint256 nonce,uint256 fromChainId,uint256 toChainId,address sender,address target,bytes data,uint256 value)"
    )
  );
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "address",
        "bytes32",
        "uint256",
      ],
      [
        domainTypeHash,
        0,
        fromChainId,
        toChainId,
        sender,
        target,
        ethers.keccak256(data),
        value,
      ]
    )
  );
}

function hashToken(
  nonce,
  fromChainId,
  toChainId,
  sender,
  token,
  recipient,
  amount
) {
  const tokenTypeHash = ethers.keccak256(
    ethers.toUtf8Bytes(
      "TokenTransfer(uint256 nonce,uint256 fromChainId,uint256 toChainId,address sender,address token,address recipient,uint256 amount)"
    )
  );
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "address",
        "address",
        "uint256",
      ],
      [
        tokenTypeHash,
        nonce,
        fromChainId,
        toChainId,
        sender,
        token,
        recipient,
        amount,
      ]
    )
  );
}

const pending = {}; // in-memory cache (kept for runtime use)

// Ensure a simple on-disk pending directory exists so separate relayer
// processes can share signatures (very small demo coordinator).
const PENDING_DIR = __dirname + '/../pending';
try { require('fs').mkdirSync(PENDING_DIR, { recursive: true }); } catch (e) {}

// leader election and locks live in the same directory; TTL for leader in ms
const LEADER_TTL = (config.leaderTtlSeconds || 10) * 1000;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function leaderFile(dstName) {
  return `${PENDING_DIR}/leader-${dstName}.json`;
}

function lockFile(hash) {
  const id = String(hash).replace(/^0x/, '');
  return `${PENDING_DIR}/lock-${id}.lock`;
}

function tryElectLeader(dstName, myAddr) {
  const p = leaderFile(dstName);
  try {
    if (fs.existsSync(p)) {
      const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cur.expires > Date.now()) {
        // leader still valid
        return cur.leader === myAddr;
      }
    }
  } catch (e) {
    // ignore
  }
  // attempt to become leader by writing file (race possible but acceptable for demo)
  const obj = { leader: myAddr, expires: Date.now() + LEADER_TTL };
  try {
    fs.writeFileSync(p, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

function refreshLeader(dstName, myAddr) {
  const p = leaderFile(dstName);
  try {
    const obj = { leader: myAddr, expires: Date.now() + LEADER_TTL };
    fs.writeFileSync(p, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

function tryAcquireLock(hash, owner) {
  const p = lockFile(hash);
  try {
    // create file exclusively; fail if exists
    const fd = fs.openSync(p, 'wx');
    fs.writeSync(fd, JSON.stringify({ owner, ts: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    return false;
  }
}

function releaseLock(hash) {
  const p = lockFile(hash);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { }
}

async function start() {
  for (const [name, net] of Object.entries(config.evm)) {
    const wallet = wallets[name];
    const gw = new ethers.Contract(net.gateway, ABI, wallet);

    gw.on(
      "TokensLocked",
      async (sender, token, amount, toChainId, recipient, nonce, evt) => {
        // Determine actual source chain id from the provider (handles single-node demo
        // where multiple configured networks share a single RPC).
        const networkInfo = await wallet.provider.getNetwork();
        const actualFromChainId = Number(networkInfo.chainId);
        const msgHash = hashToken(
          Number(nonce),
          actualFromChainId,
          Number(toChainId),
          sender,
          token,
          recipient,
          amount
        );
        const sig = await wallet.signMessage(ethers.getBytes(msgHash));
        storeSig(msgHash, sig, {
          kind: "token",
          toChainId: Number(toChainId),
          fromName: name,
          fromChainId: actualFromChainId,
          fromAddress: sender,
          srcTx: evt.log.transactionHash,
          recipient,
          amount: amount.toString(),
          token,
        });
        await trySubmit(msgHash);
      }
    );

    gw.on(
      "MessageSent",
      async (sender, toChainId, target, data, value, nonce, evt) => {
        const networkInfo = await wallet.provider.getNetwork();
        const actualFromChainId = Number(networkInfo.chainId);
        const msgHash = hashMessage(
          actualFromChainId,
          Number(toChainId),
          sender,
          target,
          data,
          value
        );
        const sig = await wallet.signMessage(ethers.getBytes(msgHash));
        storeSig(msgHash, sig, {
          kind: "message",
          toChainId: Number(toChainId),
          fromName: name,
          fromChainId: actualFromChainId,
          fromAddress: sender,
          srcTx: evt.log.transactionHash,
          target,
          data,
          value: value.toString(),
        });
        await trySubmit(msgHash);
      }
    );

    console.log(`[${name}] listening at ${net.gateway}`);
  }
}

function sigFilePath(hash) {
  // normalize filename (remove 0x)
  const id = String(hash).replace(/^0x/, '');
  return `${PENDING_DIR}/${id}.json`;
}

function storeSig(hash, sig, meta) {
  // update in-memory cache
  if (!pending[hash]) pending[hash] = { sigs: new Set(), meta };
  pending[hash].sigs.add(sig);

  // persist to disk so other relayer processes can pick up the sig
  const p = sigFilePath(hash);
  let disk = { sigs: [], meta };
  try {
    if (fs.existsSync(p)) {
      disk = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.error('[storeSig] read error', e);
  }
  disk.meta = disk.meta || meta;
  if (!disk.sigs.includes(sig)) disk.sigs.push(sig);
  try {
    fs.writeFileSync(p, JSON.stringify(disk));
  } catch (e) {
    console.error('[storeSig] write error', e);
  }
}

async function trySubmit(hash) {
  // read from disk (coordinator) if present, otherwise from in-memory
  const p = sigFilePath(hash);
  let entry = pending[hash];
  try {
    if (fs.existsSync(p)) {
      const disk = JSON.parse(fs.readFileSync(p, 'utf8'));
      // convert to in-memory shape
      entry = { sigs: new Set(disk.sigs || []), meta: disk.meta };
      pending[hash] = entry;
    }
  } catch (e) {
    console.error('[trySubmit] read error', e);
  }
  if (!entry) return;

  const required = config.signatureThreshold || 2;
  if ((entry.sigs && entry.sigs.size ? entry.sigs.size : (Array.isArray(entry.sigs) ? entry.sigs.length : 0)) < required) return;

  const dstName = Object.entries(config.evm).find(
    ([, n]) => Number(n.chainId) === Number(entry.meta.toChainId)
  )?.[0];
  if (!dstName) return;

  const wallet = wallets[dstName];
  const gwAddr = config.evm[dstName].gateway;
  const gw = new ethers.Contract(gwAddr, ABI, wallet);

  const sigs = Array.from(entry.sigs instanceof Set ? entry.sigs : new Set(entry.sigs));

  // Hybrid coordination:
  // 1) elect a leader per-destination (file-based TTL). Only leader attempts on-chain submit.
  // 2) acquire an exclusive per-message lock (file) to avoid duplicate submits.
  // 3) optional on-chain preclaim attempt (if gateway exposes a preclaim function).
  // 4) randomized small delay and exponential backoff on failures.

  const myAddr = wallet.address;
  // try to become leader for this destination
  const iAmLeader = tryElectLeader(dstName, myAddr);
  if (!iAmLeader) {
    // not leader; refresh leader file TTL and return (we only sign)
    // attempt a best-effort refresh if we're the current leader
    return;
  }

  // leader will try to acquire per-message lock to be the submitter
  const acquired = tryAcquireLock(hash, myAddr);
  if (!acquired) {
    // someone else is already submitting
    return;
  }

  // randomized submit delay to reduce tight races (100-500ms)
  const jitter = 100 + Math.floor(Math.random() * 400);
  await sleep(jitter);

  // optional preclaim step: try calling gateway.preclaimSubmit(hash) if available
  try {
    try {
      // this will throw if function not in ABI
      const frag = gw.interface.getFunction('preclaimSubmit');
      if (frag) {
        try {
          const tx = await gw.preclaimSubmit(hash, { gasLimit: 50_000 });
          console.log(`[preclaim][${dstName}] preclaim tx: ${tx.hash}`);
        } catch (e) {
          // ignore preclaim failures (non-fatal for demo)
          console.log(`[preclaim][${dstName}] preclaim failed or reverted (${e.message || e})`);
        }
      }
    } catch (e) {
      // getFunction threw -> no preclaim; ignore
    }
  } catch (e) {
    // swallow any preclaim error
  }

  // perform submit with retries
  const maxAttempts = config.submitMaxAttempts || 4;
  let attempt = 0;
  let success = false;
  let lastErr = null;
  while (attempt < maxAttempts && !success) {
    attempt += 1;
    try {
      // refresh leader TTL so other processes know we're alive
      refreshLeader(dstName, myAddr);

      if (entry.meta.kind === "token") {
        const wrapped =
          (config.evm[dstName].wrappedTokenMap &&
            config.evm[dstName].wrappedTokenMap[entry.meta.token]) ||
          config.evm[dstName].defaultWrappedToken;

        const opts = { gasLimit: 2_000_000 };
        if (config.submitGasMultiplier) {
          opts.gasLimit = Math.floor(opts.gasLimit * config.submitGasMultiplier);
        }
        const tx = await gw.mintWrapped(
          wrapped,
          entry.meta.recipient,
          entry.meta.amount,
          hash,
          sigs,
          opts
        );
        console.log(`[submit][${dstName}] mintWrapped tx: ${tx.hash}`);
      } else if (entry.meta.kind === "message") {
        const fromChainId = Number(entry.meta.fromChainId || entry.meta.toChainId);
        const senderAddr = entry.meta.fromAddress || ethers.ZeroAddress;
        const opts = { gasLimit: 3_000_000 };
        if (config.submitGasMultiplier) {
          opts.gasLimit = Math.floor(opts.gasLimit * config.submitGasMultiplier);
        }
        const tx = await gw.executeMessage(
          fromChainId,
          senderAddr,
          entry.meta.target,
          entry.meta.data,
          entry.meta.value,
          hash,
          sigs,
          opts
        );
        console.log(`[submit][${dstName}] executeMessage tx: ${tx.hash}`);
      }

      success = true;
      // cleanup
      delete pending[hash];
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ }
      releaseLock(hash);
      // done
      break;
    } catch (e) {
      lastErr = e;
      console.error(`[submit][${dstName}] attempt ${attempt} error`, e && e.message ? e.message : e);
      // on-chain revert or RPC errors should be retried with backoff
      const backoff = 200 * Math.pow(2, attempt - 1);
      await sleep(backoff);
      // continue to next attempt
    }
  }

  if (!success) {
    console.error(`[submit][${dstName}] failed after ${attempt} attempts`, lastErr);
    // release lock so others can try later
    releaseLock(hash);
  }
}

// ----- Placeholders for BTC & Cosmos adapters -----
// A real BTC adapter would watch a multisig address and produce a sourceTxHash,
// then call mintWrapped on an EVM chain with relayer signatures after enough confirmations.
async function startBitcoinAdapter() {
  if (!config.bitcoin) return;
  console.log(
    "[btc] adapter placeholder initialized (implement SPV + tSS MPC in production)."
  );
}

// A real Cosmos adapter would watch IBC events or use a relayer process to bring proofs.
async function startCosmosAdapter() {
  if (!config.cosmos) return;
  console.log(
    "[cosmos] adapter placeholder initialized (use IBC light clients/relayer)."
  );
}

start()
  .then(startBitcoinAdapter)
  .then(startCosmosAdapter)
  .catch(console.error);
