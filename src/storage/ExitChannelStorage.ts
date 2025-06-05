import { BytesLike, hexlify } from "ethers";
import { ExitChannelBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

export class ExitChannelStorageModule {
    //map [blockHash] => ExitChannelBlockStruct
    private exitChannelBlockMap: Map<string, ExitChannelBlockStruct>;
    //TODO: check if BytesLike is more efficient than string
    // we can either store the hash or the key to the exitChannelBlockHashesMap data
    private latestExitChannelBlockHash: BytesLike;

    constructor() {
        this.exitChannelBlockMap = new Map();
        this.latestExitChannelBlockHash = "0x00";
    }

    /**
     * Store the block hash for an exit channel block
     */
    storeExitChannelBlockHash(
        blockHash: string,
        exitChannelBlock: ExitChannelBlockStruct
    ) {
        this.exitChannelBlockMap.set(blockHash, exitChannelBlock);
        this.latestExitChannelBlockHash = blockHash;
    }

    /**
     * Retrieve the block hash for an exit channel block
     */
    getExitChannelBlock(blockHash: string): ExitChannelBlockStruct | undefined {
        return this.exitChannelBlockMap.get(blockHash);
    }

    getLatestExitChannelBlockHash(): string {
        return hexlify(this.latestExitChannelBlockHash);
    }
}
