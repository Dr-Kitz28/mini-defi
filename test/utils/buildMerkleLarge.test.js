const { expect } = require('chai');
const { ethers } = require('hardhat');

const rlpUtil = require('../../test/utils/rlpValidator')(ethers);

describe('buildMerkle large (synthetic) boundary', function () {
  this.timeout(30000);

  it('handles 1024 leaves and produces valid proofs for sample indices', function () {
    const n = 1024;
    const leaves = new Array(n);
    for (let i = 0; i < n; i++) {
      leaves[i] = ethers.keccak256(ethers.toUtf8Bytes('leaf-large-' + i));
    }

    const { root, proofs, paths } = rlpUtil.buildMerkle(leaves);
    expect(root).to.be.a('string');
    expect(proofs.length).to.equal(n);
    expect(paths.length).to.equal(n);

    // verify folding for a few representative indices
    const sample = [0, Math.floor(n / 2), n - 1, Math.floor(n / 3), n - 2];
    for (const idx of sample) {
      let computed = leaves[idx];
      const siblings = proofs[idx];
      const path = paths[idx] || new Uint8Array(1);
      for (let j = 0; j < siblings.length; j++) {
        const byteIndex = Math.floor(j / 8);
        const bitIndex = j % 8;
        const b = path[byteIndex] || 0;
        const siblingIsLeft = ((b >> bitIndex) & 1) !== 0;
        if (!siblingIsLeft) {
          computed = ethers.keccak256(ethers.concat([computed, siblings[j]]));
        } else {
          computed = ethers.keccak256(ethers.concat([siblings[j], computed]));
        }
      }
      expect(computed).to.equal(root);
    }
  });
});
