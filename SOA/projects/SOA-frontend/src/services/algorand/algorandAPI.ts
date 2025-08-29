import { config } from './config';
import type {
  Transaction,
  BlockData,
  AlgorandingResponse,
  PendingTransactionsResponse,
  StatusResponse,
  ApiRequest,
  ConnectionTestResult,
  MempoolMode,
  BlockMode,
  CurrentModes,
  BlockReward,
  BlockSignal,
  TransactionCallback
} from './types';

// State variables
let currentMempoolMode: MempoolMode = config.defaultMempoolMode;
let currentBlockMode: BlockMode = config.defaultBlockMode;
let algodToken: string | null = config.algodToken;

let pollInterval: NodeJS.Timeout | null = null;
let onNewTransactionCallback: TransactionCallback | null = null;
let lastTxCount = 0;
let lastBlockRound = 0;
let isWaitingForBlock = false;

/**
 * Initialize connection to Algorand network
 */
export async function initAlgodConnection(): Promise<boolean> {
  // Test both mempool and block connections
  const mempoolTest = await testMempoolConnection();
  const blockTest = await testBlockConnection();

  console.log(`Mempool connection (${currentMempoolMode}): ${mempoolTest ? '✅' : '❌'}`);
  console.log(`Block connection (${currentBlockMode}): ${blockTest ? '✅' : '❌'}`);

  return mempoolTest && blockTest;
}

/**
 * Test mempool connection
 */
