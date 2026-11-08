#!/usr/bin/env node
// Deploys the uprali-ledger contract to NEAR testnet in one transaction:
// creates ledger.<your account>, funds it, deploys contract/res/uprali_ledger.wasm and
// initialises it with your account as owner. Your account then signs every record.
//
// Usage:  npm run contract:deploy            (reads NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY from .env.local or the shell)
//         npm run contract:deploy -- --prefix ledger2 --fund 3
//
// Testnet only. No key is printed or written anywhere; the new account gets your own public key.
import fs from "node:fs";
import path from "node:path";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas } from "near-api-js";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(path.resolve(".env.local"));
loadEnvFile(path.resolve(".env"));

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};

const network = process.env.NEAR_NETWORK || "testnet";
if (network !== "testnet") {
  console.error("Refusing to deploy: this script only targets NEAR testnet.");
  process.exit(1);
}
const accountId = process.env.NEAR_ACCOUNT_ID;
const privateKey = process.env.NEAR_PRIVATE_KEY;
if (!accountId || !privateKey) {
  console.error("Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a testnet account) in .env.local first. See README, 'Put the ledger on NEAR testnet'.");
  process.exit(1);
}
if (!accountId.endsWith(".testnet")) {
  console.error(`NEAR_ACCOUNT_ID must be a .testnet account, got ${accountId}.`);
  process.exit(1);
}

const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
const prefix = arg("prefix", "ledger");
const fundNear = arg("fund", "3"); // the 212 KB wasm needs about 2.2 NEAR of storage
const contractId = `${prefix}.${accountId}`;
const wasmPath = path.resolve("contract/res/uprali_ledger.wasm");
const code = new Uint8Array(fs.readFileSync(wasmPath));

const provider = new JsonRpcProvider({ url: rpcUrl });
const account = new Account(accountId, provider, privateKey);
const publicKey = KeyPair.fromString(privateKey).getPublicKey();

console.log(`Deploying ${path.basename(wasmPath)} (${code.length} bytes) to ${contractId} on testnet, funded with ${fundNear} NEAR from ${accountId}...`);
try {
  const res = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto(fundNear)),
      actions.addFullAccessKey(publicKey),
      actions.deployContract(code),
      actions.functionCall("new", { owner: accountId }, teraToGas("30"), 0n),
    ],
  });
  const tx = res.transaction_outcome?.id ?? res.transaction?.hash;
  console.log(`Done. Transaction: https://testnet.nearblocks.io/txns/${tx}`);
} catch (err) {
  console.error(`Deploy failed: ${err?.message ?? err}`);
  console.error("If the account already exists, pass --prefix with a new name. If funds are short, top up at the testnet faucet.");
  process.exit(1);
}

const owner = await provider.callFunction({ contractId, method: "owner", args: {} });
console.log(`Contract owner: ${owner}`);
console.log("\nAdd this line to .env.local and to your Vercel project's environment variables:\n");
console.log(`NEAR_CONTRACT_ID=${contractId}`);
