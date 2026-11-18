/** A storage proof that does not prove what it was given for. */
export default class StorageProofError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StorageProofError";
    }
}
