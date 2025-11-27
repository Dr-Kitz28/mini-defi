const { ethers } = require("hardhat");

/**
 * Simple relayer node helper.
 * Exports a function that signs a proofHash with a signer.
 */
async function signProof(signer, proofHash) {
  // proofHash should be a 0x-prefixed bytes32 string
  const bytes = ethers.getBytes(proofHash);
  const signature = await signer.signMessage(bytes);
  return signature;
}

module.exports = { signProof };
