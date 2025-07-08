import { Timestamp } from "./types";

export type TimeConfig = {
    p2pTime: Timestamp;
    agreementTime: Timestamp;
    chainFallbackTime: Timestamp;
    challengeTime: Timestamp;
};
