#!/usr/bin/env node
/**
 * Simple polling matcher for the PoC (Hardhat runtime)
 * - Reads buyer intents from data/intents.json (status=ARMED)
 * - Reads seller orders from data/orders.sepolia.json
 * - For amount=100 and same (vmId, outcomeIndex), computes p/WP using utils/wp.js
 * - Auto-fulfills via buyer-fulfill.cjs if p/WP ≤ intent.maxPricePerWP
 *
 * Run with Hardhat (utils/wp.js uses hardhat's ethers provider):
 *   npx hardhat run scripts/matcher-run.cjs --network sepolia
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Hardhat runtime (so utils/wp.js gets hardhat's ethers)
const { ethers } = require('hardhat');

// Your helpers (exact names as you provided)
const { getWpForToken, pricePerWP_1e6, humanUSDC, humanPricePerWP } = require('./utils/wp');

const INTENTS_FILE      = path.join(__dirname, '..', 'data', 'intents.json');
const ORDERS_BOOK_FILE  = path.join(__dirname, '..', 'data', 'orders.sepolia.json');
const TMP_MATCHED_ORDER = path.join(__dirname, '..', 'data', 'matched-order.json');

const WP_ADDR = process.env.WP_ADDR; // WPERC1155
let _pollId = null;

function loadJson(p) {
  try {
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw || !raw.trim()) return []; // empty file → []
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[matcher] WARN: failed to read/parse ${p}: ${e.message}`);
    return []; // fail-soft: next tick will retry
  }
}

function saveJson(p, v) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
}


function nowIso() { return new Date().toISOString(); }
function isExpired(iso) { return new Date(iso).getTime() <= Date.now(); }

/** "0.6" -> 600000 (1e6) */
function parseThreshold1e6(s) {
  const asStr = String(s);
  const [intPart, frac = ''] = asStr.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return Number(intPart) * 1e6 + Number(fracPadded);
}

/**
 * Normalize one orderbook entry (from orders.sepolia.json) into a compact shape
 * We prefer entry.meta.*, but can fall back to order.parameters if meta is missing.
 */
function normalizeOrderEntry(entry) {
  const order = entry?.order;
  const p = order?.parameters;
  const off0 = p?.offer?.[0];
  const con0 = p?.consideration?.[0];

  // Prefer meta
  let tokenId = entry?.meta?.tokenId ?? off0?.identifierOrCriteria;
  let amount  = entry?.meta?.amount  ?? off0?.startAmount;
  let ask6 = con0?.startAmount ?? entry?.meta?.askUSDC_6dec;
  let seller  = entry?.meta?.seller ?? p?.offerer;

  if (tokenId == null || amount == null || ask6 == null) return null;

  return {
    order,
    seller,
    tokenId: tokenId.toString(),
    amount : Number(amount),
    askUSDC1e6: ask6.toString(),
  };
}

/** Read vmId / outcomeIndex from tokenId using WP.destructure */
async function destructureTokenId(tokenId) {
  const abi = [
    "function destructure(uint256 tokenId) pure returns (uint256 vmId, uint8 outcomeIndex, uint32 timeslot)"
  ];
  const wp = new ethers.Contract(WP_ADDR, abi, ethers.provider);
  const r = await wp.destructure(tokenId);
  // Handle both named & indexed returns
  const vmId = (r.vmId ?? r[0]).toString();
  const outcomeIndex = Number(r.outcomeIndex ?? r[1]);
  return { vmId, outcomeIndex };
}

