# Security Policy

The security of the Mini-DeFi Lending Pool and its users is our top priority. This document outlines our security practices, policies for responsible disclosure, and recommendations for developers and users to protect themselves against emerging threats.

## Supported Versions

Security updates are applied to the latest version of the contracts available in the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take all security vulnerabilities seriously. If you believe you have found a security vulnerability in our smart contracts or frontend, please report it to us responsibly.

**DO NOT open a public GitHub issue or post on public channels.**

Instead, please send an email to a secure, private address (e.g., `contact@example.com` - *please replace with a real address*).

Please include the following with your report:
- A detailed description of the vulnerability and its potential impact.
- Steps to reproduce the vulnerability, including any required setup or accounts.
- Any proof-of-concept code or transaction data.

We will acknowledge your report within 48 hours and will work with you to understand and resolve the issue. We are open to discussing a bug bounty for critical vulnerabilities.

## Security Best Practices for Developers & Users

The blockchain ecosystem faces evolving threats, including social engineering attacks where malware uses the blockchain as a decentralized C2 server (e.g., "Ether Hiding"). The following practices are crucial for staying safe.

### 1. **Never Run Untrusted Files**
- **Source**: Be extremely skeptical of files from unverified sources, especially during hiring processes, from direct messages, or from users you don't know.
- **File Types**: Executables (`.exe`, `.scr`), scripts (`.js`, `.py`, `.sh`), documents with macros (`.docm`), and compressed files (`.zip`) can all contain malware.
- **Coding Tests**: If an interviewer asks you to run a file locally as part of a test, consider it a major red flag. Legitimate tests are typically done in sandboxed web environments (like CoderPad, HackerRank) or by having you write code from scratch.

### 2. **Use Sandboxed Environments**
- If you absolutely must inspect a suspicious file, do so in a secure, isolated sandbox environment.
- **Virtual Machines (VMs)**: Use a VM (like VirtualBox or VMWare) with no access to your host machine's files, network, or personal accounts.
- **Cloud-Based Sandboxes**: Utilize services like [Any.Run](https://any.run/) or [Hybrid Analysis](https://www.hybrid-analysis.com/) to analyze files in a safe, remote environment.

### 3. **Secure Your Development Environment**
- **Principle of Least Privilege**: Do not use an admin or root account for daily development work.
- **Execution Policies**: On Windows, maintain a strict PowerShell execution policy (e.g., `RemoteSigned`).
- **Firewall**: Ensure your system's firewall is active and properly configured.

### 4. **Protect Your Crypto Wallets**
- **Hardware Wallets**: For significant funds, always use a hardware wallet (e.g., Ledger, Trezor). Never type your hardware wallet's seed phrase into any computer or website.
- **Hot Wallets**: Use browser extension wallets (like MetaMask) only for smaller, transactional amounts. Keep them disconnected from sites when not in use.
- **Beware of Phishing**: Never enter your seed phrase or private key into a website. Your wallet extension will manage keys for you. Double-check every transaction before signing.

By adhering to these principles, you can significantly reduce your risk of falling victim to social engineering and malware attacks that target the Web3 space. Stay vigilant.
