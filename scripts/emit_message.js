const hre = require('hardhat');

async function main() {
  const [sender] = await hre.ethers.getSigners();
  const gwAddr = '0x0165878A594ca255338adfa4d48449f69242Eb8F';
  const Gateway = await hre.ethers.getContractFactory('GatewayV3');
  const gw = Gateway.attach(gwAddr).connect(sender);

  console.log('Sending message from', sender.address, 'to gateway', gwAddr);
  // For local demo we send to the local chain id (31337) which is configured in the registry
  const tx = await gw.sendMessage(31337, sender.address, hre.ethers.toUtf8Bytes('hello'), { value: 0 });
  await tx.wait();
  console.log('sendMessage tx:', tx.hash);
}

main().catch((e) => { console.error(e); process.exit(1); });
