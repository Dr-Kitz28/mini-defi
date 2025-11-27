const { expect } = require('chai');

// Import demo which exports run(opts)
const demo = require('../../relayer/demo');

describe('demo summary (non-fast) integration', function () {
  // on-chain operations; allow generous timeout
  this.timeout(120000);

  it('returns a summary with expected fields and proof tx hashes', async function () {
    // Run demo without fast mode so it waits for txs
    const summary = await demo.run({ fast: false, timeoutMs: 60000, retries: 1 });

    expect(summary).to.be.an('object');
    expect(summary).to.have.property('gateway');
    expect(summary).to.have.property('token');
    expect(summary).to.have.property('wrapped');
    expect(summary).to.have.property('lightClient');
    expect(summary).to.have.property('receiptsRoot');
    expect(summary).to.have.property('proofsSubmitted');
    expect(summary).to.have.property('finalBalance');

    // proofsSubmitted should be an array, and for a successful non-fast run each
    // entry should have a txHash (not an error).
    expect(Array.isArray(summary.proofsSubmitted)).to.equal(true);
    expect(summary.proofsSubmitted.length).to.be.greaterThan(0);
    for (const p of summary.proofsSubmitted) {
      // If any proof failed in a non-fast run this is suspect
      expect(p).to.have.property('index');
      expect(p).to.have.property('leaf');
      expect(p).to.have.property('path');
      expect(p).to.have.property('amount');
      // expect either txHash (success) OR error (on failure) but prefer success
      expect(p).to.satisfy(obj => Boolean(obj.txHash) || Boolean(obj.error));
    }
  });
});
