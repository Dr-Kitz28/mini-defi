/*
  Minimal relayer skeleton for the Gateway PoC
  - listens for TokensSent and MessageSent events on a configured Gateway
  - builds the messageHash the contracts expect
  - signs the messageHash using the relayer private key
  - prints the signature (or optionally POSTs it to an aggregator)

  Usage:
    - copy .env.example -> .env and fill values
    - npm install
    - npm start
*/

require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const DEST_GATEWAY = process.env.DEST_GATEWAY_ADDRESS;
const AGGREGATOR_URL = process.env.AGGREGATOR_URL; // optional HTTP endpoint to POST signatures

if (!RELAYER_PRIVATE_KEY) {
  console.error('Please set RELAYER_PRIVATE_KEY in .env');
  process.exit(1);
}
if (!DEST_GATEWAY) console.warn('DEST_GATEWAY_ADDRESS is not set — relayer will still sign but not auto-submit.');

const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);

// Minimal ABI: events used by Gateway
const gatewayAbi = [
  'event TokensSent(address indexed user, address indexed token, uint256 amount, uint256 toChainId)',
  'event MessageSent(address indexed sender, uint256 toChainId, bytes payload)'
];

async function main() {
  const gatewayAddress = DEST_GATEWAY; // in this PoC we listen on a single gateway
  if (!gatewayAddress) {
    console.log('No gateway address configured — using first deployed Gateway from local environment is recommended.');
  }

  const gateway = new ethers.Contract(gatewayAddress || ethers.ZeroAddress, gatewayAbi, provider);

  console.log('Relayer wallet:', relayerWallet.address);

  // Listen for TokensSent events
  gateway.on('TokensSent', async (user, token, amount, toChainId, event) => {
    try {
      console.log('\nTokensSent event detected:');
      console.log(' user', user);
      console.log(' token', token);
      console.log(' amount', amount.toString());
      console.log(' toChainId', toChainId.toString());

      const messageHash = ethers.keccak256(ethers.solidityPack([
        'address', 'address', 'uint256', 'uint256', 'string'
      ], [user, token, amount, event.blockNumber /* use block as demo field */, 'receive']));

      // sign the raw messageHash (we sign the bytes so ethers will add the prefix for us)
      const signature = await relayerWallet.signMessage(ethers.getBytes(messageHash));
      console.log(' signature:', signature);

      if (AGGREGATOR_URL) {
        try {
          await axios.post(AGGREGATOR_URL + '/submit-signature', {
            messageHash,
            signature,
            relayer: relayerWallet.address
          });
          console.log('signature posted to aggregator');
        } catch (err) {
          console.warn('failed posting signature to aggregator', err?.message || err);
        }
      }
    } catch (err) {
      console.error('TokensSent handler error', err);
    }
  });

  // Listen for MessageSent events
  gateway.on('MessageSent', async (sender, toChainId, payload, event) => {
    try {
      console.log('\nMessageSent event detected:');
      console.log(' sender', sender);
      console.log(' toChainId', toChainId.toString());

      // Build messageHash for message execution path
      const messageHash = ethers.keccak256(ethers.solidityPack([
        'address', 'bytes', 'uint256', 'string'
      ], [sender, payload, event.blockNumber, 'message']));

      const signature = await relayerWallet.signMessage(ethers.getBytes(messageHash));
      console.log(' signature:', signature);

      if (AGGREGATOR_URL) {
        try {
          await axios.post(AGGREGATOR_URL + '/submit-signature', {
            messageHash,
            signature,
            relayer: relayerWallet.address
          });
          console.log('signature posted to aggregator');
        } catch (err) {
          console.warn('failed posting signature to aggregator', err?.message || err);
        }
      }
    } catch (err) {
      console.error('MessageSent handler error', err);
    }
  });

  console.log('Listening for events — press Ctrl+C to exit');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
