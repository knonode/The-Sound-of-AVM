// Transaction type weights (total 100)
const TYPE_WEIGHTS = {
    pay: 35,      // Payment transactions (35%)
    axfer: 25,    // Asset transfers (25%)
    appl: 20,     // Application calls (20%)
    acfg: 7,      // Asset configuration (7%)
    keyreg: 5,    // Key registration (5%)
    afrz: 4,      // Asset freeze (4%)
    stpf: 2,      // State proof (2%)
    hb: 2         // Heartbeat (2%)
};

// Subtypes for each main type
const SUBTYPES = {
    pay: ['pay', 'closeacc'],
    axfer: ['opt-in', 'opt-out', 'axfer', 'clawback'],
    appl: ['create', 'update', 'delete', 'opt-in', 'close out', 'clear state', 'NoOp'],
    acfg: ['create', 'reconfigure', 'destroy'],
    keyreg: ['online', 'offline'],
    afrz: ['afrz'],
    stpf: ['stpf'],
    hb: ['hb']
};

// Template transactions from sorting_prompt.md examples
const TX_TEMPLATES = {
    // Payment transactions
    pay: {
        pay: {
            type: "pay",
            fee: 1000,
            fv: 6000000,
            gen: "testnet-v1.0",
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 6001000,
            note: "SGVsbG8gV29ybGQ=",
            amt: 5000000
        },
        closeacc: {
            type: "pay",
            close: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
            fee: 1000,
            fv: 4695599,
            gen: "testnet-v1.0",
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 4696599
        }
    },

    // Asset Transfer transactions
    axfer: {
        "opt-in": {
            type: "axfer",
            arcv: "QC7XT7QU7X6IHNRJZBR67RBMKCAPH67PCSX4LYH4QKVSQ7DQZ32PG5HSVQ",
            fee: 1000,
            fv: 6631154,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 6632154,
            xaid: 168103
        },
        "opt-out": {
            type: "axfer",
            aclose: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
            arcv: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
            fee: 1000,
            fv: 6633154,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 6634154,
            xaid: 168103
        },
        axfer: {
            type: "axfer",
            aamt: 1000000,
            arcv: "QC7XT7QU7X6IHNRJZBR67RBMKCAPH67PCSX4LYH4QKVSQ7DQZ32PG5HSVQ",
            fee: 3000,
            fv: 7631196,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 7632196,
            xaid: 168103
        },
        clawback: {
            type: "axfer",
            aamt: 500000,
            arcv: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
            asnd: "QC7XT7QU7X6IHNRJZBR67RBMKCAPH67PCSX4LYH4QKVSQ7DQZ32PG5HSVQ",
            fee: 1000,
            fv: 7687457,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 7688457,
            xaid: 168103
        }
    },

    // Application transactions
    appl: {
        create: {
            type: "appl",
            apap: "BYEB",
            apgs: {
                nbs: 1,
                nui: 1
            },
            apls: {
                nbs: 1,
                nui: 1
            },
            apsu: "BYEB",
            fee: 1000,
            fv: 12774,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 13774
        },
        update: {
            type: "appl",
            apan: 4,
            apap: "BYEB",
            apid: 51,
            apsu: "BYEB",
            fee: 1000,
            fv: 12973,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 13973
        },
        delete: {
            type: "appl",
            apan: 5,
            apid: 51,
            fee: 1000,
            fv: 13555,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 14555
        },
        "opt-in": {
            type: "appl",
            apan: 1,
            apid: 51,
            fee: 1000,
            fv: 13010,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 14010
        },
        "close out": {
            type: "appl",
            apan: 2,
            apid: 51,
            fee: 1000,
            fv: 13166,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 14166
        },
        "clear state": {
            type: "appl",
            apan: 3,
            apid: 51,
            fee: 1000,
            fv: 13231,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 14231
        },
        "NoOp": {
            type: "appl",
            apaa: ["ZG9jcw==", "AAAAAAAAAAE="],
            apas: [16],
            apat: ["4RLXQGPZVVRSXQF4VKZ74I6BCUD7TUVROOUBCVRKY37LQSHXORZV4KCAP4"],
            apfa: [10],
            apbx: [{ "i": 51, "n": "Y29vbF9ib3g=" }],
            apid: 51,
            fee: 1000,
            fv: 13376,
            gh: "ALXYc8IX90hlq7olIdloOUZjWfbnA3Ix1N5vLn81zI8=",
            lv: 14376
        }
    },

    // Key registration transactions
    keyreg: {
        online: {
            type: "keyreg",
            fee: 2000,
            fv: 6002000,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 6003000,
            selkey: "X84ReKTmp+yfgmMCbbokVqeFFFrKQeFZKEXG89SXwm4=",
            votekey: "eXq34wzh2UIxCZaI1leALKyAvSz/+XOe0wqdHagM+bw=",
            votefst: 6000000,
            votekd: 1730,
            votelst: 9000000
        },
        offline: {
            type: "keyreg",
            fee: 1000,
            fv: 7000000,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 7001000
        }
    },

    // Asset configuration transactions
    acfg: {
        create: {
            type: "acfg",
            apar: {
                am: "gXHjtDdtVpY7IKwJYsJWdCSrnUyRsX4jr3ihzQ2U9CQ=",
                an: "My New Coin",
                au: "developer.algorand.co",
                c: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
                dc: 2,
                f: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
                m: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
                r: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
                t: 50000000,
                un: "MNC"
            },
            fee: 1000,
            fv: 6000000,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 6001000
        },
        reconfigure: {
            type: "acfg",
            apar: {
                c: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
                f: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4",
                m: "QC7XT7QU7X6IHNRJZBR67RBMKCAPH67PCSX4LYH4QKVSQ7DQZ32PG5HSVQ",
                r: "EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4"
            },
            caid: 168103,
            fee: 1000,
            fv: 6002000,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 6003000
        },
        destroy: {
            type: "acfg",
            caid: 168103,
            fee: 1000,
            fv: 7000000,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 7001000
        }
    },

    // Asset freeze transactions
    afrz: {
        afrz: {
            type: "afrz",
            afrz: true,
            fadd: "QC7XT7QU7X6IHNRJZBR67RBMKCAPH67PCSX4LYH4QKVSQ7DQZ32PG5HSVQ",
            faid: 168103,
            fee: 1000,
            fv: 7687793,
            gh: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
            lv: 7688793
        }
    },

    // State proof transactions
    stpf: {
        stpf: {
            type: "stpf",
            spmsg: {
                P: 2230170,
                b: "8LkpbqSqlWcsfUr9EgpxBmrTDqQBg2tcubN7cpcFRM8=",
                f: 24191745,
                l: 24192000,
                v: "drLLvXcg+sOqAhYIjqatF68QP7TeR0B/NljKtOtDit7Hv5Hk7gB9BgI5Ijz+tkmDkRoblcchwYDJ1RKzbapMAw=="
            },
            fee: 0,
            fv: 24192139,
            gh: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
            lv: 24193139
        }
    },

    // Heartbeat transactions
    hb: {
        hb: {
            type: "hb",
            hb: {
                hbAddress: "LNTMAFSF43V7RQ7FBBRAWPXYZPVEBGKPNUELHHRFMCAWSARPFUYD2A623I",
                hbKeyDilution: 1733,
                hbProof: {
                    hbPk: "fS6sjbqtRseLgoRuWf3mJMWMJA6hZ1TemZCAmFg62SU=",
                    hbPk1sig: "NQC4OxD01CAog8VPee0lZHLkJhvCK8FHqgqrjlHgtyGVxJBfmFSGrvRyd7BXXBpXqtz2gmiRiwsOPi9kuOXvDA==",
                    hbPk2: "Oar7xcoAnGtGEicTlx864JiCVQS+GQIDNlt37MiCWa8=",
                    hbPk2sig: "YWXDN49q4s5Wywyn6ZDi5yu13wCHICW5YH9wc3tnOqmlz/tAlXvX5GO0ePz6FyTTIgqQp1SheLQopNpME43yAA==",
                    hbSig: "aMp1kUFzBAGcnUXo7dqko3BtiWi9624hj4Vu8un1cjDU0s4CAk69gxuaagxITd5rZla1Zaf+iX63DknMaIIXAA=="
                },
                hbSeed: "H3u5wO+W/QvGxSr9h0Oz14rV0WFJ/le5hbi/2OvafzY=",
                hbVoteId: "puFs2yVgp6oGrOU5DFs1QWkCk/S/cB7GMs/f9bx0gW8="
            },
            fee: 0,
            fv: 46514101,
            lv: 46514111,
            gh: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8="
        }
    }
};

