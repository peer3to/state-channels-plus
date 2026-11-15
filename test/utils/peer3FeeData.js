// @spec-test-coverage-ignore: test-chain fee quote for the peer3 dev node; executable evidence belongs to the tests that send transactions
// Test transactions on the peer3 dev node run paid: the node's base fee and
// eth_gasPrice are 0, which asks for the free lane, and tests set no lane
// target. Every ethers provider on the test chain id quotes twice the lane's
// current paid floor instead. Loaded through NODE_OPTIONS so the SDK's worker
// threads, which build their own providers, get the same quote.
const { FetchUrlFeeDataNetworkPlugin, Network } = require("ethers");

/** The dev node's EVM chain id (peer3-parachain genesis_config_presets.rs). */
const PEER3_CHAIN_ID = 420042;
/** twox128("FreeLane") ++ twox128("State"): (block u32, gas [u64; 3], paid exponent u16). */
const LANE_STATE_KEY =
    "0xf8753f41bb0fe3d5ecb7554454f77ac6f39a107f2d8d3854c9aba9b021f43d9c";
/** free_lane_rules.rs: floor = P0 << (min(exponent, MAX_PAID_EXP) / 4). */
const P0 = 1_000_000_000n;
const MAX_PAID_EXP = 128;
/** The exponent may rise one a block; four steps ahead is twice the floor. */
const EXPONENT_MARGIN = 4;

function paidFloor(exponent) {
    return P0 << BigInt(Math.floor(Math.min(exponent, MAX_PAID_EXP) / 4));
}

/** The paid exponent in the lane state's SCALE bytes, 0 when never written. */
function paidExponent(encodedLaneState) {
    if (!encodedLaneState) return 0;
    const bytes = Buffer.from(encodedLaneState.slice(2), "hex");
    return bytes.readUInt16LE(28);
}

function peer3Network() {
    const network = new Network("peer3-test", PEER3_CHAIN_ID);
    // getFeeData calls processFunc and never fetches the URL
    network.attachPlugin(
        new FetchUrlFeeDataNetworkPlugin(
            "http://127.0.0.1/",
            async (_feeData, provider) => {
                const exponent = paidExponent(
                    await provider.send("state_getStorage", [LANE_STATE_KEY])
                );
                return {
                    gasPrice: paidFloor(exponent + EXPONENT_MARGIN),
                    maxFeePerGas: null,
                    maxPriorityFeePerGas: null
                };
            }
        )
    );
    return network;
}

// the source and the compiled copy may both load in one process
if (Network.from(PEER3_CHAIN_ID).name !== "peer3-test")
    Network.register(PEER3_CHAIN_ID, peer3Network);

if (!(process.env.NODE_OPTIONS ?? "").includes("peer3FeeData.js"))
    process.env.NODE_OPTIONS =
        `${process.env.NODE_OPTIONS ?? ""} -r ${__filename}`.trim();
