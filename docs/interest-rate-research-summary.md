# Interest-Rate Research Highlights (2015–2025)

This note distils the main takeaways from the attached paper *Interest Rate Models in Ethereum DeFi Lending and Derivatives (2015–2025)* and explains how they informed the latest changes in this repository.

## Taxonomy and best practices

- **Utilisation-driven curves dominate**: the paper reinforces that utilisation is the key signal for on-chain money markets. Low utilisation should keep borrowing cheap to attract demand, while high utilisation must raise rates sharply to protect liquidity.
- **Linear models are suboptimal**: their smooth slope fails to discourage 90%+ utilisation. They are still useful for simple markets but need complements.
- **Piecewise jump (“kink”) curves are near-optimal**: Compound/Aave-style models achieve high capital efficiency yet prevent liquidity exhaustion by setting an 80–90% optimal utilisation band with a steep slope afterwards.
- **Smooth convex curves (quadratic/exponential)**: deliver similar safety to kinked models without a hard break. They are intuitive for teams that prefer continuous responses, although parameter tuning is harder to communicate.
- **Time-weighted adaptive schemes**: Fraxlend-style controllers continuously adjust rates when utilisation trends are out of balance, removing the need for frequent governance interventions.

## What changed in this codebase

- ✅ Added an **adaptive, time-weighted interest model** (`TimeWeightedInterestRateModel`) that mirrors Fraxlend’s “target band + half-life” approach. The model
  - keeps a mutable annual APR state,
  - moves the APR upward when utilisation sits above 90%, downward when below 75%, and
  - mean reverts toward a neutral rate when the pool is healthy.
- ✅ Updated `IInterestRateModel` with a `updateBorrowRate` hook so adaptive models can persist state before each borrow-rate query.
- ✅ Wired the pool to call the hook on every user interaction, ensuring rate controllers receive the same utilisation signal described in the literature.
- ✅ Exposed utilisation and effective APRs in the frontend dashboard to mirror the operational metrics emphasised in the research.
- ✅ Introduced a `RateGovernor` timelock plus CLI tooling so parameter tweaks inspired by elasticity analysis can be queued, reviewed, and executed safely after a delay.
- ✅ Documented all available curves (linear, kinked, exponential, adaptive) in the README so operators understand when to deploy each one.

## Future opportunities inspired by the paper

- Experiment with additional adaptive bands (e.g. PID or RL-driven controllers) while keeping the new hook-based interface.
- Explore user-elasticity aware tuning, possibly by logging utilisation history and computing on-chain heuristics.
- Add governance scripts that update model parameters gradually instead of immediate jumps, reflecting research on smooth policy changes.

These updates bring the playground closer to production-grade DeFi systems while staying faithful to the research insights.
