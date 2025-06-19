// algorand-direct.js - Direct API calls to Algorand node without SDK
const ALGOD_SERVER = 'http://localhost';
const ALGOD_PORT = 8081; // 8080 is the default port for the Algorand API server, you might need to change this
const NODELY_BASE_URL = 'https://mainnet-api.4160.nodely.dev';
let currentApiMode = 'user_node'; // Track mode in this module
let ALGOD_TOKEN = null; // Start with no token

let pollInterval = null;
let onNewTransactionCallback = null;
let lastTxCount = 0;
let lastBlockRound = 0;

// Initialize connection to algod
async function initAlgodConnection() {
  const { url, headers } = buildApiRequest('/v2/status');
  
  try {
    console.log(`Attempting to connect to ${currentApiMode} at ${url}...`);
    
    const response = await fetch(url, { headers });
    
    if (response.ok) {
      const status = await response.json();
      console.log(`Connected to ${currentApiMode} successfully:`, status);
      return true;
    } else {
      console.error(`Failed to connect to ${currentApiMode} with status ${response.status}: ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error(`Error connecting to ${currentApiMode}:`, error.message);
    return false;
  }
}

// Fetch pending transactions directly from the API
async function getPendingTransactions() {
  const { url, headers } = buildApiRequest('/v2/transactions/pending');
  
  try {
    const response = await fetch(url, { headers });
    
    if (response.ok) {
      const data = await response.json();
      console.log("Raw pending transactions response:", data);
      
      // Determine where the transactions are in the response
      let transactions = [];
      
      if (data && data.top && Array.isArray(data.top)) {
        transactions = data.top;
      } else if (data && data['top-transactions'] && Array.isArray(data['top-transactions'])) {
        transactions = data['top-transactions'];
      } else if (data && Array.isArray(data)) {
        transactions = data;
      }
      
      return transactions;
    } else {
      console.error(`Failed to fetch pending transactions: ${response.status} ${response.statusText}`);
      return [];
    }
  } catch (error) {
    console.error('Error fetching pending transactions:', error);
    return [];
  }
}

// Start polling for new transactions
function startPolling(callback, interval = 500) {
  if (pollInterval) {
    stopPolling();
  }
  
  onNewTransactionCallback = callback;
  lastTxCount = 0;
  lastBlockRound = 0;
  
  pollInterval = setInterval(async () => {
    try {
      // Existing pending transactions logic
      const transactions = await getPendingTransactions();
      
      if (!Array.isArray(transactions)) {
        console.warn("Expected an array of transactions but got:", transactions);
        return;
      }
      
      const txCount = transactions.length;
      console.log(`Pending transactions: ${txCount}, previous: ${lastTxCount}`);
      
      if (txCount > lastTxCount) {
        const newTxCount = txCount - lastTxCount;
        console.log(`Found ${newTxCount} new transactions`);
        const newTxs = transactions.slice(0, newTxCount);
        processTransactions(newTxs);
      } else if (txCount < lastTxCount) {
        console.log(`${lastTxCount - txCount} transactions were processed into a block`);
      }
      
      lastTxCount = txCount;
      
      // UPDATED: Block polling logic with better error handling
      const latestRound = await getLatestBlockRound();
      if (latestRound && latestRound > lastBlockRound) {
        console.log(`New blocks detected: ${lastBlockRound + 1} to ${latestRound}`);
        
        // Try to fetch the most recent completed block
        const targetBlock = latestRound;
        console.log(`Attempting to fetch block ${targetBlock}...`);
        
        const { url: blockUrl, headers: blockHeaders } = buildApiRequest(`/v2/blocks/${targetBlock}`);
        const blockResponse = await fetch(blockUrl, { headers: blockHeaders });
        
        console.log(`Block ${targetBlock} response status: ${blockResponse.status}`);
        
        if (blockResponse.ok) {
          const blockData = await blockResponse.json();
          console.log(`✅ Successfully fetched block ${targetBlock}`);
          
          // Simple: just signal a new block was produced
          const newBlockSignal = {
            txn: {
              type: 'block',
              round: targetBlock,
              snd: 'ALGORAND-PROTOCOL',
              rcv: null
            },
            round: targetBlock
          };
          
          console.log(`🔥 New block ${targetBlock} - triggering sound`);
          onNewTransactionCallback('block', newBlockSignal);
        } else {
          const errorText = await blockResponse.text();
          console.log(`❌ Block ${targetBlock} failed:`, errorText);
        }
        
        lastBlockRound = latestRound;
      }
      
    } catch (error) {
      console.error("Error during polling:", error);
    }
  }, interval);
  
  console.log(`Started polling for transactions and blocks every ${interval}ms`);
  return true;
}

// Stop polling for transactions
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('Stopped polling for transactions');
  }
}

// Process transactions and call the callback
function processTransactions(transactions) {
  if (!onNewTransactionCallback || !Array.isArray(transactions) || transactions.length === 0) {
    return;
  }
  
  console.log(`Processing ${transactions.length} new transactions`);
  
  transactions.forEach(tx => {
    try {
      // Log the raw transaction for debugging
      console.log("Raw transaction:", tx);
      
      // Try to determine transaction type
      let txType = 'pay'; // Default to payment
      
      // Look for type information - try various paths
      if (tx.txn && tx.txn.type) {
        txType = tx.txn.type;
      } else if (tx.tx && tx.tx.type) {
        txType = tx.tx.type;
      } else if (tx.type) {
        txType = tx.type;
      }
      
      console.log(`Detected transaction type: ${txType}`);
      
      // Call the callback
      onNewTransactionCallback(txType, tx);
    } catch (error) {
      console.error("Error processing transaction:", error);
      // Still try to play a sound
      onNewTransactionCallback('pay', tx);
    }
  });
}

async function testConnection() {
  console.log("Testing Algorand connection...");
  const connected = await initAlgodConnection();
  console.log("Connection test result:", connected);
  
  if (connected) {
    console.log("Testing pending transactions API...");
    const txs = await getPendingTransactions();
    console.log("Got transactions:", txs);
    return {connected, transactionsCount: txs.length};
  }
  
  return {connected, transactionsCount: 0};
}

async function getBlockHeader(round) {
  try {
    // Use the header endpoint as specified in docs
    const response = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/blocks/${round}/header`, {
      headers: {
        'X-Algo-API-Token': ALGOD_TOKEN
      }
    });
    
    if (response.ok) {
      const headerData = await response.json();
      console.log(`Successfully fetched block header ${round}`);
      return headerData;
    } else {
      // Don't log 404s as errors - blocks might not be available yet
      if (response.status !== 404) {
        console.error(`Failed to fetch block header ${round}: ${response.status} ${response.statusText}`);
      }
      return null;
    }
  } catch (error) {
    console.error(`Error fetching block header ${round}:`, error);
    return null;
  }
}

async function getLatestBlockRound() {
  const { url, headers } = buildApiRequest('/v2/status');
  
  try {
    const response = await fetch(url, { headers });
    
    if (response.ok) {
      const status = await response.json();
      return status['last-round'];
    } else {
      console.error(`Failed to get status: ${response.status} ${response.statusText}`);
      return null;
    }
  } catch (error) {
    console.error('Error getting latest block round:', error);
    return null;
  }
}

// The block reward extraction function, not yet used in sound synthesis:
function extractBlockReward(blockData) {
  try {
    console.log('🔍 Starting reward extraction...');
    
    const block = blockData.block || blockData;
    
    // Look for proposer
    const proposer = block?.cert?.prop || 
                    block?.proposer || 
                    block?.header?.proposer ||
                    null;
                    
    console.log('🔍 Found proposer:', proposer);
    
    // Look for actual reward amount in block
    const rewardAmount = block?.rewards?.['rewards-level'] || 
                        block?.header?.rewards?.['rewards-level'] ||
                        block?.rwd?.rl ||
                        10000000; // Fallback to 10 Algo in microAlgos
                        
    console.log('🔍 Found reward amount:', rewardAmount);
    
    if (proposer) {
      const reward = {
        txn: {
          type: 'reward',
          snd: 'ALGORAND-PROTOCOL',
          rcv: proposer,
          amt: rewardAmount,
          round: block.rnd || block.round,
          fee: 0
        },
        blockReward: true,
        round: block.rnd || block.round
      };
      
      console.log('🏆 Created reward transaction:', reward);
      return reward;
    }
    
    console.log('❌ No proposer found in block');
    return null;
  } catch (error) {
    console.error('💥 Error extracting block reward:', error);
    return null;
  }
}

async function testBlockAPI() {
  console.log('=== TESTING BLOCK API ===');
  
  try {
    // Test status first
    const statusResponse = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/status`, {
      headers: { 'X-Algo-API-Token': ALGOD_TOKEN }
    });
    
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log('✅ Status data:', statusData);
      console.log('Current round:', statusData['last-round']);
      
      // Try a recent block
      const testRound = statusData['last-round'] - 1;
      console.log(`Trying block ${testRound}...`);
      
      const blockResponse = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/blocks/${testRound}`, {
        headers: { 'X-Algo-API-Token': ALGOD_TOKEN }
      });
      
      console.log('Block response status:', blockResponse.status);
      
      if (blockResponse.ok) {
        const blockData = await blockResponse.json();
        console.log('✅ Block data keys:', Object.keys(blockData));
      } else {
        console.log('❌ Block failed, trying block 1...');
        
        const block1Response = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/blocks/1`, {
          headers: { 'X-Algo-API-Token': ALGOD_TOKEN }
        });
        console.log('Block 1 status:', block1Response.status);
      }
    }

    console.log('=== TESTING DIFFERENT BLOCK ENDPOINTS ===');

    // Try different API versions/paths
    const testRound = statusData['last-round'] - 1;

    // Try v1 API
    const v1Response = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v1/block/${testRound}`, {
      headers: { 'X-Algo-API-Token': ALGOD_TOKEN }
    });
    console.log(`v1/block/${testRound} status:`, v1Response.status);

    // Try without leading slash
    const altResponse = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}v2/blocks/${testRound}`, {
      headers: { 'X-Algo-API-Token': ALGOD_TOKEN }
    });
    console.log(`v2/blocks/${testRound} (no slash) status:`, altResponse.status);

    // Try with different headers
    const headerResponse = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/blocks/${testRound}`, {
      headers: { 
        'X-Algo-API-Token': ALGOD_TOKEN,
        'Accept': 'application/json'
      }
    });
    console.log(`v2/blocks/${testRound} (with Accept header) status:`, headerResponse.status);
  } catch (error) {
    console.error('Error:', error);
  }
}

