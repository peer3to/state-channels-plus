// @spec-test-coverage-ignore: recorded chain data used by the mapped SubstrateHeader and proveFrontierStorageBlock declarations

/**
 * Blocks a peer3 dev node (`zero-fee-node` at d845dbfb) pushed through the
 * light client sidecar to a subscriber of topic 1 of a contract that stores
 * what it is called with and logs the slot as its topic. With each block: the
 * block hash the node reports for the header's number (`chain_getBlockHash`)
 * and the hash of its Ethereum block (`eth_getBlockByNumber`).
 *
 * - `pushes[0]`: slot 1 written.
 * - `pushes[1]`: slots 1 and 2 written by two transactions of one block; only
 *   the first one's log carries the subscribed topic.
 * - `pushes[2]`: slot 1 set back to zero.
 */
export const peer3PushedBlocks = {
    address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    pushes: [
        {
            block: {
                header: {
                    parentHash:
                        "0xf648138a6076049ecaaaa52a377cc8bb65a3631693e1d21967ac14d54bd61dd1",
                    number: "0x4",
                    stateRoot:
                        "0xeba4988fc8bd668493cd9cfe6222858e91f568cb0ba4c89508837933f7705e35",
                    extrinsicsRoot:
                        "0xf8e55355a6ed286dff4fcdd5cafbf2938997a0ed3485d0f0f559a1f0ff330430",
                    digest: {
                        logs: [
                            "0x0661757261200bfed41100000000",
                            "0x0452505352901871217bbd1dd09e5ffe8580bae2891491a37fdc0363d0aac0bd5a4b9cfd51932ef85347",
                            "0x0466726f6e0901016d24af192e7978fba9b42a208db57db30a5d021d634d8a177036f38580d72de804677722f5a01e54400be18aa3f312fd7d7cf76c8a2fb1052dd684c3d70aae5c65"
                        ]
                    }
                },
                writes: [
                    {
                        slot: "0x0000000000000000000000000000000000000000000000000000000000000001",
                        value: "0x000000000000000000000000000000000000000000000000000000000000aaaa"
                    }
                ],
                proofNodes: [
                    "0x7f680039e0d679327fcf7dbbb3d18f390cd95fbdb2315678afecb367f032d93f642f64180aa37af7fa355ea131795dc480485b6c64c9000000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000aaaa",
                    "0x8020208050accb8babebb606429ccc564c3ce71c4bd016d851f0d758f6d73a3569f4e84f80e5781fd18fa2d42a264543b429348d3782821833d9faa2c967060090437e45d7",
                    "0x80bff880ac11c452b9a632923215a89ab09e839991d4eaad6e53338d639b734cfc2435f180e3dadfc875a87dae571465c6be841372d368fa0ac7ca129b576b0695abda4f48807f0ba02c1866a775da056e2800263d3dc58831c869d0c683330319a3ed0d482480d90367b5f057b90c3c56f2716f13ed02b2b6fde81142412f810be57553d250e980b3c71a2250b2ee1a7f3b806c2fa5ac2aa60bc89db117d6ab2abcc9e5b50e859c806c6662649d99a53b6acb61db7c779382f280dee31efc1f110c28ddaebe3891fd8058fc645bdbdbc45acc58128dde94301b703698c3f17445f63cfae9c26350aea680f2c3d285e3dd08234aa11f65b76988cdc22b4e413861086dff38f0090c759a7d80395800467b66067c9e501fd1cf2cca1f40c83e0d54fd6bfcca8ee54f5d0e11fc80b031bf07fbc970659db35518eb2c5bc27718504f95cb4ab97b40799988113c55804aa89afbb86d611e668299d54779dff518ddd14205674a1eaa5cb5a7e800438e805db3297876f8d7b4a7713695a1dd7cc00cd325c4c0d2b2d1eef42e5d4ccaa6e0",
                    "0x9ea53b775b270400e7e61ed5cbc5a1461054505f0e7b9012096b41c4eb3aaf947f6ea42908000080030725fbbacf0a3ba9eeb841001af3e385610dbdd57b93689895a813b57f575a80af45a33f4b7b3589940923c0574685a59fbf7a847e8d536c58920f54f5ad810c80ecdf83d6a203808bbd54100b41193afdcd043d3de04a53264f4844ea561e94a7",
                    "0x9f0b1160471b1418779239ba8e2b847e42000d80e5a2801c46230da458d25299ad7412690d4ba9d99372ecb92b70f1a9151368a6806eb1267afa82f13ae2fc5b71501ed2399c6cf955472bcf00445538bd78ae6b1a80df10e421d80506b7ef5f2c7a0b10135712b297394d30331ffd1a95f72fe82475"
                ],
                logs: [
                    {
                        address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
                        topics: [
                            "0x0000000000000000000000000000000000000000000000000000000000000001"
                        ],
                        data: "0x",
                        blockHash:
                            "0x6d24af192e7978fba9b42a208db57db30a5d021d634d8a177036f38580d72de8",
                        blockNumber: "0x4",
                        transactionHash:
                            "0x677722f5a01e54400be18aa3f312fd7d7cf76c8a2fb1052dd684c3d70aae5c65",
                        transactionIndex: "0x0",
                        logIndex: "0x0",
                        transactionLogIndex: "0x0",
                        removed: false
                    }
                ]
            },
            substrateBlockHash:
                "0x50c1f9d75dcee9a18276b767257715bf4d9364d2edc4d47a2fc0bf567b51328a",
            ethereumBlockHash:
                "0x6d24af192e7978fba9b42a208db57db30a5d021d634d8a177036f38580d72de8"
        },
        {
            block: {
                header: {
                    parentHash:
                        "0x5b83520fa31acb0cc6689c6c778fd5aac3350dbb6853aa745671af0158cb1b69",
                    number: "0x8",
                    stateRoot:
                        "0x5fd8326274264f28dd1e6403ae7fab3c284c2979b0c923a1aecfa6fb4db23fe5",
                    extrinsicsRoot:
                        "0xcf3316f2650dd8e0aede2cad0414a79631288c0f2b7aaa1abd355f87d3dfff15",
                    digest: {
                        logs: [
                            "0x0661757261200dfed41100000000",
                            "0x0452505352906d1a747a31353e1cb038138487407ad42729b81cedae1103d6728c32c431faea36f85347",
                            "0x0466726f6e8901018f1c233992c01c287bfdf968e80d94b1ed90e4fefc1ca98d7018c00eaa62e999085cc5dfa6aa8abd878961024dd9ad82eee17cc78fe0b49a9a377c9581d58e41f4e77bbd3a150208ce44d8693e0c40b08b72ffe5414c29dbae28f406a6a005c227"
                        ]
                    }
                },
                writes: [
                    {
                        slot: "0x0000000000000000000000000000000000000000000000000000000000000002",
                        value: "0x000000000000000000000000000000000000000000000000000000000000dddd"
                    },
                    {
                        slot: "0x0000000000000000000000000000000000000000000000000000000000000001",
                        value: "0x000000000000000000000000000000000000000000000000000000000000cccc"
                    }
                ],
                proofNodes: [
                    "0x7f200649d8fcd39471b32a600d9c85a03f38000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000dddd",
                    "0x7f200af7fa355ea131795dc480485b6c64c9000000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000cccc",
                    "0x80202080bdd94e413b3ac6b6b5b411e7d8acbe29b6468e2c51c80712bf5ce30f60fd9393806b5a197381d63efcd5c45d971498523ea0c03900af5e0328f586f77c891a593e",
                    "0x80bff880ac11c452b9a632923215a89ab09e839991d4eaad6e53338d639b734cfc2435f1804df568c6d58e059fbf12acb768fcae072d03f63b090fe04abf4509a85b2e8d7d8028cd6cc914825c3b2e7cadbcaf2fa0d4ca46013d143c25476b8506837f8ac233805a151502eb2a1e2461023016a2d0fcf34e65fcd456f99cd77fff63898cc5588580dfa48a8b280eeb400bd40150717a90b71516c0668c5abdabb07698d1744ad6a980d38d0dd0df4debda4576b6b08d9a172681698ffb8a57ae2e69a4da6e5ee11f338058fc645bdbdbc45acc58128dde94301b703698c3f17445f63cfae9c26350aea680f2c3d285e3dd08234aa11f65b76988cdc22b4e413861086dff38f0090c759a7d8097d7be42227a9885df75ef23a45a25cfb8bf6b3ed8b1e54be330c065126b9ad780b031bf07fbc970659db35518eb2c5bc27718504f95cb4ab97b40799988113c55804aa89afbb86d611e668299d54779dff518ddd14205674a1eaa5cb5a7e800438e80ca9396bf6b8a9c14d13f6b322b2b73383128c2c965d104b90138387be21d58dd",
                    "0x9ea53b775b270400e7e61ed5cbc5a1461054505f0e7b9012096b41c4eb3aaf947f6ea4290800008094e29152d48571faf58ed5b93d9f79207271e8ab687f1baefa8d82492e417cca80af45a33f4b7b3589940923c0574685a59fbf7a847e8d536c58920f54f5ad810c80ecdf83d6a203808bbd54100b41193afdcd043d3de04a53264f4844ea561e94a7",
                    "0x9f0b1160471b1418779239ba8e2b847e42000d80cfa0392c298f16623af77fddd7200df20ca4ca6c5a41eeac46c3c1d85b07bf0f806eb1267afa82f13ae2fc5b71501ed2399c6cf955472bcf00445538bd78ae6b1a80df10e421d80506b7ef5f2c7a0b10135712b297394d30331ffd1a95f72fe82475",
                    "0xbf080039e0d679327fcf7dbbb3d18f390cd95fbdb2315678afecb367f032d93f642f64180aa3810080b1e9c2bcfee0ab984f60578888c6ec64e65ecdd9a0b3b66d17a6b5513d555ceb80ee2d2cd21e8fcaba1fe54a3e305ea945f925b51f148d219a6dfc2b9d113f9a2c"
                ],
                logs: [
                    {
                        address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
                        topics: [
                            "0x0000000000000000000000000000000000000000000000000000000000000001"
                        ],
                        data: "0x",
                        blockHash:
                            "0x8f1c233992c01c287bfdf968e80d94b1ed90e4fefc1ca98d7018c00eaa62e999",
                        blockNumber: "0x8",
                        transactionHash:
                            "0x5cc5dfa6aa8abd878961024dd9ad82eee17cc78fe0b49a9a377c9581d58e41f4",
                        transactionIndex: "0x0",
                        logIndex: "0x0",
                        transactionLogIndex: "0x0",
                        removed: false
                    }
                ]
            },
            substrateBlockHash:
                "0x3f7be38b20a4b27af84ad0debcdeeac1720ded0346cbd13938c81011bf910598",
            ethereumBlockHash:
                "0x8f1c233992c01c287bfdf968e80d94b1ed90e4fefc1ca98d7018c00eaa62e999"
        },
        {
            block: {
                header: {
                    parentHash:
                        "0xde81303bbc9ba4196b0f7ab3eb23213faa04d9db44966d334adf63a6ba411d05",
                    number: "0xa",
                    stateRoot:
                        "0x1349612bd86e65c53d62d9ec2c890c0ca2c649580c359133c2543c6721edf2f3",
                    extrinsicsRoot:
                        "0xf73cb809e415518a39d703e047cc965b716c7afae69a15b797ee358df2a127d0",
                    digest: {
                        logs: [
                            "0x0661757261200dfed41100000000",
                            "0x04525053529035c22ada26b68f081efefb0355651814dff37f731473dda7296a6f52a4f4d1a436f85347",
                            "0x0466726f6e090101e7a50aa8055dece7f6406a38fe782ec873fe1eb0afb2e3caed9bff49b1d0afd50439ce444a0d3a00b651efe66cf93ef0b1a97df79b07babd2eff2a782a0b3da143"
                        ]
                    }
                },
                writes: [
                    {
                        slot: "0x0000000000000000000000000000000000000000000000000000000000000001",
                        value: null
                    }
                ],
                proofNodes: [
                    "0x7f680039e0d679327fcf7dbbb3d18f390cd95fbdb2315678afecb367f032d93f642f64180aa30649d8fcd39471b32a600d9c85a03f38000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000dddd",
                    "0x80202080853e01c7c8a451a92fd27ac3992c5e0959cb686ab226ab8516ad18c25edce9ed8037e3c6a3ab90e4290890eed3ccb28e40baf22fad06b0c221299309a1449370f4",
                    "0x80bff880ac11c452b9a632923215a89ab09e839991d4eaad6e53338d639b734cfc2435f1800abb7c46a598b2b6370464a8fd88e9ef3bc6d6339ba3c665a52126256448d1ed807c99a1201e177f042fe6b3264834454c57d28e268f9cc3b9bd80706f3a140ad3803a8fb3799defcf6ed84718be9763eb3b2744751fd8c1d6348a7f9f0bdc06ff04809aceb7f6fdfe627313dd553bf755028aa1a4eb8e5351cc91a8a779f7184c777b80d38d0dd0df4debda4576b6b08d9a172681698ffb8a57ae2e69a4da6e5ee11f338058fc645bdbdbc45acc58128dde94301b703698c3f17445f63cfae9c26350aea680f2c3d285e3dd08234aa11f65b76988cdc22b4e413861086dff38f0090c759a7d8054e46c4571b4e1c4f61f6909f3824e272d5692819e6f06805f86a7a18465959a80b031bf07fbc970659db35518eb2c5bc27718504f95cb4ab97b40799988113c55804aa89afbb86d611e668299d54779dff518ddd14205674a1eaa5cb5a7e800438e80eeae506039f3b4d45cb097cb407da4916bbb1b2c38eb03343fa1e9b16436dccf",
                    "0x9ea53b775b270400e7e61ed5cbc5a1461054505f0e7b9012096b41c4eb3aaf947f6ea429080000804fe816e93547274800d52b10b69b6b931f1e89fcafea39b9f14a9618bc165cb280af45a33f4b7b3589940923c0574685a59fbf7a847e8d536c58920f54f5ad810c80ecdf83d6a203808bbd54100b41193afdcd043d3de04a53264f4844ea561e94a7",
                    "0x9f0b1160471b1418779239ba8e2b847e42000d80c4c24155e6b0938c94d912cd3d0bf8bb3f0c8586f9c2d3c26ac0669a3724c271806eb1267afa82f13ae2fc5b71501ed2399c6cf955472bcf00445538bd78ae6b1a80df10e421d80506b7ef5f2c7a0b10135712b297394d30331ffd1a95f72fe82475"
                ],
                logs: [
                    {
                        address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
                        topics: [
                            "0x0000000000000000000000000000000000000000000000000000000000000001"
                        ],
                        data: "0x",
                        blockHash:
                            "0xe7a50aa8055dece7f6406a38fe782ec873fe1eb0afb2e3caed9bff49b1d0afd5",
                        blockNumber: "0xa",
                        transactionHash:
                            "0x39ce444a0d3a00b651efe66cf93ef0b1a97df79b07babd2eff2a782a0b3da143",
                        transactionIndex: "0x0",
                        logIndex: "0x0",
                        transactionLogIndex: "0x0",
                        removed: false
                    }
                ]
            },
            substrateBlockHash:
                "0xc47851be379a0366ed0dc470a854da544ce58d43491250e02bc3ce94f80c3921",
            ethereumBlockHash:
                "0xe7a50aa8055dece7f6406a38fe782ec873fe1eb0afb2e3caed9bff49b1d0afd5"
        }
    ]
};
