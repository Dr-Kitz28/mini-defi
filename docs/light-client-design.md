# Light-Client Design (summary)

This document captures an MVP design for adding a light-client capability to the cross-chain bridge. It is intended as a design-phase artifact and a starting point for implementation. The goal is to reduce trust in relayers over time by introducing cryptographic verification of chain state (headers/proofs) on-chain or via a succinct verifier.

High-level goals
- Provide a way for a destination Gateway to verify that an event (or state change) happened on a source chain without trusting a single relayer.
- Allow incremental hardening: start with a checkpoint/validator set oracle (trusted set) and iterate toward more decentralized verification (multi-party signing, fraud proofs, succinct proofs).

Assumptions and constraints
- Source chains are EVM-compatible (or at least expose block headers / merkle roots and receipts).
- Gas cost on destination chain is limited; heavy verification (full block reexecution) is impractical.
- Developers can tolerate an initial trusted setup (validator set / committee) that can be replaced/upgraded with governance.

Design options (tradeoffs)

1) Checkpointing + validator signatures (practical MVP)
- Off-chain committee signs block headers or periodic checkpoints (e.g., every Nth block). The bridge stores the latest signed checkpoint on-chain.
- To prove that an event happened in a block, relayers submit:
  - the checkpoint header (or reference) signed by the validator set,
  - a Merkle proof of the receipt/event against the corresponding receiptsRoot in the block header.
- On-chain verifier checks the validator signature(s) and verifies the Merkle proof against the header stored/accepted on-chain.

Pros: Relatively cheap, simple to implement, supports finality assumptions.
Cons: Requires an off-chain validator set; upgrades require governance.

2) Fraud-proof / optimistic model
- Relayers submit optimistic claims (headers + proofs) which are accepted after a challenge window if no one posts a fraud proof.

Pros: Lower immediate cost, more decentralised over time.
Cons: Requires infrastructure for fraud proofs; long challenge windows increase latency.

3) Succinct SNARK/STARK proofs (longer-term)
- Produce succinct proofs that a given event was included in a header (or that a header was produced by the source chain). Verify using an on-chain verifier.

Pros: Strong cryptographic guarantees, minimal on-chain state once verified.
Cons: Complex to implement; tooling and proving time can be heavy.

Suggested MVP approach
- Implement #1 (checkpointing + validator signatures) as a first step:
  1. Create a small LightClient contract that stores signed checkpoints (header root + block number).
  2. Provide a function to submit a header + validator signatures and let governance rotate validator set.
  3. Provide a verifyReceiptProof(headerRef, receiptProof) that verifies the provided Merkle proof against stored header roots.
  4. Integrate Gateway.receiveMessage/receiveTokens flows to accept either relayer-signed aggregated signatures (current model) or header+proofs to prove inclusion.

Security considerations
- Protect validator set upgrades with multisig/governance (SimpleMultiSig can be used for upgrades in the short term).
- Consider slashing/staking incentives for validator/relayer misbehavior in a production system.

Next steps / placeholders
- Add an interface `ILightClient.sol` to the repo so the Gateway can depend on the abstraction.
- Implement a lightweight reference LightClient (checkpoint signer acceptance) as a later PR.

References
- Ethereum receipt Merkle proofs and RLP encoding.
- Existing designs: ChainBridge, Wormhole Guardian set, Axelar checkpointing, Light clients research.