function setApiToken(newToken) {
  if (newToken && typeof newToken === 'string' && newToken.length > 10) { // Basic check for a valid token
    ALGOD_TOKEN = newToken;
    console.log("Custom Algorand API token has been set.");
  } else {
    console.warn("Attempted to set an invalid API token. Using default.");
  }
}

function ensureTokenIsSet() {
  if (!ALGOD_TOKEN) {
    throw new Error('Algorand API token not set. Please configure your node token.');
  }
}

function setApiMode(mode) {
  currentApiMode = mode;
  console.log(`API mode set to: ${mode}`);
}

function buildApiRequest(endpoint) {
  if (currentApiMode === 'nodely') {
    return {
      url: `${NODELY_BASE_URL}${endpoint}`,
      headers: {
        'Accept': 'application/json'
        // No authentication needed for Nodely public tier
      }
    };
  } else {
    ensureTokenIsSet();
    return {
      url: `${ALGOD_SERVER}:${ALGOD_PORT}${endpoint}`,
      headers: {
        'X-Algo-API-Token': ALGOD_TOKEN,
        'Accept': 'application/json'
      }
    };
  }
}


// Export the API
export default {
  initAlgodConnection,
  getPendingTransactions,
  startPolling,
  stopPolling,
  testConnection,
  getBlockHeader,
  getLatestBlockRound,
  extractBlockReward,
  testBlockAPI,
  setApiToken,
  setApiMode
};
