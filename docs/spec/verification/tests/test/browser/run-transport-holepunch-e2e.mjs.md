# run-transport-holepunch-e2e.mjs

Test file: [test/browser/run-transport-holepunch-e2e.mjs](../../../../../../test/browser/run-transport-holepunch-e2e.mjs)

## Overview

The runner behind package script `test:browser:transport:holepunch` (shared driver
`transportPermutations.mjs`) starts a Hardhat node mining once a second, real Hyperswarm through dht-relay WebSocket servers on a private HyperDHT testnet (`localHolepunch.js`, served from the SDK's own `@hyperswarm/dht-relay` dependency), a Vite dev
server, and headless Chromium. Each SDK runtime runs in its own browser context and page
(`RUN_SDK_IN_THREAD`, WebRTC on the page through the bridge) and authors a `MathStateMachine`
block on each of its turns. Two pages join one lobby topic at the same moment; the oracles are one
matched channel and both pages participating, only WebRTC connections from the upgrade grace end
until three agreement windows after participation, and at least three finalized blocks per page in
that window. The gate then closes the WebRTC connections of one page and requires a bootstrap
connection on both pages within one agreement window and three more finalized blocks per page.
Three new pages then select one channel with `connectToChannel` (no lobby): the genesis
participant before the on-chain opening, then the second participant and the observer together
after it, while both participants may still be syncing; the oracles are `true` from each connect, a connection between every
pair, three more finalized blocks per participant, and the observer at `SYNCED`. Any page error or
console error fails the run; an uncaught relay error ends the gate process.

## Tests

- `package script test:browser:transport:holepunch`: REQ-UPG-4-M2XDBA.T1.P14, REQ-UPG-7-61PHDB.T1.P2, REQ-UPG-7-61PHDB.T1.P4, REQ-UPG-8-06HTCM.T1.P2
