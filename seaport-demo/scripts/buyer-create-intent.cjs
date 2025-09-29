#!/usr/bin/env node
/**
 * Minimal buyer intent creator (off-chain)
 * - Stores a "buy 100 if p/WP ≤ 0.6" intent into data/intents.json
 * - We keep it simple: amount=100 fixed, maxPricePerWP defaults to 0.6
 * - Status: we set ARMED as soon as buyer has approved USDC (we can set PENDING first if we prefer a separate "arm" step)
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const DATA_FILE = path.join(__dirname, '..', 'data', 'intents.json');

function loadJson(p) {
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJson(p, v) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
}


(async () => {
 /* const args = require('minimist')(process.argv.slice(2));
  // Required minimal args
  const vmId = args.vmid || args.vm || null;              // e.g. "VM_MadridBarca_2025_09_30"
  const outcomeIndex = Number(args.outcome ?? args.o ?? 0);
  const amount = Number(args.amount ?? 100);               // fixed to 100 per PoC requirement
  const maxPricePerWP = args.maxpperwp ? String(args.maxpperwp) : '0.6'; // string for clarity
  const deadlineHours = Number(args.deadlinehours ?? 72);   // default: 24h from now*/

  // --- BEGIN: parse args (positional or flags) ---
let raw = process.argv.slice(2);
if (raw[0] === '--') raw = raw.slice(1);

let vmId, outcomeIndex, amount, maxPricePerWP, deadlineHours;

if (raw.some(a => String(a).startsWith('--'))) {
  // FLAG MODE (all-lowercase flags to avoid Hardhat HH310)
  const a = require('minimist')(raw);
  vmId          = a.vmid ?? a.vm ?? a.vmidhex ?? a.vmhex ?? null;
  outcomeIndex  = Number(a.outcome ?? a.o ?? 0);
  amount        = Number(a.amount ?? a.qty ?? 100);
  maxPricePerWP = (a.maxpperwp ?? a.max ?? '0.6').toString();
  deadlineHours = Number(a.deadlinehours ?? a.dh ?? 72);
} else {
  // POSITIONAL MODE: [vmId, outcome, amount, maxPperWP, deadlineHours]
  vmId          = raw[0] ?? null;
  outcomeIndex  = Number(raw[1] ?? 0);
  amount        = Number(raw[2] ?? 100);
  maxPricePerWP = (raw[3] ?? '0.6').toString();
  deadlineHours = Number(raw[4] ?? 72);
}

if (vmId == null) {
  console.error('Missing vmId (positional or --vmid)');
  process.exit(1);
}
if (typeof vmId !== 'string') vmId = String(vmId);
// --- END: parse args ---

  if (!vmId) {
    console.error('Missing --vmId');
    process.exit(1);
  }
  if (amount !== 100) {
    console.error('For the PoC we only support amount=100 (no partial fills).');
    process.exit(1);
  }

  // Derive buyer address (from PK or explicit)
  const rpc = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
  if (!rpc) {
    console.error('Missing SEPOLIA_RPC_URL in .env');
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(rpc);

  // Optional CLI override: --buyer <address> (only works in flag mode)
  let buyerAddr = null;
  try {
    let raw2 = process.argv.slice(2);
    if (raw2[0] === '--') raw2 = raw2.slice(1);
    if (raw2.some(a => String(a).startsWith('--'))) {
      const a2 = require('minimist')(raw2);
      buyerAddr = a2.buyer || a2.b || null;
    }
  } catch (_) { /* ignore */ }

  if (!buyerAddr) {
    const pk = process.env.BUYER_PK;
    if (!pk) {
      console.error('Provide --buyer or set BUYER_PK in .env');
      process.exit(1);
    }
    buyerAddr = new ethers.Wallet(pk, provider).address;
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + deadlineHours * 3600 * 1000).toISOString();
  const id = `${Date.now()}_${Math.floor(Math.random()*1e6)}`;

  const intents = loadJson(DATA_FILE);

  const intent = {
    id,
    vmId,
    outcomeIndex,
    amount,                 // 100 fixed
    maxPricePerWP: '0.6',   // we keep it fixed by default. We can override it with --maxPperWP if needed
    status: 'ARMED',        // PoC: mark as ARMED immediately after buyer approval (keep simple)
    buyer: buyerAddr,
    deadline,
    createdAt: now.toISOString(),
  };

  // If user passed a different threshold, keep it
  intent.maxPricePerWP = String(maxPricePerWP);

  intents.push(intent);
  saveJson(DATA_FILE, intents);

  console.log('✅ Buyer intent stored:', intent);
})();

// Este script buyer-create-intent.cjs no usa el Hardhat Runtime Environment (HRE). Entonces usamos Node y no Hardhat que es mas delicado para pasar argumentos. Podemos usar: 
// node scripts/buyer-create-intent.cjs --vmid 1099511627776 --outcome 1 --amount 100 --maxpperwp 0.6 --deadlinehours 72
// o node scripts/buyer-create-intent.cjs 1099511627776 1 100 0.6 72


