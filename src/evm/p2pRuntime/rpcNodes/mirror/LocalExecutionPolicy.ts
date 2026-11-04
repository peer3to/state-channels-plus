/**
 * What the local EVM may run. The local EVM is an EVM: code the chain runs
 * on another machine, and addresses the chain answers with its own
 * precompiles, are not run here.
 */

/**
 * First bytes of a PolkaVM program blob: `b"PVM\0"`, 0x50 0x56 0x4d 0x00
 * (polkavm-common, `BLOB_MAGIC` in `program.rs`). Executing such code as EVM
 * bytecode would run garbage.
 */
const POLKAVM_BLOB_MAGIC = [0x50, 0x56, 0x4d, 0x00];

/**
 * Standard Ethereum precompiles revive implements and the local EVM runs
 * with the same results: ecrecover, sha256, ripemd160, identity, modexp,
 * bn128 add, mul and pairing, blake2f (`precompiles/builtin/*.rs`,
 * `BuiltinAddressMatcher::Fixed` 0x1 to 0x9). 0x0a (point evaluation) is not
 * implemented by revive (`point_eval.rs` fails the call with
 * `UnsupportedPrecompileAddress`), so it is not local.
 */
const LOCAL_STANDARD_PRECOMPILES = 9;

export function isPolkaVmCode(code: Uint8Array): boolean {
    return POLKAVM_BLOB_MAGIC.every((byte, i) => code[i] === byte);
}

/**
 * Whether the chain answers calls to `address` with a precompile of its own
 * that the local EVM does not reproduce. pallet-revive reserves two shapes
 * (`precompiles.rs`, `BuiltinAddressMatcher::base_address`: the matcher's
 * number sits in the last four bytes; `AddressMatcher::into_builtin`: an
 * external precompile's 16-bit number is shifted left by 16):
 *
 * - the builtin range, a 16-byte zero prefix and a number up to 0xffff:
 *   0x01 to 0x0a (the standard precompiles), 0x100 (P256Verify), 0x900
 *   (System), 0x901 (Storage), the rest reserved;
 * - the external range, 4 free bytes, 12 zero bytes, a nonzero 16-bit
 *   number and two zero bytes: the runtime's own precompiles (on Asset Hub
 *   the ERC20 asset ranges 0x0120, 0x0220 and 0x0320 as the last number, the
 *   XCM, asset conversion and vesting precompiles).
 *
 * The standard precompiles the local EVM matches are not included.
 */
export function isNodeOnlyAddress(address: Uint8Array): boolean {
    if (address.length !== 20) return false;
    const middleIsZero = address.slice(4, 16).every((byte) => byte === 0);
    if (!middleIsZero) return false;
    const prefixIsZero = address.slice(0, 4).every((byte) => byte === 0);
    // the external number, shifted left by 16 in the last four bytes
    const external = (address[16] << 8) | address[17];
    if (external !== 0 && address[18] === 0 && address[19] === 0) return true;
    if (!prefixIsZero || external !== 0) return false;
    // the builtin number
    const builtin = (address[18] << 8) | address[19];
    return builtin > LOCAL_STANDARD_PRECOMPILES;
}
