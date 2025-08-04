// algorand-direct.js - Direct API calls to Algorand node without SDK
const ALGOD_SERVER = 'http://localhost';
const ALGOD_PORT = 8081;
const NODELY_BASE_URL = 'https://mainnet-api.4160.nodely.dev';
// Update the ALGORANDING_BASE_URL to not need additional endpoints
const ALGORANDING_BASE_URL = 'https://mempool.algorand.ing/api/mempool';

let currentMempoolMode = 'algoranding'; // For mempool data: 'algoranding' or 'user_node'
let currentBlockMode = 'nodely'; // For block data: always 'nodely' for now
let ALGOD_TOKEN = null;

let pollInterval = null;
let onNewTransactionCallback = null;
let lastTxCount = 0;
let lastBlockRound = 0;

// Initialize connection to algod
async function initAlgodConnection() {
  // Test both mempool and block connections
  const mempoolTest = await testMempoolConnection();
  const blockTest = await testBlockConnection();
  
  console.log(`Mempool connection (${currentMempoolMode}): ${mempoolTest ? '✅' : '❌'}`);
  console.log(`Block connection (${currentBlockMode}): ${blockTest ? '✅' : '❌'}`);
  
  return mempoolTest && blockTest;
}

async function testMempoolConnection() {
  let url, headers;
  
  if (currentMempoolMode === 'algoranding') {
    const apiRequest = buildMempoolApiRequest('');
    url = apiRequest.url;
    headers = apiRequest.headers;
  } else {
    const apiRequest = buildMempoolApiRequest('/v2/transactions/pending');
    url = apiRequest.url;
    headers = apiRequest.headers;
  }
  
  try {
    console.log(`Testing mempool connection to ${currentMempoolMode} at ${url}...`);
    console.log('Headers being sent:', headers); // Add this line
    const response = await fetch(url, { headers });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Mempool connection successful`);
      
      // Log different stats based on API
      if (currentMempoolMode === 'algoranding' && data.stats) {
        console.log(`Algoranding stats: ${data.stats.totalInPool} total, ${data.stats.shown} shown, ${data.stats.coverage}% coverage`);
      }
      
      return true;
    } else {
      const responseText = await response.text();
      console.error(`❌ Mempool connection failed: ${response.status} ${response.statusText}`);
      console.error('Response body:', responseText);
      return false;
    }
  } catch (error) {
    console.error(`❌ Mempool connection error:`, error.message);
    return false;
  }
}

async function testBlockConnection() {
  console.log(`Testing block connection to ${currentBlockMode}...`);
  
  const blockRequest = buildBlockApiRequest('/v2/status');
  if (!blockRequest) {
    console.error('❌ Block connection failed: No valid block API configuration');
    return false;
  }
  
  const { url, headers } = blockRequest;
  console.log(`Block connection headers:`, headers);
  
  try {
    const response = await fetch(url, { headers });
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Block connection successful:`, data);
      return true;
    } else {
      console.error(`❌ Block connection failed: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Block connection error:', error);
    return false;
  }
}

// Fetch pending transactions from mempool API
async function getPendingTransactions() {
  let url, headers;
  
  if (currentMempoolMode === 'algoranding') {
    // Algoranding API - use base URL directly
    const apiRequest = buildMempoolApiRequest('');
    url = apiRequest.url;
    headers = apiRequest.headers;
  } else {
    // Standard node API or Nodely - use /v2/transactions/pending endpoint
    const apiRequest = buildMempoolApiRequest('/v2/transactions/pending');
    url = apiRequest.url;
    headers = apiRequest.headers;
  }
  
  try {
    const response = await fetch(url, { headers });
    
    if (response.ok) {
      const data = await response.json();
      // console.log("Raw pending transactions response:", data);
      
      // Handle different response structures
      let transactions = [];
      
      if (currentMempoolMode === 'algoranding') {
        // Algoranding API returns {transactions: [...], stats: {...}}
        if (data && data.transactions && Array.isArray(data.transactions)) {
          transactions = data.transactions;
          console.log(`Algoranding API: ${transactions.length} transactions, stats:`, data.stats);
        }
      } else {
        // Standard node API returns different structures
        if (data && data.top && Array.isArray(data.top)) {
          transactions = data.top;
        } else if (data && data['top-transactions'] && Array.isArray(data['top-transactions'])) {
          transactions = data['top-transactions'];
        } else if (data && Array.isArray(data)) {
          transactions = data;
        }
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
// The UI now omits the interval argument; we derive one from the active mode:
//   • user_node   →  50 ms  (≈20 req/s - local)
//   • nodely      → 500 ms  (≈2 req/s)
//   • algoranding → 500 ms  (≈2 req/s)
function startPolling(callback, interval) {
  // Choose an interval only when the caller didn’t specify one
  if (interval === undefined || interval === null) {
    if (currentMempoolMode === 'user_node' && currentBlockMode === 'user_node') {
      // Both mempool and blocks from local node - can handle 50ms
      interval = 50;
    } else {
      // Any remote API (algoranding/nodely) - use 500ms to be respectful
      interval = 500;
    }
    console.log(`Auto-selected interval: ${interval}ms for mempool:${currentMempoolMode}, blocks:${currentBlockMode}`);
  } else {
    console.log(`Using explicit interval: ${interval}ms`);
  }

  if (pollInterval) {
    stopPolling();
  }
  
  onNewTransactionCallback = callback;
  lastTxCount = 0;
  lastBlockRound = 0;
  
  const bootstrapAndStart = async () => {
    // Bootstrap: get current round once at startup
    if (lastBlockRound === 0) {
      try {
        const { url, headers } = buildBlockApiRequest('/v2/status');
        const response = await fetch(url, { headers });
        if (response.ok) {
          const status = await response.json();
          lastBlockRound = status['last-round'];
          console.log(`🚀 Starting from current round: ${lastBlockRound}`);
        } else {
          throw new Error(`Status call failed: ${response.status}`);
        }
      } catch (error) {
        console.warn('Could not get starting round, using fallback:', error.message);
        lastBlockRound = 51125000; // Reasonable fallback
      }
    }
    
    // Now start the actual polling interval
    pollInterval = setInterval(async () => {
      try {
        // Existing pending transactions logic
        const transactions = await getPendingTransactions();
        
        if (!Array.isArray(transactions)) {
          console.warn("Expected an array of transactions but got:", transactions);
          return;
        }
        
        const txCount = transactions.length;
        // console.log(`Pending transactions: ${txCount}, previous: ${lastTxCount}`);
        
        if (txCount > lastTxCount) {
          const newTxCount = txCount - lastTxCount;
          // console.log(`Found ${newTxCount} new transactions`);
          const newTxs = transactions.slice(0, newTxCount);
          processTransactions(newTxs);
        } else if (txCount < lastTxCount) {
          console.log(`${lastTxCount - txCount} transactions were processed into a block`);
        }
        
        lastTxCount = txCount;
        
        // UPDATED: Block polling logic - check if we can fetch blocks first
        const nextBlockRound = lastBlockRound + 1;
        const blockRequest = buildBlockApiRequest(`/v2/blocks/${nextBlockRound}`);
        if (!blockRequest) {
          // No valid block API, skip block polling
          return;
        }
        
        const { url: blockUrl, headers: blockHeaders } = blockRequest;
        const blockResponse = await fetch(blockUrl, { headers: blockHeaders });
        
        if (blockResponse.ok) {
          const blockData = await blockResponse.json();
          const actualRound = blockData.block.rnd;
          
          console.log(`✅ New block ${actualRound} fetched successfully`);
          
          // Extract the authoritative next state proof round from the block data.
          const nextStateProofRound = blockData?.block?.spt?.[0]?.n;
          
          // Signal that a new block was produced, now including the schedule data.
          const newBlockSignal = {
            txn: {
              type: 'block',
              round: actualRound,
              snd: 'ALGORAND-PROTOCOL',
              rcv: null
            },
            round: actualRound,
            nextStateProofRound: nextStateProofRound || null // Pass it along.
          };
          
          onNewTransactionCallback('block', newBlockSignal);
          lastBlockRound = actualRound;
          
        } else if (blockResponse.status === 404) {
          // No new block yet, this is normal
          // console.log(`No new block at round ${nextBlockRound} yet`);
        } else {
          console.error(`Failed to fetch block ${nextBlockRound}: ${blockResponse.status} ${blockResponse.statusText}`);
        }
        
      } catch (error) {
        console.error("Error during polling:", error);
      }
    }, interval);
    
    console.log(`Started polling for transactions and blocks every ${interval}ms`);
  };
  
  // Start the bootstrap process
  bootstrapAndStart();
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
    
  transactions.forEach(tx => {
    try {
      // Log the raw transaction for debugging
      // console.log("Raw transaction:", tx);
      
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
      
      // console.log(`Detected transaction type: ${txType}`);
      
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
  // Simple: return the last known round from polling, or null if not started
  return lastBlockRound > 0 ? lastBlockRound : null;
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

function setMempoolMode(mode) {
  if (['algoranding', 'nodely', 'user_node'].includes(mode)) {
    currentMempoolMode = mode;
    console.log(`Mempool mode set to: ${mode}`);
  } else {
    console.error(`Invalid mempool mode: ${mode}`);
  }
}

function setBlockMode(mode) {
  if (['user_node', 'algoranding', 'nodely'].includes(mode)) {
    currentBlockMode = mode;
    console.log(`Block mode set to: ${mode}`);
  } else {
    console.error(`Invalid block mode: ${mode}`);
  }
}

// Build API request for mempool data
function buildMempoolApiRequest(endpoint) {
  if (currentMempoolMode === 'algoranding') {
    return {
      url: ALGORANDING_BASE_URL,
      headers: {
        'Accept': 'application/json',
        'Origin': window.location.origin,
        'Referer': window.location.href
      }
    };
  } else if (currentMempoolMode === 'user_node') {
    ensureTokenIsSet();
    return {
      url: `${ALGOD_SERVER}:${ALGOD_PORT}${endpoint}`, // Use the endpoint for standard node API
      headers: {
        'X-Algo-API-Token': ALGOD_TOKEN,
        'Accept': 'application/json'
      }
    };
  } else if (currentMempoolMode === 'nodely') {
    // Nodely uses standard Algorand API structure
    return {
      url: `${NODELY_BASE_URL}${endpoint}`,
      headers: {
        'Accept': 'application/json'
      }
    };
  }
}

// Replace the buildBlockApiRequest function (around line 540)
function buildBlockApiRequest(endpoint) {
  if (currentBlockMode === 'user_node') {
    ensureTokenIsSet();
    return {
      url: `${ALGOD_SERVER}:${ALGOD_PORT}${endpoint}`,
      headers: {
        'X-Algo-API-Token': ALGOD_TOKEN,
        'Accept': 'application/json'
      }
    };
  } else if (currentBlockMode === 'nodely') {
    // Nodely provides block data
    return {
      url: `${NODELY_BASE_URL}${endpoint}`,
      headers: {
        'Accept': 'application/json'
      }
    };
  } else if (currentBlockMode === 'algoranding') {
    // Algoranding doesn't provide block endpoints, fall back to user_node if token available
    if (ALGOD_TOKEN) {
      ensureTokenIsSet();
      return {
        url: `${ALGOD_SERVER}:${ALGOD_PORT}${endpoint}`,
        headers: {
          'X-Algo-API-Token': ALGOD_TOKEN,
          'Accept': 'application/json'
        }
      };
    } else {
      console.error('Algoranding mode requires user node token for block data');
      return null;
    }
  }
  return null; // Default fallback
}

async function getBlock(round) {
  const { url, headers } = buildBlockApiRequest(`/v2/blocks/${round}`);
  
  try {
    const response = await fetch(url, { headers });
    
    if (response.ok) {
      const blockData = await response.json();
      return blockData;
    } else {
      // Don't log 404s as errors - blocks might not be available yet
      if (response.status !== 404) {
        console.error(`Failed to fetch block ${round}: ${response.status} ${response.statusText}`);
      }
      return null;
    }
  } catch (error) {
    console.error(`Error fetching block ${round}:`, error);
    return null;
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
  getBlock,
  getLatestBlockRound,
  extractBlockReward,
  testBlockAPI,
  setApiToken,
  setMempoolMode,
  setBlockMode,
  getCurrentModes: () => ({ mempool: currentMempoolMode, block: currentBlockMode })
};
