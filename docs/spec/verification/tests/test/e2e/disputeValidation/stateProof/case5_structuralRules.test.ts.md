# case5_structuralRules.test.ts

Test file: [test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts)

## Overview

The suite submits disputes with malformed milestone proofs and observes real audit counters
and dispute kills. An empty milestone produces `DisputeInvalidStateProof`. An invalid tail
author signature, a broken previous-block hash and a skipped height in a genesis block-zero
run produce `DisputeInvalidBlockStructure`. The tests mutate real constructed disputes and
check the stored counter type and the resulting window. The table assigns only permutations
fully established by each declaration; these cases do not establish cross-milestone identity
consistency for two differently signed blocks.

## Tests

- `stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof`: none
- `invalid tail signature → DisputeInvalidBlockStructure`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P8
- `genesis block-0 milestone blockConfirmations[1].previousBlockHash = random → DisputeInvalidBlockStructure`: none
- `genesis block-0 milestone skipped height → DisputeInvalidBlockStructure`: none
