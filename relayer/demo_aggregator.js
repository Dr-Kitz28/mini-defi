/*
 Simple single-process demo aggregator: uses two private keys and signs incoming
 MessageSent events, then submits executeMessage with both signatures to the
 destination gateway. Intended for local demo only (uses Hardhat ephemeral keys).
*/
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');

const CONFIG = JSON.parse(fs.readFileSync(__dirname + '/multi-chain.config.json', 'utf8'));
const ABI = JSON.parse(fs.readFileSync(__dirname + '/abi/GatewayV3.json', 'utf8'));

// Supply two private keys here (Hardhat ephemeral keys) or via env vars:
const PK1 = process.env.DEMO_PK1 || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PK2 = process.env.DEMO_PK2 || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

async function start() {
  const netCfg = CONFIG.evm.sepolia; // use the sepolia/local entry
  const provider = new ethers.JsonRpcProvider(netCfg.rpcUrl);
  const wallet1 = new ethers.Wallet(PK1, provider);
  const wallet2 = new ethers.Wallet(PK2, provider);
  const gw = new ethers.Contract(netCfg.gateway, ABI, provider);

  console.log('Demo aggregator listening at', netCfg.gateway);

  gw.on('MessageSent', async (sender, toChainId, target, data, value, nonce, evt) => {
    try {
      console.log('Observed MessageSent:', sender, toChainId, target, nonce);
      // Build canonical hash (must match MessageLib.hashMessage)
      const domainTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
        "CrossChainMessage(uint256 nonce,uint256 fromChainId,uint256 toChainId,address sender,address target,bytes data,uint256 value)"
      ));
      const network = await provider.getNetwork();
      const digest = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32','uint256','uint256','uint256','address','address','bytes32','uint256'],
          [domainTypeHash, 0, Number(network.chainId), Number(toChainId), sender, target, ethers.keccak256(data), value]
        )
      );

      // Both wallets sign the digest
      const sig1 = await wallet1.signMessage(ethers.getBytes(digest));
      const sig2 = await wallet2.signMessage(ethers.getBytes(digest));

      // Use wallet1 to submit with both signatures
      const gwWithSigner = gw.connect(wallet1);
      console.log('Submitting executeMessage with 2 sigs...');
      const tx = await gwWithSigner.executeMessage(Number(network.chainId), ethers.ZeroAddress, target, data, value, digest, [sig1, sig2], { gasLimit: 3_000_000 });
      console.log('executeMessage tx:', tx.hash);
      await tx.wait();
      console.log('executeMessage confirmed');
    } catch (e) {
      console.error('aggregator error', e);
    }
  });
}

start().catch(console.error);
