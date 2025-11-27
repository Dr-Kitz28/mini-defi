/*
  Helper to deploy a Gateway contract pre-populated with relayers and a threshold.
  Usage: npx hardhat run scripts/deployGatewayWithRelayers.js --network <network>
*/

const { ethers } = require('hardhat');
const fs = require('fs');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('deploying with', deployer.address);

  const Gateway = await ethers.getContractFactory('Gateway');

  // Example relayers - for production, pass a real list or load from a config file
  const relayers = [deployer.address];
  const signatureThreshold = 1;

  // Optionally deploy a SimpleMultiSig and wire it into the Gateway.
  // Set the environment variable DEPLOY_MULTISIG=true to enable.
  const deployMultisig = process.env.DEPLOY_MULTISIG === 'true';
  const multisigRequired = process.env.MULTISIG_REQUIRED ? Number(process.env.MULTISIG_REQUIRED) : Math.max(1, Math.min(relayers.length, 1));

  const gateway = await Gateway.deploy(deployer.address, relayers, signatureThreshold);
  await gateway.waitForDeployment();

  console.log('Gateway deployed at', gateway.target);

  let multisigAddress = null;
  if (deployMultisig) {
    const SimpleMultiSig = await ethers.getContractFactory('SimpleMultiSig');
    const multisig = await SimpleMultiSig.deploy(relayers, multisigRequired);
    await multisig.waitForDeployment();
    multisigAddress = multisig.target;
    console.log('Deployed SimpleMultiSig at', multisigAddress);

    // Owner wires the multisig into the gateway
    await gateway.setMultisig(multisigAddress);
    console.log('Wired multisig into Gateway');
  }

  // Save address to a simple JSON file so frontend or relayers can pick it up
  const out = {
    gateway: gateway.target,
    relayers,
    signatureThreshold
  };
  if (multisigAddress) out.multisig = multisigAddress;
  fs.writeFileSync('./deployed-gateway.json', JSON.stringify(out, null, 2));
  console.log('Saved ./deployed-gateway.json');
}

main().catch(e => { console.error(e); process.exit(1); });
