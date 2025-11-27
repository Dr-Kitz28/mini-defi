const hre = require('hardhat');

async function main(){
  const Gateway = await hre.ethers.getContractFactory('GatewayV3');
  const gw = Gateway.attach('0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9');
  const filter = gw.filters.MessageExecuted();
  const provider = hre.ethers.provider;
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - 200);
  const events = await gw.queryFilter(filter, from, latest);
  console.log('MessageExecuted events found:', events.length);
  for (const e of events){
    console.log('executor', e.args.executor, 'target', e.args.target, 'fromChain', e.args.fromChainId, 'success', e.args.success);
  }
}

main().catch(console.error);