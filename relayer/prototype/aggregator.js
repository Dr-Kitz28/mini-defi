/**
 * Aggregator collects signatures from relayer signers.
 * Provides helper to collect N signatures and return them as an array.
 */
const { signProof } = require("./relayerNode");

async function collectSignatures(signers, proofHash, required) {
  const sigs = [];
  for (let i = 0; i < signers.length && sigs.length < required; i++) {
    const s = await signProof(signers[i], proofHash);
    sigs.push(s);
  }
  return sigs;
}

module.exports = { collectSignatures };
