const { ethers } = require('hardhat');

module.exports = (externalEthers) => {
  const e = externalEthers || ethers;

  // Minimal RLP helpers to build and validate Ethereum-style receipt RLP bytes
  // Matches the Solidity _rlpItemPayload semantics used in LightClientMerkle
  function _readLength(buf, offset, lenOfLen) {
    if (lenOfLen <= 0 || lenOfLen > 32) throw new Error('RLP: invalid lenOfLen');
    if (offset + lenOfLen > buf.length) throw new Error('RLP: readLength oob');
    let val = 0;
    for (let i = 0; i < lenOfLen; i++) {
      val = (val << 8) | buf[offset + i];
    }
    return val;
  }

  function rlpItemPayload(b, pos) {
    if (pos >= b.length) throw new Error('RLP: out of bounds');
    const prefix = b[pos];
    if (prefix <= 0x7f) {
      return { offset: pos, length: 1 };
    } else if (prefix <= 0xb7) {
      const len = prefix - 0x80;
      return { offset: pos + 1, length: len };
    } else if (prefix <= 0xbf) {
      const lenOfLen = prefix - 0xb7;
      if (pos + 1 + lenOfLen > b.length) throw new Error('RLP: long string oob');
      const len = _readLength(b, pos + 1, lenOfLen);
      return { offset: pos + 1 + lenOfLen, length: len };
    } else if (prefix <= 0xf7) {
      const len = prefix - 0xc0;
      return { offset: pos + 1, length: len };
    } else {
      const lenOfLen = prefix - 0xf7;
      if (pos + 1 + lenOfLen > b.length) throw new Error('RLP: long list oob');
      const len = _readLength(b, pos + 1, lenOfLen);
      return { offset: pos + 1 + lenOfLen, length: len };
    }
  }

  function makeReceiptRLP(messageHash) {
    // item0: 32-byte status/root encoded as 0xa0 + 32 bytes
    const item0 = e.concat([e.getBytes('0xa0'), e.getBytes(messageHash)]);
    // item1: small cumulativeGasUsed (set to 1)
    const item1 = e.getBytes('0x01');
    // item2: logsBloom 256 bytes with long-string prefix 0xb9 0x01 0x00
    const bloom = new Uint8Array(256);
    const item2 = e.concat([e.getBytes('0xb90100'), bloom]);
    // item3: empty logs list
    const item3 = e.getBytes('0xc0');

    const payload = e.concat([item0, item1, item2, item3]);
    const payloadLen = payload.length;
    if (payloadLen <= 55) {
      const listPrefix = e.getBytes(e.hexlify([0xc0 + payloadLen]));
      return e.concat([listPrefix, payload]);
    } else {
      const lenHex = payloadLen.toString(16);
      const lenHexEven = lenHex.length % 2 === 1 ? '0' + lenHex : lenHex;
      const lenBytes = e.getBytes('0x' + lenHexEven);
      const listPrefix = e.getBytes('0x' + (0xf7 + lenBytes.length).toString(16));
      return e.concat([listPrefix, lenBytes, payload]);
    }
  }

  function validateReceiptRLP(receiptRLP) {
    const raw = e.getBytes(receiptRLP);
    if (raw.length === 0) return false;
    if (raw[0] < 0xc0) return false;
    const top = rlpItemPayload(raw, 0);
    if (top.offset + top.length !== raw.length) return false;

    // parse first four items
    let cursor = top.offset;
    // item0
    const item0 = rlpItemPayload(raw, cursor);
    if (!(item0.length === 1 || item0.length === 32)) return false;
    cursor = item0.offset + item0.length;
    // item1
    const item1 = rlpItemPayload(raw, cursor);
    cursor = item1.offset + item1.length;
    // item2 logsBloom
    const item2 = rlpItemPayload(raw, cursor);
    if (item2.length !== 256) return false;
    cursor = item2.offset + item2.length;
    // item3 logs must be list
    if (cursor >= raw.length) return false;
    if (raw[cursor] < 0xc0) return false;
    return true;
  }

  function packDirections(directions) {
    const bitmaskLen = Math.ceil(directions.length / 8) || 1;
    const bitmask = new Uint8Array(bitmaskLen);
    for (let j = 0; j < directions.length; j++) {
      if (directions[j]) bitmask[Math.floor(j / 8)] |= (1 << (j % 8));
    }
    return bitmask;
  }

  function computeDirections(levels, index) {
    const dirs = new Array(levels).fill(0);
    let idx = index;
    for (let layer = 0; layer < levels; layer++) {
      dirs[layer] = idx % 2 === 0 ? 0 : 1;
      idx = Math.floor(idx / 2);
    }
    return dirs;
  }

  function buildMerkle(leaves, opts) {
    if (leaves.length === 0) return { root: e.ZeroHash, proofs: [], paths: [] };
    let layers = [leaves];
  // defensive guard to avoid infinite loops in case of unexpected input
  const MAX_ITERATIONS = (opts && typeof opts.maxIterations !== 'undefined') ? Number(opts.maxIterations) : 256;
  let iterations = 0;
    while (layers[layers.length - 1].length > 1) {
      iterations += 1;
      if (iterations > MAX_ITERATIONS) throw new Error('buildMerkle: exceeded max iterations');
      const prev = layers[layers.length - 1];
      const next = [];
      // pair nodes by two; if odd, pair last with ZeroHash
      for (let i = 0; i < prev.length; i += 2) {
        if (i + 1 === prev.length) {
          next.push(e.keccak256(e.concat([prev[i], e.ZeroHash])));
        } else {
          next.push(e.keccak256(e.concat([prev[i], prev[i + 1]])));
        }
      }
      layers.push(next);
    }
    const root = layers[layers.length - 1][0];

    const proofs = [];
    const paths = [];
    for (let idx = 0; idx < leaves.length; idx++) {
      const proof = [];
      const directions = new Uint8Array(layers.length - 1);
      let index = idx;
      for (let layer = 0; layer < layers.length - 1; layer++) {
        const siblingIndex = index ^ 1;
        const layerNodes = layers[layer];
        proof.push(layerNodes[siblingIndex] || e.ZeroHash);
        directions[layer] = index % 2 === 0 ? 0 : 1;
        index = Math.floor(index / 2);
      }
      proofs.push(proof);
      paths.push(packDirections(directions));
    }

    return { root, proofs, paths };
  }

  return { makeReceiptRLP, validateReceiptRLP, packDirections, computeDirections, buildMerkle };
};
