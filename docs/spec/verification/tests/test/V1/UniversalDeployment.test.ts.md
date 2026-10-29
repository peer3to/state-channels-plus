# UniversalDeployment.test.ts

Test file: [test/V1/UniversalDeployment.test.ts](../../../../../../test/V1/UniversalDeployment.test.ts)

## Overview

A Hardhat suite for the two deployment paths in `scripts/V1/deploy`. The production
`deployArtifact` case passes the real oversized `LocalDiamond` artifact and complete constructor
arguments, then requires the package-root `ContractSizeLimitError` before the deployer nonce changes. The
explicit local path deploys that same contract on the local unlimited-size network and reads a
routed view. The remaining Local Diamond half
drives `deployLocalDiamond` through a `LocalContractExecutorSigner` (the client-local EVM
executor), binds the result with
[`connectLocalDiamond`](../../../../implementation/source/src/utils/localDiamond.ts.md) — the
merged ABI, because the mirror's own ABI does not carry the selectors the proxy routes — and then
exercises the mirror's event-replication handlers on the deployed `LocalDiamond`: stale `onWithdrawalsUpdated`/`onChannelStorageCleared` events (older timestamps
replayed after newer ones) must be ignored, duplicate `onOnChainSlashAdded` calls must
deduplicate, and a replayed `onDisputeCommitted` must leave exactly one commitment with the
newer evidence timestamp — oracles are the mirror's read-back views (`getChannelBalance`,
`getOnChainSlashedParticipants`, `getDisputeWindows`). Those handlers are `LocalDiamond`'s own
declarations and those views are routed facet selectors, so that one test also demonstrates both
halves of the merged binding answering on a real deployment. The consumer-facet half deploys the
production proxy via `deploy`, parses a proxy error, a direct facet error, and a routed
`joinChannel` facet error through the returned combined binding, and asserts the constructor's zero-means-default timing sentinels
(`getAllTimes` → 15/5/30/30, gas limit 3,000,000), a custom dispute-execution gas limit, and
that `open` against a non-contract consumer facet address reverts. Channel protocol flows
(open/join/dispute semantics) are out of scope; the suite verifies deployment wiring and mirror
replication only, so no single Exercises component is named.

## Tests

- `deploys a local state machine directly with the signer`: none
- `rejects the real oversized LocalDiamond before submitting a production deployment`: REQ-CONTRACT-SIZE-1-881Q6E.T1.P9
- `deploys the oversized LocalDiamond through the exempt local path`: REQ-CONTRACT-SIZE-1-881Q6E.T1.P10
- `ignores stale overwrite events and deduplicates on-chain slashes`: UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P1, UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P2, REQ-MIRROR-2-E9F3TM.T1.P1, UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P6, UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P7
- `deploys with consumer facet`: none
- `deploys with a custom dispute execution gas limit`: none
- `parses proxy and facet custom errors through the returned binding`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P7, REQ-CONTRACT-ARCH-1-9W5390.T1.P7
- `fails with invalid consumer facet`: none