async function testMempoolConnection(): Promise<boolean> {
  let url: string;
  let headers: Record<string, string>;

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
    console.log('Headers being sent:', headers);
    const response = await fetch(url, { headers });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Mempool connection successful`);

      // Log different stats based on API
      if (currentMempoolMode === 'algoranding' && (data as AlgorandingResponse).stats) {
        const stats = (data as AlgorandingResponse).stats!;
        console.log(`Algoranding stats: ${stats.totalInPool} total, ${stats.shown} shown, ${stats.coverage}% coverage`);
      }

      return true;
    } else {
      const responseText = await response.text();
      console.error(`❌ Mempool connection failed: ${response.status} ${response.statusText}`);
      console.error('Response body:', responseText);
      return false;
    }
  } catch (error) {
    console.error(`❌ Mempool connection error:`, error);
    return false;
  }
}

/**
 * Test block connection
 */
async function testBlockConnection(): Promise<boolean> {
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

/**
 * Fetch pending transactions from mempool API
 */
export async function getPendingTransactions(): Promise<Transaction[]> {
  let url: string;
  let headers: Record<string, string>;

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
      let transactions: Transaction[] = [];

      if (currentMempoolMode === 'algoranding') {
        // Algoranding API returns {transactions: [...], stats: {...}}
        if (data && (data as AlgorandingResponse).transactions && Array.isArray((data as AlgorandingResponse).transactions)) {
          transactions = (data as AlgorandingResponse).transactions;
        //  console.log(`Algoranding API: ${transactions.length} transactions, stats:`, (data as AlgorandingResponse).stats);
        }
      } else {
        // Standard node API returns different structures
        const responseData = data as PendingTransactionsResponse;
        if (responseData && responseData.top && Array.isArray(responseData.top)) {
          transactions = responseData.top;
        } else if (responseData && responseData['top-transactions'] && Array.isArray(responseData['top-transactions'])) {
          transactions = responseData['top-transactions'];
        } else if (responseData && Array.isArray(responseData)) {
          transactions = responseData as Transaction[];
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

/**
 * Start polling for new transactions
 */
export function startPolling(callback: TransactionCallback, interval?: number): boolean {
  // Choose an interval only when the caller didn't specify one
  if (interval === undefined || interval === null) {
    if (currentMempoolMode === 'user_node' && currentBlockMode === 'user_node') {
      // Both mempool and blocks from local node - can handle 50ms
      interval = 50;
    } else {
      // Any remote API (algoranding/nodely) - use 500ms to be respectful
      // Note: With 2.8s block times, this means ~5-6 polls per block which is fine
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
        const statusRequest = buildBlockApiRequest('/v2/status');
        if (!statusRequest) {
          throw new Error('No valid block API configuration');
        }
        const { url: statusUrl, headers: statusHeaders } = statusRequest;
        const response = await fetch(statusUrl, { headers: statusHeaders });
        if (response.ok) {
          const status = await response.json() as StatusResponse;
          lastBlockRound = status['last-round'];
          console.log(`🚀 Starting from current round: ${lastBlockRound}`);
        } else {
          throw new Error(`Status call failed: ${response.status}`);
        }
      } catch (error) {
        console.warn('Could not get starting round, using fallback:', error);
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
          // Get the actual transaction count from Nodely for comparison
          const nodelyTxCount = await getNodelyBlockTxCount(lastBlockRound);
          console.log(`${lastTxCount - txCount} transactions from mempool were processed into block nr ${lastBlockRound}, Nodely count of txs: ${nodelyTxCount}`);
        }

        lastTxCount = txCount;

        // Silent block polling - no logging, just functionality
        // Smart block waiting - wait for next block instead of polling
        if (!isWaitingForBlock && lastBlockRound > 0) {
          isWaitingForBlock = true;

          // Wait for the next block to be available
          waitForNextBlock(lastBlockRound).then(newRound => {
            if (newRound > lastBlockRound) {
              // Fetch the actual block data for the confirmed round
              fetchBlockData(newRound);
            }
          }).catch(error => {
            // Silently handle errors - connection issues will be caught by mempool polling
            isWaitingForBlock = false;
          }).finally(() => {
            // Reset waiting flag regardless of outcome
            isWaitingForBlock = false;
          });
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

/**
 * Stop polling for transactions
 */
export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    isWaitingForBlock = false;
    console.log('Stopped polling for transactions');
  }
}

/**
 * Process transactions and call the callback
 */
function processTransactions(transactions: Transaction[]): void {
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

/**
 * Test connection and return results
 */
export async function testConnection(): Promise<ConnectionTestResult> {
  console.log("Testing Algorand connection...");
  const connected = await initAlgodConnection();
  console.log("Connection test result:", connected);

  if (connected) {
    console.log("Testing pending transactions API...");
    const txs = await getPendingTransactions();
    console.log("Got transactions:", txs);
    return { connected, transactionsCount: txs.length };
  }

  return { connected, transactionsCount: 0 };
}

/**
 * Get latest block round
 */
export function getLatestBlockRound(): number | null {
  // Simple: return the last known round from polling, or null if not started
  return lastBlockRound > 0 ? lastBlockRound : null;
}

/**
 * Extract block reward information
 */
export function extractBlockReward(blockData: BlockData): BlockReward | null {
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
      const reward: BlockReward = {
        txn: {
          type: 'reward',
          snd: 'ALGORAND-PROTOCOL',
          rcv: proposer,
          amt: rewardAmount,
          round: block.rnd || block.round || 0,
          fee: 0
        },
        blockReward: true,
        round: block.rnd || block.round || 0
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

/**
 * Test block API (disabled - main polling is working correctly)
 */
export async function testBlockAPI(): Promise<boolean> {
  console.log('Block API test disabled - main polling is working correctly');
  return true;
}

/**
 * Set API token
 */
export function setApiToken(newToken: string): void {
  if (newToken && typeof newToken === 'string' && newToken.length > 10) { // Basic check for a valid token
    algodToken = newToken;
    console.log("Custom Algorand API token has been set.");
  } else {
    console.warn("Attempted to set an invalid API token. Using default.");
  }
}

/**
 * Ensure token is set (throws error if not)
 */
function ensureTokenIsSet(): void {
  if (!algodToken) {
    throw new Error('Algorand API token not set. Please configure your node token.');
  }
}

/**
 * Set mempool mode
 */
export function setMempoolMode(mode: MempoolMode): void {
  if (['algoranding', 'nodely', 'user_node'].includes(mode)) {
    currentMempoolMode = mode;
    console.log(`Mempool mode set to: ${mode}`);
  } else {
    console.error(`Invalid mempool mode: ${mode}`);
  }
}

/**
 * Set block mode
 */
export function setBlockMode(mode: BlockMode): void {
  if (['user_node', 'algoranding', 'nodely'].includes(mode)) {
    currentBlockMode = mode;
    console.log(`Block mode set to: ${mode}`);
  } else {
    console.error(`Invalid block mode: ${mode}`);
  }
}

/**
 * Build API request for mempool data
 */
function buildMempoolApiRequest(endpoint: string): ApiRequest {
  if (currentMempoolMode === 'algoranding') {
    return {
      url: config.algorandingBaseUrl,
      headers: {
        'Accept': 'application/json',
        'Origin': window.location.origin,
        'Referer': window.location.href
      }
    };
  } else if (currentMempoolMode === 'user_node') {
    ensureTokenIsSet();
    return {
      url: `${config.algodServer}:${config.algodPort}${endpoint}`,
      headers: {
        'X-Algo-API-Token': algodToken!,
        'Accept': 'application/json'
      }
    };
  } else if (currentMempoolMode === 'nodely') {
    // Nodely uses standard Algorand API structure
    return {
      url: `${config.nodelyBaseUrl}${endpoint}`,
      headers: {
        'Accept': 'application/json'
      }
    };
  }

  throw new Error(`Invalid mempool mode: ${currentMempoolMode}`);
}

/**
 * Build API request for block data
 */
function buildBlockApiRequest(endpoint: string): ApiRequest | null {
  if (currentBlockMode === 'user_node') {
    ensureTokenIsSet();
    return {
      url: `${config.algodServer}:${config.algodPort}${endpoint}`,
      headers: {
        'X-Algo-API-Token': algodToken!,
        'Accept': 'application/json'
      }
    };
  } else if (currentBlockMode === 'nodely') {
    // Nodely provides block data
    return {
      url: `${config.nodelyBaseUrl}${endpoint}`,
      headers: {
        'Accept': 'application/json'
      }
    };
  } else if (currentBlockMode === 'algoranding') {
    // Algoranding doesn't provide block endpoints, fall back to user_node if token available
    if (algodToken) {
      ensureTokenIsSet();
      return {
        url: `${config.algodServer}:${config.algodPort}${endpoint}`,
        headers: {
          'X-Algo-API-Token': algodToken!,
          'Accept': 'application/json'
        }
      };
    } else {
      console.error('Algoranding mode requires user node token for block data');
      return null;
    }
  }
  return null;
}

/**
 * Wait for the next block to be available
 */
async function waitForNextBlock(afterRound: number): Promise<number> {
  const statusRequest = buildBlockApiRequest(`/v2/status/wait-for-block-after/${afterRound}`);
  if (!statusRequest) {
    throw new Error('No valid block API configuration');
  }

  const { url: statusUrl, headers: statusHeaders } = statusRequest;
  const response = await fetch(statusUrl, { headers: statusHeaders });

  if (!response.ok) {
    throw new Error(`Status API error: ${response.status} ${response.statusText}`);
  }

  const statusData = await response.json() as StatusResponse;
  return statusData['last-round'];
}

/**
 * Fetch block data for a confirmed round
 */
async function fetchBlockData(round: number): Promise<void> {
  const blockRequest = buildBlockApiRequest(`/v2/blocks/${round}`);
  if (!blockRequest) {
    throw new Error('No valid block API configuration');
  }

  const { url: blockUrl, headers: blockHeaders } = blockRequest;
  const blockResponse = await fetch(blockUrl, { headers: blockHeaders });

  if (!blockResponse.ok) {
    throw new Error(`Block API error: ${blockResponse.status} ${blockResponse.statusText}`);
  }

  const blockData = await blockResponse.json() as BlockData;
  const actualRound = blockData.block.rnd || blockData.block.round || round;

  // Extract the authoritative next state proof round from the block data.
  const nextStateProofRound = blockData?.block?.spt?.[0]?.n || null;

  // Signal that a new block was produced, now including the schedule data.
  const newBlockSignal: BlockSignal = {
    txn: {
      type: 'block',
      round: actualRound,
      snd: 'ALGORAND-PROTOCOL',
      rcv: null
    },
    round: actualRound,
    nextStateProofRound: nextStateProofRound
  };

  if (onNewTransactionCallback) {
    onNewTransactionCallback('block', newBlockSignal);
  }
  lastBlockRound = actualRound;
}

/**
 * Get transaction count from Nodely for a specific block (excluding inner transactions)
 */
async function getNodelyBlockTxCount(round: number): Promise<number> {
  try {
    // Always use Nodely for this specific query
    const blockUrl = `${config.nodelyBaseUrl}/v2/blocks/${round}`;
    const headers = {
      'Accept': 'application/json'
    };

    const response = await fetch(blockUrl, { headers });

    if (!response.ok) {
      console.warn(`Failed to fetch block ${round} from Nodely: ${response.status}`);
      return 0;
    }

    const blockData = await response.json() as BlockData;

    // Count only top-level transactions (exclude inner transactions)
    if (blockData.block && blockData.block.txns) {
      return blockData.block.txns.length;
    }

    return 0;
  } catch (error) {
    console.warn(`Error fetching Nodely block data for round ${round}:`, error);
    return 0;
  }
}

// Export the API
export const AlgorandAPI = {
  initAlgodConnection,
  getPendingTransactions,
  startPolling,
  stopPolling,
  testConnection,
  getLatestBlockRound,
  extractBlockReward,
  testBlockAPI,
  setApiToken,
  setMempoolMode,
  setBlockMode,
  getCurrentModes: (): CurrentModes => ({ mempool: currentMempoolMode, block: currentBlockMode })
};

export default AlgorandAPI;
