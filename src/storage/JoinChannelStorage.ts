import { BytesLike, hexlify } from "ethers";
import { JoinChannelBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

export class JoinChannelStorageModule {
    //map [blockHash] => JoinChannelBlockStruct
    private joinChannelBlockMap: Map<string, JoinChannelBlockStruct>;
    //TODO: check if BytesLike is more efficient than string
    // we can either store the hash or the key to the joinChannelBlockHashesMap data
    private latestJoinChannelBlockHash: BytesLike;

    constructor() {
        this.joinChannelBlockMap = new Map();
        this.latestJoinChannelBlockHash = "0x00";
    }

    /**
     * Store the block hash for a join channel block
     */
    storeJoinChannelBlockHash(
        blockHash: string,
        joinChannelBlock: JoinChannelBlockStruct
    ) {
        this.joinChannelBlockMap.set(blockHash, joinChannelBlock);
        this.latestJoinChannelBlockHash = blockHash;
    }

    /**
     * Retrieve the block hash for a join channel block
     */
    getJoinChannelBlock(blockHash: string): JoinChannelBlockStruct | undefined {
        return this.joinChannelBlockMap.get(blockHash);
    }

    getLatestJoinChannelBlockHash(): string {
        return hexlify(this.latestJoinChannelBlockHash);
    }
}
