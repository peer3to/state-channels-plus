// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import {LightClientToken} from "./LightClientToken.sol";

/**
 *  What `LightClientProbe` creates: a contract with one answer.
 */
contract LightClientProbeChild {
    function answer() external pure returns (uint256) {
        return 42;
    }
}

/**
 * Calls whose answer depends on how the EVM runs them, for the light client's
 * tests to compare its local run with the node's: writes in a frame that
 * reverts, value transfers, created contracts, the code
 * size limit, precompile addresses, reads that each name the next slot,
 * reads of several slots that do not depend on each other, and a read of
 * this contract's slots together with another contract's, an ERC-20
 * balance of a holder this contract names;
 * and a revert with no data that depends on the state. Also one transaction
 * of several calls, for the benchmark's transactions that touch several
 * channels.
 */
contract LightClientProbe {
    uint256 public value;
    /**
     * A list of slots: `next[i]` names the slot after `i`; 0 ends it.
     */
    mapping(uint256 => uint256) public next;

    /**
     * Logged by `touch` with the channel as its indexed topic, as the state
     * channel manager logs a channel id.
     */
    event Touched(bytes32 indexed channel);

    function setValue(uint256 newValue) external {
        value = newValue;
    }

    /**
     * Writes `newValue` and reverts.
     */
    function writeAndRevert(uint256 newValue) external {
        value = newValue;
        revert("reverted");
    }

    /**
     * Reverts with no data once `value` is set.
     */
    function requireUnset() external view {
        require(value == 0);
    }

    /**
     * `value` after a sub-call wrote `newValue` and reverted.
     */
    function valueAfterRevertedWrite(uint256 newValue) external returns (uint256) {
        try this.writeAndRevert(newValue) {} catch {}
        return value;
    }

    /**
     * Sends what the call carries to `to`; the balances of both after.
     */
    function forward(address payable to) external payable returns (uint256, uint256) {
        (bool sent,) = to.call{value: msg.value}("");
        require(sent, "not sent");
        return (address(this).balance, to.balance);
    }

    /**
     * Creates a child, lets a sub-call revert, and asks the child.
     */
    function createThenRevertInside() external returns (uint256) {
        LightClientProbeChild child = new LightClientProbeChild();
        try this.writeAndRevert(1) {} catch {}
        return child.answer();
    }

    /**
     * Creates a child with CREATE2 and reverts.
     */
    function createAndRevert(bytes32 salt) external {
        new LightClientProbeChild{salt: salt}();
        revert("reverted");
    }

    /**
     * The code size at the address a child created in a frame that reverted would have.
     */
    function codeSizeAfterRevertedCreate(bytes32 salt) external returns (uint256 size) {
        try this.createAndRevert(salt) {} catch {}
        address predicted = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(this), salt, keccak256(type(LightClientProbeChild).creationCode)
                        )
                    )
                )
            )
        );
        assembly {
            size := extcodesize(predicted)
        }
    }

    /**
     * The address of a contract created with 24,577 bytes of code: zero where EIP-170 holds.
     */
    function createOverSizeLimit() external returns (address created) {
        // PUSH2 0x6001 PUSH1 0 RETURN: returns 24,577 zero bytes as the code
        bytes memory initCode = hex"6160016000f3";
        assembly {
            created := create(0, add(initCode, 32), mload(initCode))
        }
    }

    /**
     * Whether a call with no input to `target` succeeds, and how much it returns.
     */
    function callWithoutInput(address target) external returns (bool ok, uint256 returned) {
        assembly {
            ok := call(gas(), target, 0, 0, 0, 0, 0)
            returned := returndatasize()
        }
    }

    /**
     * Makes a list of `length` slots: 0 names 1, 1 names 2, ..., and `length` ends it.
     */
    function link(uint256 length) external {
        for (uint256 slot = 0; slot < length; slot++) {
            next[slot] = slot + 1;
        }
    }

    /**
     * The sum of what the slots `slots` name, each read without the others.
     */
    function sumOf(uint256[] calldata slots) external view returns (uint256 total) {
        for (uint256 i = 0; i < slots.length; i++) {
            total += next[slots[i]];
        }
    }

    /**
     * Stores `newValue` at `slot` of the list and logs `channel`.
     */
    function touch(bytes32 channel, uint256 slot, uint256 newValue) external {
        next[slot] = newValue;
        emit Touched(channel);
    }

    /**
     * The sum of what this contract's slots `slots` name and what `other`
     * answers for its slots `otherSlots`.
     */
    function sumWith(address other, uint256[] calldata slots, uint256[] calldata otherSlots)
        external
        view
        returns (uint256 total)
    {
        for (uint256 i = 0; i < slots.length; i++) {
            total += next[slots[i]];
        }
        total += LightClientProbe(other).sumOf(otherSlots);
    }

    /**
     * What the address in this contract's slot `holderSlot` holds of the
     * ERC-20 `token`, and the token's supply. The balance's storage key is
     * known only once the holder is read and the token's code runs.
     */
    function tokenHolding(LightClientToken token, uint256 holderSlot)
        external
        view
        returns (uint256 balance, uint256 supply)
    {
        balance = token.balanceOf(address(uint160(next[holderSlot])));
        supply = token.totalSupply();
    }

    /**
     * Calls `target` with each of `calls` in turn; reverts when one of them fails.
     */
    function callEach(address target, bytes[] calldata calls) external {
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok,) = target.call(calls[i]);
            require(ok, "call failed");
        }
    }

    /**
     * Walks the list from slot 0; how many slots it named.
     */
    function walk() external view returns (uint256 count) {
        for (uint256 slot = next[0]; slot != 0; slot = next[slot]) {
            count++;
        }
    }
}
