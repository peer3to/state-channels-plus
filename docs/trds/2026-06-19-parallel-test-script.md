---
tier: 2
round: 1
status: draft
---

## Proposed Approach

**Issue**: none linked.

**What**: Add an explicit parallel-test entry point without broad refactoring first. Use Hardhat's supported `test --parallel` path as the primary mechanism, keep the existing serial scripts intact, and only isolate/refactor tests if the parallel run exposes concrete shared-state failures.

**Files**:

- `package.json` — add/update the parallel test script(s).
- `docs/testingGuide.md` — document how to run parallel tests and when to prefer serial integration tests.
- Optional only if needed after validation: a small helper script under `scripts/` to shard safe parallel tests and run known integration/flaky files serially.

**Delegation**: Route implementation to the code specialist for `package.json`/docs/script changes. Route broader suite execution to the build/test specialists after implementation. No Svelte routing required.

**Scouts**: 0 — discovery found the relevant scripts/tests and Hardhat documentation confirms `hardhat test --parallel` is supported.

**Validation**:

- `yarn hardhat test --help` or equivalent local CLI check once dependencies are installed.
- `yarn test:parallel` after script changes.
- If the full parallel run fails from known integration/shared-state files, split validation into: parallel-safe subset first, then serial integration files.

**Plan**:

1. Add the minimal opt-in script first; do not change `test`, `testts`, `testc`, or coverage behavior.
2. Run the parallel command. If it passes, stop there plus docs.
3. If it fails due shared state/flaky integration tests, adjust the script to run safe files with `--parallel` and run high-risk files serially. High-risk files discovered so far include P2P/timer/transport tests under `test/V1/EvmStateMachine.test.ts` and `test/V1/DiamondProxy/DisputeManager/Timeout.test.ts`.
4. Only refactor after a specific failure is observed; likely targets would be global `process.env.DEBUG_LOCAL_TRANSPORT`, real `setTimeout` sleeps, manual snapshots/time travel, or local transport lifecycle.

Approval only needed if implementation requires new dependencies, deletes/renames existing scripts, or expands into refactoring test/runtime code.
