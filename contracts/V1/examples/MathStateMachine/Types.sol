pragma solidity ^0.8.8;

//Just so typechain generates types for the structs bellow
contract MathTypes {
    constructor(JoinChannel memory a) {}
}

struct JoinChannel {
    address participant;
    bytes32 channelId;
    uint amount;
    uint timestampDeadline;
}
