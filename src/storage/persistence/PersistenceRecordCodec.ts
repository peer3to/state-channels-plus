export type CollectionId =
    | "blocks"
    | "inboundMessages"
    | "outboundMessages"
    | "stateSnapshots"
    | "stateMachineStates"
    | "participantSetChanges"
    | "queues"
    | "disputes"
    | "disputedForks"
    | "fraudProofs"
    | "disputeFraudProofs"
    | "timeout"
    | "forceExit"
    | "forceJoin"
    | "blockCalldata"
    | "eventSync"
    | "runtimeMetadata";

export interface PersistenceValueCodec<TValue> {
    encode(value: TValue): string;
    decode(encodedValue: string): TValue;
}

export class PersistenceRecordCodec {
    private readonly codecs = new Map<
        CollectionId,
        PersistenceValueCodec<unknown>
    >();

    public register<TValue>(
        collectionId: CollectionId,
        codec: PersistenceValueCodec<TValue>
    ): PersistenceValueCodec<TValue> {
        if (this.codecs.has(collectionId)) {
            throw new Error(
                `Persistence codec already registered for ${collectionId}`
            );
        }
        this.codecs.set(collectionId, codec as PersistenceValueCodec<unknown>);
        return codec;
    }

    public encode<TValue>(collectionId: CollectionId, value: TValue): string {
        return this.get<TValue>(collectionId).encode(value);
    }

    public decode<TValue>(
        collectionId: CollectionId,
        encodedValue: string
    ): TValue {
        return this.get<TValue>(collectionId).decode(encodedValue);
    }

    private get<TValue>(
        collectionId: CollectionId
    ): PersistenceValueCodec<TValue> {
        const codec = this.codecs.get(collectionId);
        if (!codec) {
            throw new Error(
                `Persistence codec is not registered for ${collectionId}`
            );
        }
        return codec as PersistenceValueCodec<TValue>;
    }
}
