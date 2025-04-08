// algorand-direct.js - Direct API calls to Algorand node without SDK

// Configuration for connection to your local node
const ALGOD_SERVER = 'http://localhost';
const ALGOD_PORT = 8081; // 8080 is the default port for the Algorand API server, you might need to change this
const ALGOD_TOKEN = 'INSERT YOUR ALGOD_TOKEN HERE';

let pollInterval = null;
let onNewTransactionCallback = null;
let lastTxCount = 0;

// Initialize connection to algod
async function initAlgodConnection() {
  try {
    console.log(`Attempting to connect to Algorand node at ${ALGOD_SERVER}:${ALGOD_PORT}...`);
    
    // Check if we can reach the node with a simple status call
    const response = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/status`, {
      headers: {
        'X-Algo-API-Token': ALGOD_TOKEN
      }
    });
    
    if (response.ok) {
      const status = await response.json();
      console.log('Connected to Algorand node successfully:', status);
      return true;
    } else {
      console.error(`Failed to connect to Algorand node with status ${response.status}: ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error('Error connecting to Algorand node:', error.message);
    return false;
  }
}

// Fetch pending transactions directly from the API
async function getPendingTransactions() {
  try {
    const response = await fetch(`${ALGOD_SERVER}:${ALGOD_PORT}/v2/transactions/pending`, {
      headers: {
        'X-Algo-API-Token': ALGOD_TOKEN
      }
    });
    
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
  lastTxCount = 0; // Reset counter
  
  pollInterval = setInterval(async () => {
    try {
      // Get current pending transactions
      const transactions = await getPendingTransactions();
      
      // Make sure we got an array back
      if (!Array.isArray(transactions)) {
        console.warn("Expected an array of transactions but got:", transactions);
        return;
      }
      
      const txCount = transactions.length;
      console.log(`Pending transactions: ${txCount}, previous: ${lastTxCount}`);
      
      if (txCount > lastTxCount) {
        // We have new transactions
        const newTxCount = txCount - lastTxCount;
        console.log(`Found ${newTxCount} new transactions`);
        
        // Process only the new transactions
        const newTxs = transactions.slice(0, newTxCount);
        processTransactions(newTxs);
      } else if (txCount < lastTxCount) {
        console.log(`${lastTxCount - txCount} transactions were processed into a block`);
      }
      
      lastTxCount = txCount;
    } catch (error) {
      console.error("Error during polling:", error);
    }
  }, interval);
  
  console.log(`Started polling for transactions every ${interval}ms`);
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

// Add this to algorand-direct.js
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

// Export the API
export default {
  initAlgodConnection,
  getPendingTransactions,
  startPolling,
  stopPolling,
  testConnection
};
