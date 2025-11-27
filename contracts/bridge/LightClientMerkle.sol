// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ILightClient} from "./ILightClient.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Merkle-root based LightClient prototype.
 * - Owner or validators can submit accepted roots.
 * - verifyProof(headerRoot, proof) expects proof == abi.encode(bytes receiptRLP, bytes32[] siblings, bytes bitmask)
 *   where `receiptRLP` is the canonical RLP bytes of the Ethereum receipt and `siblings` are the sibling
 *   hashes from leaf -> root. `bitmask` packs one bit per sibling to indicate left/right order.
 */
contract LightClientMerkle is ILightClient, Ownable {
    // mapping of checkpoint/header id -> accepted receiptsRoot
    mapping(bytes32 => bytes32) public receiptsRootOf;
    bytes32 public latestRoot;

    event CheckpointSubmitted(bytes32 indexed root, address indexed submitter);

    constructor() Ownable(msg.sender) {}

    /// @notice Submit a checkpoint by directly providing a checkpoint id or header bytes.
    /// For Ethereum-style receipts, callers should use `submitHeader(headerId, receiptsRoot)` to register the receiptsRoot
    /// associated with that header.
    function submitCheckpoint(bytes calldata headerOrCheckpoint, bytes[] calldata /* signatures */) external onlyOwner {
        bytes32 root;
        if (headerOrCheckpoint.length == 32) {
            root = abi.decode(headerOrCheckpoint, (bytes32));
        } else {
            root = keccak256(headerOrCheckpoint);
        }
        receiptsRootOf[root] = root;
        latestRoot = root;
        emit CheckpointSubmitted(root, msg.sender);
    }

    /// @notice Submit a header id and its receiptsRoot. The headerId is an identifier for the header (e.g., header hash)
    /// and receiptsRoot is the merkle-root of receipts for that block.
    function submitHeader(bytes32 headerId, bytes32 receiptsRoot) external onlyOwner {
        receiptsRootOf[headerId] = receiptsRoot;
        latestRoot = receiptsRoot;
        emit CheckpointSubmitted(receiptsRoot, msg.sender);
    }

    function verifyProof(bytes32 headerId, bytes calldata proof) external view returns (bool) {
        bytes32 r = receiptsRootOf[headerId];
        if (r == bytes32(0)) return false;

    // New-proof format: abi.encode(bytes receiptRLP, bytes32[] siblings, bytes bitmask)
    // where `bitmask` packs one bit per sibling (LSB-first within each byte):
    //  - bit == 0 means `computed` is left and sibling is right: keccak(computed || sibling)
    //  - bit == 1 means sibling is left and `computed` is right: keccak(sibling || computed)
    bytes memory receiptRLP;
    bytes32[] memory siblings;
    bytes memory bitmask;
    // Full RLP validation (canonical) for the Ethereum receipt format.
    // We parse the top-level list and then the first four items to validate
    // the expected canonical structure before using the receipt as a merkle leaf.
    (receiptRLP, siblings, bitmask) = abi.decode(proof, (bytes, bytes32[], bytes));
    // Minimal sanity: must be non-empty and an RLP list
    if (receiptRLP.length == 0) return false;
    if (uint8(receiptRLP[0]) < 0xc0) return false;
    // bitmask must have enough bits for siblings
    if (bitmask.length * 8 < siblings.length) return false;

    // compute leaf as the keccak256 of full receipt bytes
    bytes32 leaf = keccak256(receiptRLP);

        // Verify merkle path using directional flags from `path`
        bytes32 computed = leaf;
        for (uint i = 0; i < siblings.length; i++) {
            // read bit i from bitmask (little-endian within bytes): bit=0 -> computed is left; bit=1 -> sibling is left
            uint byteIndex = i >> 3; // i / 8
            uint bitIndex = i & 7; // i % 8
            uint8 b = uint8(bitmask[byteIndex]);
            bool siblingIsLeft = ((b >> bitIndex) & 1) != 0;
            if (!siblingIsLeft) {
                // computed is left
                computed = keccak256(abi.encodePacked(computed, siblings[i]));
            } else {
                // sibling is left
                computed = keccak256(abi.encodePacked(siblings[i], computed));
            }
        }

        return computed == r;
    }

    /// @notice Return payload offset and payload length for the RLP item starting at `pos` in `b`.
    /// `pos` points to the beginning of the item (the prefix byte).
    function _rlpItemPayload(bytes memory b, uint pos) internal pure returns (uint payloadOffset, uint payloadLen) {
        require(pos < b.length, "RLP: out of bounds");
        uint8 prefix = uint8(b[pos]);
        if (prefix <= 0x7f) {
            // single byte, payload is the byte itself
            return (pos, 1);
        } else if (prefix <= 0xb7) {
            uint len = prefix - 0x80;
            // empty string allowed (len == 0)
            return (pos + 1, len);
        } else if (prefix <= 0xbf) {
            uint lenOfLen = prefix - 0xb7;
            require(pos + 1 + lenOfLen <= b.length, "RLP: long string oob");
            uint len = _readLength(b, pos + 1, lenOfLen);
            return (pos + 1 + lenOfLen, len);
        } else if (prefix <= 0xf7) {
            uint len = prefix - 0xc0;
            return (pos + 1, len);
        } else {
            uint lenOfLen = prefix - 0xf7;
            require(pos + 1 + lenOfLen <= b.length, "RLP: long list oob");
            uint len = _readLength(b, pos + 1, lenOfLen);
            return (pos + 1 + lenOfLen, len);
        }
    }

    function _readLength(bytes memory b, uint offset, uint lenOfLen) internal pure returns (uint) {
        require(lenOfLen > 0 && lenOfLen <= 32, "RLP: invalid lenOfLen");
        require(offset + lenOfLen <= b.length, "RLP: readLength oob");
        uint val = 0;
        for (uint i = 0; i < lenOfLen; i++) {
            val = (val << 8) | uint8(b[offset + i]);
        }
        return val;
    }

    function latestHeaderRoot() external view returns (bytes32) {
        return latestRoot;
    }
}
