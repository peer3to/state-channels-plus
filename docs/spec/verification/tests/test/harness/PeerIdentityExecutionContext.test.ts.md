# PeerIdentityExecutionContext.test.ts

Test file: [test/harness/PeerIdentityExecutionContext.test.ts](../../../../../../test/harness/PeerIdentityExecutionContext.test.ts)
Exercises: the harness execution context [test/harness/core/peerErrorAttribution.ts](../../../../../../test/harness/core/peerErrorAttribution.ts); harness code has no source report.

## Overview

Two cases for the inline harness's handling of a runtime cut by its disposal. Work collected
under a context that is then disposed, and that never settles (a send frozen at the cut), keeps
holding the drain within one reply-drain bound and counts as settled after it, while a live
sibling context's pending work keeps holding the drain. A failure raised under a disposed context
within that bound still surfaces through the drain. The context is harness code, so its bullets
stay `none`.

## Tests

- `releases a cut runtime's still pending work from the drain after the grace and keeps a live sibling's`: none
- `still surfaces a cut runtime's failure within the grace`: none
