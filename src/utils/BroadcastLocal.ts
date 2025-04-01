import { AddressLike } from "ethers";
import IOnMessage from "@/IOnMessage";
class BroadcastLocal {
    private static instance: BroadcastLocal;

    private map: Map<AddressLike, IOnMessage> = new Map<
        AddressLike,
        IOnMessage
    >();

    private constructor() {}

    public static getInstance(): BroadcastLocal {
        if (!BroadcastLocal.instance) {
            BroadcastLocal.instance = new BroadcastLocal();
        }
        return BroadcastLocal.instance;
    }

    public register(address: AddressLike, listener: IOnMessage) {
        this.map.set(address, listener);
    }

    public broadcast(serializedRPC: string) {
        this.map.forEach((value, key) => {
            value.onRpc(serializedRPC);
        });
    }
}

export default BroadcastLocal.getInstance();
