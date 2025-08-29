const algosdk = require('algosdk');
const fs = require('fs');
const path = require('path');

// Initialize Algorand indexer client
const indexerClient = new algosdk.Indexer(
    '', // No token needed
    'https://mainnet-idx.4160.nodely.dev',
    443
);

// Configuration
const ROUND_RANGE = 666;
const CHECKPOINT_INTERVAL = 100; // Save progress every 100 rounds
const REQUEST_DELAY = 30; // 50ms between requests (~20 req/sec, well below the 60/sec limit)

const txStats = {
    pay: { count: 0, subtypes: { pay: 0, closeacc: 0 } },
    axfer: { count: 0, subtypes: { 'opt-in': 0, 'opt-out': 0, axfer: 0, clawback: 0 } },
    appl: { 
        count: 0,
        subtypes: {
            noop: 0,
            optin: 0,
            closeout: 0,
            clear: 0,
            update: 0,
            delete: 0,
            create: 0
        }
    },
    acfg: { count: 0, subtypes: { create: 0, reconfigure: 0, destroy: 0 } },
    keyreg: { count: 0, subtypes: { online: 0, offline: 0 } },
    afrz: { count: 0, subtypes: { true: 0, false: 0 } },
    stpf: { count: 0 },
    hb: { count: 0 }
};

let collectedTxs = 0;
let lastCheckpointRound = 0;
let startTime;

// Create checkpoint directory if it doesn't exist
const checkpointDir = path.join(__dirname, 'checkpoints');
if (!fs.existsSync(checkpointDir)) {
    fs.mkdirSync(checkpointDir);
}

// Try to load from checkpoint
function loadLatestCheckpoint() {
    try {
        const files = fs.readdirSync(checkpointDir);
        const checkpointFiles = files.filter(f => f.startsWith('checkpoint_')).sort();
        
        if (checkpointFiles.length === 0) return null;
        
        const latestFile = checkpointFiles[checkpointFiles.length - 1];
        console.log(`Found checkpoint file: ${latestFile}`);
        
        const checkpoint = JSON.parse(fs.readFileSync(path.join(checkpointDir, latestFile), 'utf8'));
        
        // Restore state from checkpoint
        collectedTxs = checkpoint.totalTransactions;
        lastCheckpointRound = checkpoint.lastProcessedRound;
        Object.keys(txStats).forEach(key => {
            if (checkpoint.statistics[key]) {
                txStats[key] = checkpoint.statistics[key];
            }
        });
        
        console.log(`Restored from checkpoint. Already processed ${collectedTxs} transactions up to round ${lastCheckpointRound}`);
        return checkpoint;
    } catch (error) {
        console.error('Failed to load checkpoint:', error.message);
        return null;
    }
}

// Save checkpoint
function saveCheckpoint(currentRound, endRound, startRound) {
    const checkpoint = {
        totalTransactions: collectedTxs,
        lastProcessedRound: currentRound,
        startRound,
        endRound,
        statistics: txStats,
        timestamp: new Date().toISOString()
    };
    
    const filename = `checkpoint_${currentRound}.json`;
    fs.writeFileSync(path.join(checkpointDir, filename), JSON.stringify(checkpoint, null, 2));
    console.log(`Checkpoint saved at round ${currentRound}`);
    lastCheckpointRound = currentRound;
}

async function fetchCurrentRound() {
    try {
        const status = await indexerClient.makeHealthCheck().do();
        return Number(status.round);
    } catch (error) {
        console.error('Error fetching current round:', error.message);
        throw error;
    }
}

