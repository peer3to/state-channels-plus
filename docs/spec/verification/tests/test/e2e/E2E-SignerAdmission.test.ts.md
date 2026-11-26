# E2E-SignerAdmission.test.ts

Test file: [test/e2e/E2E-SignerAdmission.test.ts](../../../../../../test/e2e/E2E-SignerAdmission.test.ts)

## Overview

Three real peers stage a joiner that joins and leaves, then one peer loses the blocks that would make the join final, so its one hop from the genesis spans the join and the exit. A peer gossips the joiner's signature on the block after its exit. The suite checks that the peer admits it without cutting the sender, that the other peer (whose final point is past the exit) strips it without cutting the re-gossiping peer, and that the chain's milestone walk from the genesis accepts the hop with that signature.

## Tests

- `a joiner added and removed in one hop signs the block after its exit → peers admit its gossiped signature without cutting the sender, and the chain's walk from the genesis proves the hop final`: REQ-BLOCK-PIPE-11-DCHAJ2.T1.P8, REQ-BLOCK-PIPE-11-DCHAJ2.T1.P11, REQ-BLOCK-PIPE-11-DCHAJ2.T1.P13, REQ-FIN-7-RTZWQZ.T1.P21
