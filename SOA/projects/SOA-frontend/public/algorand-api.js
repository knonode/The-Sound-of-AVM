const x = {
  algodServer: "http://localhost",
  algodPort: 8081,
  nodelyBaseUrl: "https://mainnet-api.4160.nodely.dev",
  algorandingBaseUrl: "https://mempool.algorand.ing/api/mempool",
  algodToken: null,
  defaultMempoolMode: "algoranding",
  defaultBlockMode: "nodely"
};
function I() {
  return {
    ...x
    // Environment variables would be loaded here like:
    // algodServer: import.meta.env.VITE_ALGOD_SERVER || DEFAULT_CONFIG.algodServer,
    // algodPort: parseInt(import.meta.env.VITE_ALGOD_PORT) || DEFAULT_CONFIG.algodPort,
    // etc.
  };
}
const i = I();
let a = i.defaultMempoolMode, d = i.defaultBlockMode, f = i.algodToken, w = null, y = null, g = 0, c = 0, h = !1;
async function P() {
  const o = await R(), t = await C();
  return console.log(`Mempool connection (${a}): ${o ? "✅" : "❌"}`), console.log(`Block connection (${d}): ${t ? "✅" : "❌"}`), o && t;
}
async function R() {
  let o, t;
  if (a === "algoranding") {
    const e = $("");
    o = e.url, t = e.headers;
  } else {
    const e = $("/v2/transactions/pending");
    o = e.url, t = e.headers;
  }
  try {
    console.log(`Testing mempool connection to ${a} at ${o}...`), console.log("Headers being sent:", t);
    const e = await fetch(o, { headers: t });
    if (e.ok) {
      const n = await e.json();
      if (console.log("✅ Mempool connection successful"), a === "algoranding" && n.stats) {
        const r = n.stats;
        console.log(`Algoranding stats: ${r.totalInPool} total, ${r.shown} shown, ${r.coverage}% coverage`);
      }
      return !0;
    } else {
      const n = await e.text();
      return console.error(`❌ Mempool connection failed: ${e.status} ${e.statusText}`), console.error("Response body:", n), !1;
    }
  } catch (e) {
    return console.error("❌ Mempool connection error:", e), !1;
  }
}
async function C() {
  console.log(`Testing block connection to ${d}...`);
  const o = m("/v2/status");
  if (!o)
    return console.error("❌ Block connection failed: No valid block API configuration"), !1;
  const { url: t, headers: e } = o;
  console.log("Block connection headers:", e);
  try {
    const n = await fetch(t, { headers: e });
    if (n.ok) {
      const r = await n.json();
      return console.log("✅ Block connection successful:", r), !0;
    } else
      return console.error(`❌ Block connection failed: ${n.status} ${n.statusText}`), !1;
  } catch (n) {
    return console.error("❌ Block connection error:", n), !1;
  }
}
async function B() {
  let o, t;
  if (a === "algoranding") {
    const e = $("");
    o = e.url, t = e.headers;
  } else {
    const e = $("/v2/transactions/pending");
    o = e.url, t = e.headers;
  }
  try {
    const e = await fetch(o, { headers: t });
    if (e.ok) {
      const n = await e.json();
      let r = [];
      if (a === "algoranding")
        n && n.transactions && Array.isArray(n.transactions) && (r = n.transactions);
      else {
        const s = n;
        s && s.top && Array.isArray(s.top) ? r = s.top : s && s["top-transactions"] && Array.isArray(s["top-transactions"]) ? r = s["top-transactions"] : s && Array.isArray(s) && (r = s);
      }
      return r;
    } else
      return console.error(`Failed to fetch pending transactions: ${e.status} ${e.statusText}`), [];
  } catch (e) {
    return console.error("Error fetching pending transactions:", e), [];
  }
}
function M(o, t) {
  return t == null ? (a === "user_node" && d === "user_node" ? t = 50 : t = 500, console.log(`Auto-selected interval: ${t}ms for mempool:${a}, blocks:${d}`)) : console.log(`Using explicit interval: ${t}ms`), w && v(), y = o, g = 0, c = 0, (async () => {
    if (c === 0)
      try {
        const n = m("/v2/status");
        if (!n)
          throw new Error("No valid block API configuration");
        const { url: r, headers: s } = n, u = await fetch(r, { headers: s });
        if (u.ok)
          c = (await u.json())["last-round"], console.log(`🚀 Starting from current round: ${c}`);
        else
          throw new Error(`Status call failed: ${u.status}`);
      } catch (n) {
        console.warn("Could not get starting round, using fallback:", n), c = 51125e3;
      }
    w = setInterval(async () => {
      try {
        const n = await B();
        if (!Array.isArray(n)) {
          console.warn("Expected an array of transactions but got:", n);
          return;
        }
        const r = n.length;
        if (r > g) {
          const s = r - g, u = n.slice(0, s);
          E(u);
        } else if (r < g) {
          const s = await L(c);
          console.log(`${g - r} transactions from mempool were processed into block nr ${c}, Nodely count of txs: ${s}`);
        }
        g = r, !h && c > 0 && (h = !0, _(c).then((s) => {
          s > c && D(s);
        }).catch((s) => {
          h = !1;
        }).finally(() => {
          h = !1;
        }));
      } catch (n) {
        console.error("Error during polling:", n);
      }
    }, t), console.log(`Started polling for transactions and blocks every ${t}ms`);
  })(), !0;
}
function v() {
  w && (clearInterval(w), w = null, h = !1, console.log("Stopped polling for transactions"));
}
function E(o) {
  if (!y || !Array.isArray(o) || o.length === 0)
    return;
  const t = y;
  o.forEach((e) => {
    try {
      let n = "pay";
      e.txn && e.txn.type ? n = e.txn.type : e.tx && e.tx.type ? n = e.tx.type : e.type && (n = e.type), t(n, e);
    } catch (n) {
      console.error("Error processing transaction:", n), t("pay", e);
    }
  });
}
async function S() {
  console.log("Testing Algorand connection...");
  const o = await P();
  if (console.log("Connection test result:", o), o) {
    console.log("Testing pending transactions API...");
    const t = await B();
    return console.log("Got transactions:", t), { connected: o, transactionsCount: t.length };
  }
  return { connected: o, transactionsCount: 0 };
}
function j() {
  return c > 0 ? c : null;
}
function N(o) {
  var t, e, n, r, s, u;
  try {
    console.log("🔍 Starting reward extraction...");
    const l = o.block || o, A = ((t = l == null ? void 0 : l.cert) == null ? void 0 : t.prop) || (l == null ? void 0 : l.proposer) || ((e = l == null ? void 0 : l.header) == null ? void 0 : e.proposer) || null;
    console.log("🔍 Found proposer:", A);
    const p = ((n = l == null ? void 0 : l.rewards) == null ? void 0 : n["rewards-level"]) || ((s = (r = l == null ? void 0 : l.header) == null ? void 0 : r.rewards) == null ? void 0 : s["rewards-level"]) || ((u = l == null ? void 0 : l.rwd) == null ? void 0 : u.rl) || 1e7;
    if (console.log("🔍 Found reward amount:", p), A) {
      const k = {
        txn: {
          type: "reward",
          snd: "ALGORAND-PROTOCOL",
          rcv: A,
          amt: p,
          round: l.rnd || l.round || 0,
          fee: 0
        },
        blockReward: !0,
        round: l.rnd || l.round || 0
      };
      return console.log("🏆 Created reward transaction:", k), k;
    }
    return console.log("❌ No proposer found in block"), null;
  } catch (l) {
    return console.error("💥 Error extracting block reward:", l), null;
  }
}
async function U() {
  return console.log("Block API test disabled - main polling is working correctly"), !0;
}
function q(o) {
  o && typeof o == "string" && o.length > 10 ? (f = o, console.log("Custom Algorand API token has been set.")) : console.warn("Attempted to set an invalid API token. Using default.");
}
function b() {
  if (!f)
    throw new Error("Algorand API token not set. Please configure your node token.");
}
function O(o) {
  ["algoranding", "nodely", "user_node"].includes(o) ? (a = o, console.log(`Mempool mode set to: ${o}`)) : console.error(`Invalid mempool mode: ${o}`);
}
function F(o) {
  ["user_node", "algoranding", "nodely"].includes(o) ? (d = o, console.log(`Block mode set to: ${o}`)) : console.error(`Invalid block mode: ${o}`);
}
function $(o) {
  if (a === "algoranding")
    return {
      url: i.algorandingBaseUrl,
      headers: {
        Accept: "application/json",
        Origin: window.location.origin,
        Referer: window.location.href
      }
    };
  if (a === "user_node")
    return b(), {
      url: `${i.algodServer}:${i.algodPort}${o}`,
      headers: {
        "X-Algo-API-Token": f,
        Accept: "application/json"
      }
    };
  if (a === "nodely")
    return {
      url: `${i.nodelyBaseUrl}${o}`,
      headers: {
        Accept: "application/json"
      }
    };
  throw new Error(`Invalid mempool mode: ${a}`);
}
function m(o) {
  return d === "user_node" ? (b(), {
    url: `${i.algodServer}:${i.algodPort}${o}`,
    headers: {
      "X-Algo-API-Token": f,
      Accept: "application/json"
    }
  }) : d === "nodely" ? {
    url: `${i.nodelyBaseUrl}${o}`,
    headers: {
      Accept: "application/json"
    }
  } : d === "algoranding" ? f ? (b(), {
    url: `${i.algodServer}:${i.algodPort}${o}`,
    headers: {
      "X-Algo-API-Token": f,
      Accept: "application/json"
    }
  }) : (console.error("Algoranding mode requires user node token for block data"), null) : null;
}
async function _(o) {
  const t = m(`/v2/status/wait-for-block-after/${o}`);
  if (!t)
    throw new Error("No valid block API configuration");
  const { url: e, headers: n } = t, r = await fetch(e, { headers: n });
  if (!r.ok)
    throw new Error(`Status API error: ${r.status} ${r.statusText}`);
  return (await r.json())["last-round"];
}
async function D(o) {
  var p, k, T;
  const t = m(`/v2/blocks/${o}`);
  if (!t)
    throw new Error("No valid block API configuration");
  const { url: e, headers: n } = t, r = await fetch(e, { headers: n });
  if (!r.ok)
    throw new Error(`Block API error: ${r.status} ${r.statusText}`);
  const s = await r.json(), u = s.block.rnd || s.block.round || o, l = ((T = (k = (p = s == null ? void 0 : s.block) == null ? void 0 : p.spt) == null ? void 0 : k[0]) == null ? void 0 : T.n) || null;
  y && y("block", {
    txn: {
      type: "block",
      round: u,
      snd: "ALGORAND-PROTOCOL",
      rcv: null
    },
    round: u,
    nextStateProofRound: l
  }), c = u;
}
async function L(o) {
  try {
    const t = `${i.nodelyBaseUrl}/v2/blocks/${o}`, n = await fetch(t, { headers: {
      Accept: "application/json"
    } });
    if (!n.ok)
      return console.warn(`Failed to fetch block ${o} from Nodely: ${n.status}`), 0;
    const r = await n.json();
    return r.block && r.block.txns ? r.block.txns.length : 0;
  } catch (t) {
    return console.warn(`Error fetching Nodely block data for round ${o}:`, t), 0;
  }
}
const G = {
  initAlgodConnection: P,
  getPendingTransactions: B,
  startPolling: M,
  stopPolling: v,
  testConnection: S,
  getLatestBlockRound: j,
  extractBlockReward: N,
  testBlockAPI: U,
  setApiToken: q,
  setMempoolMode: O,
  setBlockMode: F,
  getCurrentModes: () => ({ mempool: a, block: d })
};
export {
  G as AlgorandAPI,
  i as config,
  G as default,
  I as getAlgorandConfig
};