// Fetch with exponential backoff retry
async function fetchWithRetry(round, maxRetries = 5) {
    let retries = 0;
    let backoffTime = 500; // Start with 500ms
    
    while (retries < maxRetries) {
        try {
            return await fetchBlockTransactions(round);
        } catch (error) {
            if (error.status === 429) {
                console.log(`Rate limited on round ${round}, retrying after ${backoffTime}ms (attempt ${retries + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                backoffTime *= 2; // Exponential backoff
                retries++;
            } else {
                // For other errors, just log and continue with empty transaction list
                console.error(`Error fetching round ${round}:`, error.message);
                return [];
            }
        }
    }
    console.error(`Failed to fetch round ${round} after ${maxRetries} retries`);
    return [];
}

// Fetch a single block (round) with all its transactions
async function fetchBlockTransactions(round) {
    try {
        const response = await indexerClient.lookupBlock(round).do();
        
        // Custom BigInt serializer
        const bigIntSerializer = (key, value) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            return value;
        };

        // Process transactions with BigInt handling
        const transactions = response.transactions || [];
        const processedTransactions = transactions.map(tx => {
            const serialized = JSON.stringify(tx, bigIntSerializer);
            return JSON.parse(serialized);
        });
        
        return processedTransactions;
    } catch (error) {
        throw error; // Let the retry handler deal with it
    }
}

function categorizeTx(tx) {
    // Determine type based on transaction structure
    let type;
    if (tx.paymentTransaction) type = 'pay';
    else if (tx.assetTransferTransaction) type = 'axfer';
    else if (tx.applicationTransaction) type = 'appl';
    else if (tx.assetConfigTransaction) type = 'acfg';
    else if (tx.keyregTransaction) type = 'keyreg';
    else if (tx.assetFreezeTransaction) type = 'afrz';
    else if (tx.stateProofTransaction) type = 'stpf';
    else if (tx.heartbeatTransaction) type = 'hb';
    
    if (!type || !txStats[type]) {
        console.log('Unknown transaction structure:', Object.keys(tx));
        return;
    }

    txStats[type].count++;

    switch(type) {
        case 'pay':
            if (tx.paymentTransaction['close-remainder-to']) 
                txStats.pay.subtypes.closeacc++;
            else 
                txStats.pay.subtypes.pay++;
            break;
            
        case 'axfer':
            const assetTx = tx.assetTransferTransaction;
            
            // Only log a few sample transactions for debugging
            if (txStats.axfer.count <= 3) {
                console.log('Sample Asset Transfer Transaction:', JSON.stringify({
                    'transaction_id': tx.id,
                    'sender': tx.sender, 
                    'asset_sender': assetTx.sender,
                    'receiver': assetTx.receiver,
                    'amount': assetTx.amount,
                    'close_to': assetTx['close-to']
                }, null, 2));
            }
            
            // Fixed categorization logic
            if (assetTx.receiver === tx.sender && assetTx.amount === 0) {
                // Opt-in: Sending 0 of an asset to yourself
                txStats.axfer.subtypes['opt-in']++;
            } else if (assetTx['close-to']) {
                // Opt-out: Has close-to address
                txStats.axfer.subtypes['opt-out']++;
            } else if (assetTx.sender && assetTx.sender !== tx.sender) {
                // Clawback: Different sender than tx.sender
                txStats.axfer.subtypes.clawback++;
            } else {
                // Regular transfer
                txStats.axfer.subtypes.axfer++;
            }
            break;
            
        case 'appl':
            const applTx = tx.applicationTransaction;
            
            // Detailed logging for the first few transactions
            if (txStats.appl.count <= 5) {
                console.log('Application Transaction Details:', JSON.stringify({
                    id: tx.id,
                    'on-completion': applTx['on-completion'],
                    'application-id': applTx['application-id'],
                    'approval-program': applTx['approval-program'] ? 'present' : 'absent',
                    'clear-program': applTx['clear-state-program'] ? 'present' : 'absent',
                    'raw_tx': tx  // Include the full transaction for complete analysis
                }, null, 2));
            }
            
            // Application Create: must have approval-program and clear-state-program
            if (!applTx['application-id'] || applTx['application-id'] === 0) {
                txStats.appl.subtypes.create++;
                break;
            }
            
            // All other application calls must have an on-completion value
            switch(applTx['on-completion']) {
                case undefined:
                case null:
                case 'noop':
                    txStats.appl.subtypes.noop++;
                    break;
                case 'optin':
                    txStats.appl.subtypes.optin++;
                    break;
                case 'closeout':
                    txStats.appl.subtypes.closeout++;
                    break;
                case 'clear':
                    txStats.appl.subtypes.clear++;
                    break;
                case 'update':
                    txStats.appl.subtypes.update++;
                    break;
                case 'delete':
                    txStats.appl.subtypes.delete++;
                    break;
                default:
                    console.log(`Unknown on-completion value: ${applTx['on-completion']}`, {
                        'transaction_id': tx.id,
                        'application-id': applTx['application-id']
                    });
                    txStats.appl.subtypes.noop++;
            }
            break;
            
        case 'acfg':
            const configTx = tx.assetConfigTransaction;
            
            // Only log a sample transaction
            if (txStats.acfg.count <= 3) {
                console.log('Sample asset config transaction:', JSON.stringify(configTx, null, 2));
            }
            
            // Asset categorization based on algorand parameters
            if (!configTx['asset-id'] && configTx.params) {
                // No asset-id means this is asset creation
                txStats.acfg.subtypes.create++;
            } else if (configTx['asset-id'] && configTx.params) {
                // Has asset-id and parameters - this is reconfiguration
                txStats.acfg.subtypes.reconfigure++;
            } else if (configTx['asset-id'] && (!configTx.params || Object.keys(configTx.params).length === 0)) {
                // Has asset-id but no parameters - this is destruction
                txStats.acfg.subtypes.destroy++;
            } else {
                // This should not happen, but if it does, log it
                console.log('Uncategorized asset config transaction:', JSON.stringify(configTx, null, 2));
                // Count it as reconfiguration by default
                txStats.acfg.subtypes.reconfigure++;
            }
            break;
            
        case 'keyreg':
            const keyregTx = tx.keyregTransaction;
            if (keyregTx['vote-pk'] && keyregTx['selection-pk'])
                txStats.keyreg.subtypes.online++;
            else
                txStats.keyreg.subtypes.offline++;
            break;
            
        case 'afrz':
            const freezeTx = tx.assetFreezeTransaction;
            if (freezeTx['new-freeze-status'] === true)
                txStats.afrz.subtypes.true++;
            else
                txStats.afrz.subtypes.false++;
            break;
            
        // No subtypes for these transaction types, just count them
        case 'stpf':
        case 'hb':
            // Already counted in the main counter above
            break;
    }
}

function formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

async function collectTransactions() {
    console.log('Starting historical transaction collection...');
    startTime = Date.now();
    
    const currentRound = await fetchCurrentRound();
    // Set fixed range to 10000 rounds as requested
    const roundRange = ROUND_RANGE;
    
    const startRound = currentRound - roundRange;
    const endRound = currentRound;

    // Try to load from checkpoint
    const checkpoint = loadLatestCheckpoint();
    let resumeRound = checkpoint ? checkpoint.lastProcessedRound : null;
    
    console.log(`Will fetch transactions from rounds ${startRound} to ${endRound}`);
    
    // Start from resumeRound+1 if we have a checkpoint, otherwise from endRound
    let roundToProcess = resumeRound ? resumeRound - 1 : endRound;
    
    // Process rounds sequentially with rate limiting
    while (roundToProcess > startRound) {
        const percentComplete = ((endRound - roundToProcess) / roundRange) * 100;
        const elapsedMs = Date.now() - startTime;
        const msPerRound = elapsedMs / (endRound - roundToProcess + 1);
        const remainingRounds = roundToProcess - startRound;
        const estimatedTimeRemaining = remainingRounds * msPerRound;
        
        console.log(`Processing round ${roundToProcess}... [${percentComplete.toFixed(2)}% complete]`);
        console.log(`Estimated time remaining: ${formatTime(estimatedTimeRemaining)}`);
        
        // Fetch and process transactions for this round
        const transactions = await fetchWithRetry(roundToProcess);
        
        // Process transactions from this round
        for (const tx of transactions) {
            categorizeTx(tx);
            collectedTxs++;
        }
        
        // Create checkpoint if needed
        if (roundToProcess % CHECKPOINT_INTERVAL === 0 || roundToProcess === startRound + 1) {
            saveCheckpoint(roundToProcess, endRound, startRound);
        }
        
        // Log progress every 10 rounds
        if ((endRound - roundToProcess) % 10 === 0 || roundToProcess === startRound + 1) {
            console.log(`Collected ${collectedTxs} transactions so far (processed ${endRound - roundToProcess + 1} of ${roundRange} rounds)...`);
        }
        
        // Wait between requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
        
        roundToProcess--;
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`Collection completed in ${formatTime(totalTime)}`);
    
    const results = {
        totalTransactions: collectedTxs,
        startRound,
        endRound,
        roundsAnalyzed: roundRange,
        statistics: txStats,
        timestamp: new Date().toISOString(),
        processingTime: formatTime(totalTime)
    };

    // Use BigInt serializer for the final results
    const resultString = JSON.stringify(results, (key, value) => {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        return value;
    }, 2);
    
    fs.writeFileSync(`hist_tx_alys_${roundRange}.json`, resultString);
    console.log(`\nAnalysis complete! Results saved to hist_tx_alys_${roundRange}.json`);
    console.log('\nTransaction Type Summary:');
    
    // Enhanced output with subtypes
    Object.entries(txStats).forEach(([type, data]) => {
        const percentage = ((data.count/collectedTxs)*100).toFixed(2);
        console.log(`${type}: ${data.count} transactions (${percentage}%)`);
        
        // Add subtypes details for transaction types that have them
        if (data.subtypes) {
            Object.entries(data.subtypes).forEach(([subtype, count]) => {
                if (count > 0) {
                    const subtypePercentage = ((count/data.count)*100).toFixed(2);
                    console.log(`  - ${subtype}: ${count} (${subtypePercentage}% of ${type})`);
                }
            });
        }
    });
}

collectTransactions().catch(console.error);
