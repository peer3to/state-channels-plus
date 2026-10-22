# EventHandlerSpectatorDispute.test.ts

Test file: [test/unit/EventHandlerSpectatorDispute.test.ts](../../../../../../test/unit/EventHandlerSpectatorDispute.test.ts)

## Overview

Observes a real dispute as a spectator and checks commitment and fork handling without entering participant audit work. The final-dispute case cuts a synced spectator off, lets the four participants finalize one more block, and posts a threshold-final dispute over a double sign: the spectator sees the dispute from chain events only and never held its latest block. Once its handler ran it is still open, SYNCED and on the disputed fork; reconnected, it reaches the dispute's output fork and stays SYNCED.

## Tests

- `a spectator does not audit a committed dispute: no audit read, no dispute fraud proof, and it later reduces; a participant audits the same dispute`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12
- `a spectator behind a threshold-final dispute's latest block defers its genesis instead of aborting, stays SYNCED and reaches the dispute's output fork`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P26, REQ-DVP-2-RG8QR3.T1.P7
