export enum TransportType {
    HOLEPUNCH,
    WEBRTC,
    LOOPBACK,
    /** a worker port: this process's own thread on the far end */
    MESSAGE_PORT
}
