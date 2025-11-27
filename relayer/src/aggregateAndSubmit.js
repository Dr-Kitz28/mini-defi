/**
 * Simple aggregator example for local testing
 * - Accepts POSTs at /submit-signature (if you run this aggregator as an express server)
 * - Collects signatures per messageHash until threshold and then submits aggregated
 *   signature array to a destination Gateway contract's receiveTokens/receiveMessage
 *
 * This file contains a helper that can be used programmatically; a minimal express
 * server isn't included here to keep the scaffold small, but a usage example is
 * described in README.
 */

require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const AGGREGATOR_PRIVATE_KEY = process.env.AGGREGATOR_PRIVATE_KEY;
const DEST_GATEWAY = process.env.DEST_GATEWAY_ADDRESS;
const SIGNATURE_THRESHOLD = Number(process.env.SIGNATURE_THRESHOLD || 2);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const aggWallet = AGGREGATOR_PRIVATE_KEY ? new ethers.Wallet(AGGREGATOR_PRIVATE_KEY, provider) : null;

const gatewayAbi = [
  'function receiveTokens(address originalSender, address originalToken, uint256 amount, uint256 fromChainId, bytes[] calldata signatures) external',
  'function receiveMessage(address target, bytes calldata payload, uint256 fromChainId, bytes[] calldata signatures) external'
];

const pending = {}; // messageHash => { signatures: [], signers: Set }

function addSignature(messageHash, signature, relayer) {
  if (!pending[messageHash]) pending[messageHash] = { signatures: [], signers: new Set() };
  if (pending[messageHash].signers.has(relayer)) return false; // duplicate
  pending[messageHash].signatures.push(signature);
  pending[messageHash].signers.add(relayer);
  return true;
}

async function trySubmit(messageHash, meta) {
  const entry = pending[messageHash];
  if (!entry) return;
  if (entry.signatures.length < SIGNATURE_THRESHOLD) return;
  if (!aggWallet) {
    console.log('Aggregator wallet not configured; signatures ready:', entry.signatures.length);
    return;
  }

  const gateway = new ethers.Contract(DEST_GATEWAY, gatewayAbi, aggWallet);

  try {
    if (meta && meta.type === 'receive') {
      // meta: { originalSender, originalToken, amount, fromChainId }
      const tx = await gateway.receiveTokens(meta.originalSender, meta.originalToken, meta.amount, meta.fromChainId, entry.signatures);
      await tx.wait();
      console.log('receiveTokens tx mined', tx.hash);
    } else if (meta && meta.type === 'message') {
      // meta: { target, payload, fromChainId }
      const tx = await gateway.receiveMessage(meta.target, meta.payload, meta.fromChainId, entry.signatures);
      await tx.wait();
      console.log('receiveMessage tx mined', tx.hash);
    } else {
      console.log('Unknown meta type — signatures collected:', entry.signatures.length);
    }
  } catch (err) {
    console.error('submit failed', err);
  }

  delete pending[messageHash];
}

module.exports = { addSignature, trySubmit };
