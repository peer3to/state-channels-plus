import IOnMessage from "@/IOnMessage";
import { Address } from "@/types/types";
class BroadcastLocal {
    private static instance: BroadcastLocal;

    private map: Map<Address, IOnMessage> = new Map<Address, IOnMessage>();

    private constructor() {}

    public static getInstance(): BroadcastLocal {
        if (!BroadcastLocal.instance) {
            BroadcastLocal.instance = new BroadcastLocal();
        }
        return BroadcastLocal.instance;
    }

    public register(address: Address, listener: IOnMessage) {
        this.map.set(address, listener);
    }

    public broadcast(serializedRPC: string) {
        this.map.forEach((value, key) => {
            value.onRpc(serializedRPC);
        });
    }
}

export default BroadcastLocal.getInstance();
