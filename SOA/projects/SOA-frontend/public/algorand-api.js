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
let a = i.defaultMempoolMode, d = i.defaultBlockMode, f = i.algodToken, y = null, p = null, g = 0, c = 0, w = !1;
async function P() {
  const o = await R(), e = await C();
  return console.log(`Mempool connection (${a}): ${o ? "✅" : "❌"}`), console.log(`Block connection (${d}): ${e ? "✅" : "❌"}`), o && e;
}
async function R() {
  let o, e;
  if (a === "algoranding") {
    const n = $("");
    o = n.url, e = n.headers;
  } else {
    const n = $("/v2/transactions/pending");
    o = n.url, e = n.headers;
  }
  try {
    console.log(`Testing mempool connection to ${a} at ${o}...`), console.log("Headers being sent:", e);
    const n = await fetch(o, { headers: e });
    if (n.ok) {
      const t = await n.json();
      if (console.log("✅ Mempool connection successful"), a === "algoranding" && t.stats) {
        const r = t.stats;
        console.log(`Algoranding stats: ${r.totalInPool} total, ${r.shown} shown, ${r.coverage}% coverage`);
      }
      return !0;
    } else {
      const t = await n.text();
      return console.error(`❌ Mempool connection failed: ${n.status} ${n.statusText}`), console.error("Response body:", t), !1;
    }
  } catch (n) {
    return console.error("❌ Mempool connection error:", n), !1;
  }
}
async function C() {
  console.log(`Testing block connection to ${d}...`);
  const o = m("/v2/status");
  if (!o)
    return console.error("❌ Block connection failed: No valid block API configuration"), !1;
  const { url: e, headers: n } = o;
  console.log("Block connection headers:", n);
  try {
    const t = await fetch(e, { headers: n });
    if (t.ok) {
      const r = await t.json();
      return console.log("✅ Block connection successful:", r), !0;
    } else
      return console.error(`❌ Block connection failed: ${t.status} ${t.statusText}`), !1;
  } catch (t) {
    return console.error("❌ Block connection error:", t), !1;
  }
}
async function B() {
  let o, e;
  if (a === "algoranding") {
    const n = $("");
    o = n.url, e = n.headers;
  } else {
    const n = $("/v2/transactions/pending");
    o = n.url, e = n.headers;
  }
  try {
    const n = await fetch(o, { headers: e });
    if (n.ok) {
      const t = await n.json();
      let r = [];
      if (a === "algoranding")
        t && t.transactions && Array.isArray(t.transactions) && (r = t.transactions);
      else {
        const s = t;
        s && s.top && Array.isArray(s.top) ? r = s.top : s && s["top-transactions"] && Array.isArray(s["top-transactions"]) ? r = s["top-transactions"] : s && Array.isArray(s) && (r = s);
      }
      return r;
    } else
      return console.error(`Failed to fetch pending transactions: ${n.status} ${n.statusText}`), [];
  } catch (n) {
    return console.error("Error fetching pending transactions:", n), [];
  }
}
function M(o, e) {
  return e == null ? (a === "user_node" && d === "user_node" ? e = 50 : e = 500, console.log(`Auto-selected interval: ${e}ms for mempool:${a}, blocks:${d}`)) : console.log(`Using explicit interval: ${e}ms`), y && v(), p = o, g = 0, c = 0, (async () => {
    if (c === 0)
      try {
        const t = m("/v2/status");
        if (!t)
          throw new Error("No valid block API configuration");
        const { url: r, headers: s } = t, u = await fetch(r, { headers: s });
        if (u.ok)
          c = (await u.json())["last-round"], console.log(`🚀 Starting from current round: ${c}`);
        else
          throw new Error(`Status call failed: ${u.status}`);
      } catch (t) {
        console.warn("Could not get starting round, using fallback:", t), c = 51125e3;
      }
    y = setInterval(async () => {
      try {
        const t = await B();
        if (!Array.isArray(t)) {
          console.warn("Expected an array of transactions but got:", t);
          return;
        }
        const r = t.length;
        if (r > g) {
          const s = r - g, u = t.slice(0, s);
          E(u);
        } else if (r < g) {
          const s = await L(c);
          console.log(`${g - r} transactions from mempool were processed into block nr ${c}, Nodely count of txs: ${s}`);
        }
        g = r, !w && c > 0 && (w = !0, _(c).then((s) => {
          s > c && D(s);
        }).catch((s) => {
          w = !1;
        }).finally(() => {
          w = !1;
        }));
      } catch (t) {
        console.error("Error during polling:", t);
      }
    }, e), console.log(`Started polling for transactions and blocks every ${e}ms`);
  })(), !0;
}
function v() {
  y && (clearInterval(y), y = null, w = !1, console.log("Stopped polling for transactions"));
}
function E(o) {
  !p || !Array.isArray(o) || o.length === 0 || o.forEach((e) => {
    try {
      let n = "pay";
      e.txn && e.txn.type ? n = e.txn.type : e.tx && e.tx.type ? n = e.tx.type : e.type && (n = e.type), p(n, e);
    } catch (n) {
      console.error("Error processing transaction:", n), p("pay", e);
    }
  });
}
async function S() {
  console.log("Testing Algorand connection...");
  const o = await P();
  if (console.log("Connection test result:", o), o) {
    console.log("Testing pending transactions API...");
    const e = await B();
    return console.log("Got transactions:", e), { connected: o, transactionsCount: e.length };
  }
  return { connected: o, transactionsCount: 0 };
}
function j() {
  return c > 0 ? c : null;
}
function N(o) {
  var e, n, t, r, s, u;
  try {
    console.log("🔍 Starting reward extraction...");
    const l = o.block || o, A = ((e = l == null ? void 0 : l.cert) == null ? void 0 : e.prop) || (l == null ? void 0 : l.proposer) || ((n = l == null ? void 0 : l.header) == null ? void 0 : n.proposer) || null;
    console.log("🔍 Found proposer:", A);
    const h = ((t = l == null ? void 0 : l.rewards) == null ? void 0 : t["rewards-level"]) || ((s = (r = l == null ? void 0 : l.header) == null ? void 0 : r.rewards) == null ? void 0 : s["rewards-level"]) || ((u = l == null ? void 0 : l.rwd) == null ? void 0 : u.rl) || 1e7;
    if (console.log("🔍 Found reward amount:", h), A) {
      const k = {
        txn: {
          type: "reward",
          snd: "ALGORAND-PROTOCOL",
          rcv: A,
          amt: h,
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
  const e = m(`/v2/status/wait-for-block-after/${o}`);
  if (!e)
    throw new Error("No valid block API configuration");
  const { url: n, headers: t } = e, r = await fetch(n, { headers: t });
  if (!r.ok)
    throw new Error(`Status API error: ${r.status} ${r.statusText}`);
  return (await r.json())["last-round"];
}
async function D(o) {
  var h, k, T;
  const e = m(`/v2/blocks/${o}`);
  if (!e)
    throw new Error("No valid block API configuration");
  const { url: n, headers: t } = e, r = await fetch(n, { headers: t });
  if (!r.ok)
    throw new Error(`Block API error: ${r.status} ${r.statusText}`);
  const s = await r.json(), u = s.block.rnd || s.block.round || o, l = ((T = (k = (h = s == null ? void 0 : s.block) == null ? void 0 : h.spt) == null ? void 0 : k[0]) == null ? void 0 : T.n) || null;
  p && p("block", {
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
    const e = `${i.nodelyBaseUrl}/v2/blocks/${o}`, t = await fetch(e, { headers: {
      Accept: "application/json"
    } });
    if (!t.ok)
      return console.warn(`Failed to fetch block ${o} from Nodely: ${t.status}`), 0;
    const r = await t.json();
    return r.block && r.block.txns ? r.block.txns.length : 0;
  } catch (e) {
    return console.warn(`Error fetching Nodely block data for round ${o}:`, e), 0;
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
