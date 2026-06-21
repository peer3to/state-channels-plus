import { ethers } from "ethers";
import type { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ExitChannelEthersType } from "@/types/ethers";

export const MathStateEthersType = `tuple(
    uint256 number,
    address[] participants,
    uint256[] balances,
    uint256 currentTurnIndex
    )`;
export const MESSAGE_TYPE_EXIT = ethers.keccak256(
    ethers.toUtf8Bytes("EXIT_CHANNEL_MESSAGE")
);

export type MathStateDecoded = {
    number: bigint;
    participants: string[];
    balances: bigint[];
    currentTurnIndex: bigint;
};

export function decodeMathState(encoded: string): MathStateDecoded {
    const [d] = ethers.AbiCoder.defaultAbiCoder().decode(
        [MathStateEthersType],
        encoded
    );
    return {
        number: d.number,
        participants: [...d.participants],
        balances: d.balances.map((b: bigint) => b),
        currentTurnIndex: d.currentTurnIndex
    };
}

export function encodeMathState(s: MathStateDecoded): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
        [MathStateEthersType],
        [
            {
                number: s.number,
                participants: s.participants,
                balances: s.balances,
                currentTurnIndex: s.currentTurnIndex
            }
        ]
    );
}

export function encodeExitChannelData(
    participant: string,
    balance: BalanceStruct
): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
        [ExitChannelEthersType],
        [
            {
                participant,
                balance: { amount: balance.amount, data: balance.data }
            }
        ]
    );
}
