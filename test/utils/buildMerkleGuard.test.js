const { expect } = require('chai');
const { ethers } = require('hardhat');

const rlpUtil = require('../../test/utils/rlpValidator')(ethers);

describe('buildMerkle guard', function () {
  it('throws when iterations exceed maxIterations (opts)', function () {
    const leaves = [
      ethers.keccak256(ethers.toUtf8Bytes('a')),
      ethers.keccak256(ethers.toUtf8Bytes('b')),
      ethers.keccak256(ethers.toUtf8Bytes('c')),
    ];

    expect(() => rlpUtil.buildMerkle(leaves, { maxIterations: 0 })).to.throw(/exceeded max iterations/);
  });
});
