const { expect } = require('chai');
const { ethers } = require('hardhat');

const rlpUtil = require('../../test/utils/rlpValidator')(ethers);

describe('buildMerkle helper', function () {
  it('produces roots and valid proofs for leaf counts 1..5', async function () {
    for (let n = 1; n <= 5; n++) {
      const leaves = [];
      for (let i = 0; i < n; i++) {
        leaves.push(ethers.keccak256(ethers.toUtf8Bytes('leaf-' + i)));
      }

      const { root, proofs, paths } = rlpUtil.buildMerkle(leaves);

      // Sanity
      expect(root).to.be.a('string');
      expect(proofs.length).to.equal(n);
      expect(paths.length).to.equal(n);

      // verify each proof folds to the root using the same LSB-first bitmask semantics
      for (let idx = 0; idx < n; idx++) {
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
    }
  });
});
