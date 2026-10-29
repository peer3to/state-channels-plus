# logChunks.test.ts

Test file: [test/scripts/logChunks.test.ts](../../../../../../test/scripts/logChunks.test.ts)

## Overview

The suite calls the chunk helpers the crash-log server shares with its tests: naming, encoding, and
the merge of many stored chunks into one ordered stream. Oracles are the merged messages and the
skipped-chunk count. It covers naming and parsing by sequence range, three threads merged by wall
clock, an overlapping resend merged without duplicates, an undecodable chunk skipped while the rest
survive, a missing chunk leaving its gap, a merged read that stops at the shared inflate budget and
reports it, a single chunk refused when it inflates past the ceiling, and an entry without a wall
clock dropped without shifting the sequence of those after it.

## Tests

- `names and parses a chunk by its sequence range`: none
- `merges three threads into one ordered stream`: none
- `merges overlapping chunks without duplicates`: REQ-LOG-5-ST6S0G.T1.P3
- `skips an undecodable chunk`: REQ-LOG-7-M2RC5W.T1.P3
- `keeps the gap when a chunk is missing`: none
- `stops a merged read at the shared inflate budget and reports it`: none
- `refuses a chunk that inflates past the configured maximum`: REQ-LOG-7-M2RC5W.T1.P1
- `drops an entry with no wall-clock timestamp from the merge`: none
- `keeps the sequence of entries after a dropped one aligned`: none
