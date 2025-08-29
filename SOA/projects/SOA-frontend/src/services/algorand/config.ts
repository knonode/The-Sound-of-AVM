// Algorand API Configuration
// Environment variables are loaded via Vite's import.meta.env

export interface AlgorandConfig {
  // Local Algorand Node Configuration
  algodServer: string;
  algodPort: number;

  // Third-party API Endpoints
  nodelyBaseUrl: string;
  algorandingBaseUrl: string;

  // Optional: API Token for local node
  algodToken: string | null;

  // Default Modes
  defaultMempoolMode: 'algoranding' | 'nodely' | 'user_node';
  defaultBlockMode: 'user_node' | 'algoranding' | 'nodely';
}

// Default configuration values
const DEFAULT_CONFIG: AlgorandConfig = {
  algodServer: 'http://localhost',
  algodPort: 8081,
  nodelyBaseUrl: 'https://mainnet-api.4160.nodely.dev',
  algorandingBaseUrl: 'https://mempool.algorand.ing/api/mempool',
  algodToken: null,
  defaultMempoolMode: 'algoranding',
  defaultBlockMode: 'nodely'
};

export function getAlgorandConfig(): AlgorandConfig {
  // In a real app, these would come from environment variables
  // For now, we'll use the defaults but structure it to easily add env vars later
  return {
    ...DEFAULT_CONFIG,
    // Environment variables would be loaded here like:
    // algodServer: import.meta.env.VITE_ALGOD_SERVER || DEFAULT_CONFIG.algodServer,
    // algodPort: parseInt(import.meta.env.VITE_ALGOD_PORT) || DEFAULT_CONFIG.algodPort,
    // etc.
  };
}

// Export individual config values for convenience
export const config = getAlgorandConfig();