function generateRandomAmount() {
    return Math.floor(Math.random() * 10000000) + 1000000;
}

function generateRandomRound() {
    return Math.floor(Math.random() * 1000000) + 6000000;
}

function generateRandomAppId() {
    return Math.floor(Math.random() * 1000) + 1;
}

function generateRandomAssetId() {
    return Math.floor(Math.random() * 1000000) + 1;
}

function generateTransactions(count) {
    const transactions = [];
    
    for (let i = 0; i < count; i++) {
        // Select transaction type based on weights
        const rand = Math.random() * 100;
        let cumulative = 0;
        let selectedType;
        
        for (const [type, weight] of Object.entries(TYPE_WEIGHTS)) {
            cumulative += weight;
            if (rand <= cumulative) {
                selectedType = type;
                break;
            }
        }
        
        // Select random subtype
        const subtypes = SUBTYPES[selectedType];
        const subtype = subtypes[Math.floor(Math.random() * subtypes.length)];
        
        // Get template for this type and subtype
        const template = TX_TEMPLATES[selectedType][subtype];
        
        // Generate transaction based on template with some randomization
        const tx = {
            ...template,
            fv: generateRandomRound(),
            lv: generateRandomRound() + 1000
        };

        // Add specific randomization based on transaction type
        if (selectedType === 'pay' && tx.amt) {
            tx.amt = generateRandomAmount();
        } else if (selectedType === 'axfer' && tx.aamt) {
            tx.aamt = generateRandomAmount();
        } else if (selectedType === 'appl') {
            tx.apid = generateRandomAppId();
        } else if (selectedType === 'acfg' && tx.caid) {
            tx.caid = generateRandomAssetId();
        }

        transactions.push(tx);
    }
    
    return { txnGroups: [{ txns: transactions }] };
}

// Generate 1000 transactions
const simulationData = generateTransactions(1000);

// Write transactions to a JSON file
const fs = require('fs');
const outputPath = 'simulated_transactions.json';

try {
    fs.writeFileSync(outputPath, JSON.stringify(simulationData, null, 2));
    console.log(`Successfully wrote ${simulationData.txnGroups[0].txns.length} transactions to ${outputPath}`);
} catch (err) {
    console.error('Error writing to file:', err);
} 