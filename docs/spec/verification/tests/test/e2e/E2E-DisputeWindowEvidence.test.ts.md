# E2E-DisputeWindowEvidence.test.ts

Test file: [test/e2e/E2E-DisputeWindowEvidence.test.ts](../../../../../../test/e2e/E2E-DisputeWindowEvidence.test.ts)

## Overview

Exercises dispute submission and evidence timing around the initial window. The unresolved loss of the only higher-state commitment remains explicitly skipped.

The E47 late-timeout claim is constructed before the opening dispute starts the evidence window. Once the higher state is admitted, it is dated against that window, re-signed and its real transaction gas estimated before waiting for the later submission. The send still occurs at the same protocol timestamp target, with the same lower-state, counter, submission-count and reduction assertions.

## Tests

- `E47: a peer whose frozen view is above the opening dispute submits its higher state at once; a lower-state dispute admitted after the higher evidence needs no new upload, its own false timeout is still countered, and reduction keeps the higher state`: REQ-DISPUTE-PIPE-6-6FZB9M.T2.P1, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P39
- `E48: when the opening dispute already represents a peer's evidence, a lower-state dispute admitted near evidence closure gets no duplicate upload from that peer, and reduction keeps the higher state and the later dispute's own claim`: REQ-DISPUTE-PIPE-6-6FZB9M.T2.P2, UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P40
- `E19: an auditor frozen by its own dispute replays a higher dispute as stored data only: no view change and no new signature, its own proof and dispute stay at the frozen height, and the reduction after the kill window uses the replayed state`: REQ-SP-10-JMVHTB.T4.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P37
- `Deferred: losing the only higher-state commitment after evidence closes (different trusted starts, equal reduction outputs, no duplicate upload, a surviving lower commitment, a valid kill of the sole higher commitment after admission closes; control: the higher commitment survives) — pending: remediation oracle undecided`: none

The late E47 upload prepares its transaction fee and chain metadata before the deadline wait as well as estimating gas. The normal host signer still owns nonce assignment and broadcasting. E47 now uses the engineer-approved 15-second evidence window and eight-second submission margin, preserving the target broadcast at window opening plus seven seconds. E48 retains its ten-second window and three-second margin; the upload must still be admitted after the higher state and before evidence closure.
