Relayer PoC scaffold
=====================

This folder contains a minimal relayer skeleton and an aggregator helper intended for local testing and PoC flows.

What it does
- Listens for `TokensSent` and `MessageSent` events on a configured Gateway contract.
- Builds the messageHash the Gateway contract expects.
- Signs the messageHash using a relayer private key and prints/submits the signature to an aggregator.
- The aggregator (simple module provided) collects signatures until `SIGNATURE_THRESHOLD` and can submit the aggregated signatures to the destination Gateway.

Quick start (local testnet)
1. Copy `.env.example` to `.env` and set values.
2. From `relayer/` run `npm install`.
3. Start the relayer: `npm start`.

Notes
- This is a PoC scaffold. Production relayers should use secure key storage (HSM/TSS), secure transport for broadcasting signatures, and robust retries.
- The aggregator helper provided (`aggregateAndSubmit.js`) is a programmatic helper — you can wire it into an Express server to receive POSTs from relayers and submit the aggregated signatures.