async function tryMatchOnce() {
  if (!WP_ADDR) {
    console.error('Missing WP_ADDR (WPERC1155 address) in environment.');
    return;
  }

  const intentsAll = loadJson(INTENTS_FILE);
  const intents = intentsAll.filter(x =>
    x.status === 'ARMED' &&
    !isExpired(x.deadline)
  );
  if (!intents.length) return;

  const ordersBook = loadJson(ORDERS_BOOK_FILE);
  if (!ordersBook.length) return;

  const candidatesRaw = ordersBook.map(normalizeOrderEntry).filter(Boolean);
  if (!candidatesRaw.length) return;

  for (const intent of intents) {
    const thresh1e6 = parseThreshold1e6(intent.maxPricePerWP);

    for (const cand of candidatesRaw) {
      // amount must be exactly 100 for the PoC (no partial fills)
      if (cand.amount !== intent.amount) continue; // amounts must match exactly (no partial fills)

      // derive vmId/outcomeIndex from tokenId (on-chain)
      const { vmId, outcomeIndex } = await destructureTokenId(cand.tokenId);

      // must match the buyer intent target
      if (vmId !== intent.vmId || outcomeIndex !== intent.outcomeIndex) continue;

      // Compute WP_total (1e6) and p/WP (1e6)
      const { wp1e6 } = await getWpForToken(WP_ADDR, cand.tokenId, cand.amount);
      if (wp1e6 <= 0n) continue; // guard

      const pPerWP_1e6 = pricePerWP_1e6(cand.askUSDC1e6, wp1e6);

      if (pPerWP_1e6 <= BigInt(thresh1e6)) {
        const humanPrice = humanPricePerWP(pPerWP_1e6);
        const humanAsk   = humanUSDC(cand.askUSDC1e6);

        // --- PRECHECK: seller balance + approval (cheap reads) ---
        const i1155View = new ethers.Interface([
          "function balanceOf(address account, uint256 id) view returns (uint256)",
          "function isApprovedForAll(address account, address operator) view returns (bool)"
        ]);
        const wpView = new ethers.Contract(WP_ADDR, i1155View, ethers.provider);
        const balSellerNow = await wpView.balanceOf(cand.seller, cand.tokenId);
        if (balSellerNow < BigInt(cand.amount)) {
          // Opcional: marca un “cooldown” para no reintentar este matchRef unos minutos
          continue;
        }
        const approved = await wpView.isApprovedForAll(cand.seller, process.env.SEPOLIA_SEAPORT || process.env.SEAPORT_ADDR);
        if (!approved) {
          // idem cooldown si quieres
          continue;
        }
        // --- END PRECHECK ---

        const wpHuman = Number(wp1e6) / 1e6;

        console.log(
          `🔎 Automatic MATCH → Between buyer intent with ID ${intent.id} and seller signed order with tokenId=${cand.tokenId} | ` +
          `p/WP=${humanPrice} ≤ ${intent.maxPricePerWP} | askUSDC=${humanAsk} | WP≈${wpHuman.toFixed(6)}`
        );
        

        // Pass matched order to buyer-fulfill via JSON
        saveJson(TMP_MATCHED_ORDER, { order: cand.order, buyer: intent.buyer })

        // Spawn fulfill (project root = seaport-demo)
    
        const { spawn } = require('child_process');


        const root = path.join(__dirname, '..');

        const isWin = process.platform === 'win32';
        const cmd   = isWin ? 'cmd' : 'node';
        const args  = isWin
          ? ['/c', 'node', '-r', 'hardhat/register', 'scripts\\buyer-fulfill.cjs',
            '--orderjsonpath', 'data\\matched-order.json']
          : ['-r', 'hardhat/register', 'scripts/buyer-fulfill.cjs',
            '--orderjsonpath', 'data/matched-order.json'];

        let child;
        try {
          child = spawn(cmd, args, {
            cwd: root,
            stdio: 'inherit',
            windowsHide: true,           // evita la “pantalla negra”
            env: { ...process.env, HARDHAT_NETWORK: 'sepolia' }, // fija la red
          });

          // One-shot: detenemos el polling, pero NO cerramos aún;
          // saldremos cuando termine el hijo (para ver sus logs).
          if (_pollId) {
            clearInterval(_pollId);
            _pollId = null;
          }
          //console.log('⏸ Matcher one-shot: fulfill lanzado. Esperando a que termine el hijo…');

          child.on('exit', (code) => {
            //console.log(`↪ buyer-fulfill salió con código ${code}`);
            // cierra el matcher reflejando el estado del fulfill (0=ok, !=0=error)
            process.exit(code || 0);
          });


        } catch (e) {
           // (opcional) si ya no usas EXECUTING/ARMED, no toques intents.json aquí
          console.error('❌ spawn failed:', e);
          return;
        }
      }
    }
  }
}

(async () => {
  console.log('👀 Matcher started. Polling every 10s...');
  _pollId = setInterval(() => {
    tryMatchOnce().catch(err => console.error('Matcher error:', err));
  }, 10000);
})();
