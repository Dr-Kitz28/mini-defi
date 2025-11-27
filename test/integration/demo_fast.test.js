const { expect } = require('chai');

// This integration test imports the demo script and runs it programmatically
// using the Hardhat runtime (so the test must be executed via `npx hardhat test`).
// We enable fast mode to avoid waiting for confirmations which shortens runtime.

const demo = require('../../relayer/demo');

describe('demo (fast mode) integration', function () {
  // this test performs deployments and txs; allow generous timeout
  this.timeout(120000);

  it('runs demo in fast mode without throwing', async function () {
    // run the demo with fast option enabled
    await demo.run({ fast: true });
    // if it completes, assert true
    expect(true).to.equal(true);
  });
});
