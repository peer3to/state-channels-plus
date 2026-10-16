# E2E-RetainedProofSupport.test.ts

Test file: [test/e2e/E2E-RetainedProofSupport.test.ts](../../../../../../test/e2e/E2E-RetainedProofSupport.test.ts)

## Overview

E50 freezes one participant's view behind an unfinalized two-block tail. A live peer uploads a
dispute whose proof ends one block above that view and retains, in an earlier milestone, an
authentic forged block at the tail's last height. The other live peers' submissions are held until
the frozen auditor has audited that dispute, then the honest peers kill it and post their own
disputes, which carry the real block at that height. After the window resolves, the frozen auditor
holds the real block as history and the forged one as evidence, it applied no counter naming an
honest disputer, and only the forger is slashed on chain. E51 syncs a spectator from a proof whose
forged support sits above its proven endpoint: the head stops at the endpoint, then the spectator
catches up with two more final blocks; the forged block is never its history, stays retained as
evidence, and no participant is blacklisted.

## Tests

- `E50: a lagging auditor audits a dispute retaining a forged block above its tail, then the honest disputes replaying the real block there → it counters none of them, only the forger is slashed`: REQ-SP-11-535J0R.T1.P9
- `E51: a spectator syncs from a proof whose forged support sits above its proven endpoint, then follows the channel → its head stops at the endpoint, the forged block never enters its history, it catches up without blacklisting a responder`: REQ-SP-11-535J0R.T1.P10
