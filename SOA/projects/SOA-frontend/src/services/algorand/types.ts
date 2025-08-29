// TypeScript interfaces for Algorand API

export interface Transaction {
  txn?: {
    type: string;
    [key: string]: any;
  };
  tx?: {
    type: string;
    [key: string]: any;
  };
  type?: string;
  [key: string]: any;
}

export interface BlockData {
  block: {
    rnd?: number;
    round?: number;
    cert?: {
      prop?: string;
    };
    proposer?: string;
    header?: {
      proposer?: string;
      rewards?: {
        'rewards-level'?: number;
      };
    };
    rewards?: {
      'rewards-level'?: number;
    };
    rwd?: {
      rl?: number;
    };
    spt?: Array<{
      n?: number;
    }>;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface MempoolStats {
  totalInPool: number;
  shown: number;
  coverage: number;
}

export interface AlgorandingResponse {
  transactions: Transaction[];
  stats?: MempoolStats;
}

export interface PendingTransactionsResponse {
  top?: Transaction[];
  'top-transactions'?: Transaction[];
  [key: string]: any;
}

export interface StatusResponse {
  'last-round': number;
  [key: string]: any;
}

export interface ApiRequest {
  url: string;
  headers: Record<string, string>;
}

export interface ConnectionTestResult {
  connected: boolean;
  transactionsCount: number;
}

export type MempoolMode = 'algoranding' | 'nodely' | 'user_node';
export type BlockMode = 'user_node' | 'algoranding' | 'nodely';

export interface CurrentModes {
  mempool: MempoolMode;
  block: BlockMode;
}

export interface BlockReward {
  txn: {
    type: string;
    snd: string;
    rcv: string | null;
    amt: number;
    round: number;
    fee: number;
  };
  blockReward: boolean;
  round: number;
}

export interface BlockSignal {
  txn: {
    type: string;
    round: number;
    snd: string;
    rcv: string | null;
  };
  round: number;
  nextStateProofRound: number | null;
}

export type TransactionCallback = (type: string, data: any) => void;
