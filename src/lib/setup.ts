/**
 * Pure helpers for the /setup page, which creates the testnet ledger with no terminal. The two
 * accounts are created and funded by NEAR's testnet faucet service (the one near-cli's
 * `sponsor-by-faucet-service` uses), so the owner needs no testnet NEAR of their own.
 * Kept here so they can be tested without a browser or NEAR.
 */

export const RELAYER_ALLOWANCE_NEAR = "1"; // the relayer key can spend at most this on gas, then stops
export const LEDGER_MIN_NEAR = 2.5; // the ~217 KB contract locks about 2.2 NEAR of storage
/** NEAR's testnet account helper: creates a new .testnet account with a key you give it, and funds it. */
export const FAUCET_URL = "https://helper.nearprotocol.com/account";

const SPONSORED_RE = /^uprali-(ledger|relayer)-[a-z2-9]{6,16}\.testnet$/;
const ED25519_PUB_RE = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** The two faucet-funded accounts, named uprali-ledger-<code>.testnet and uprali-relayer-<code>.testnet. */
export function sponsoredNames(code: string): { ledgerId: string; relayerId: string } {
  return { ledgerId: `uprali-ledger-${code}.testnet`, relayerId: `uprali-relayer-${code}.testnet` };
}

/** Only names this page makes and plain ed25519 public keys may go to the faucet through our server. */
export function validSponsorRequest(x: unknown): { accountId: string; publicKey: string } | null {
  if (!x || typeof x !== "object") return null;
  const { accountId, publicKey } = x as Record<string, unknown>;
  if (typeof accountId !== "string" || typeof publicKey !== "string") return null;
  if (!SPONSORED_RE.test(accountId) || !ED25519_PUB_RE.test(publicKey)) return null;
  return { accountId, publicKey };
}

export function validOwner(owner: string): string | null {
  const o = owner.trim().toLowerCase();
  return o.endsWith(".testnet") && o.length <= 64 && ACCOUNT_RE.test(o) ? o : null;
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const PREFIX_RE = /^([a-z\d]+[-_])*[a-z\d]+$/;

export interface SetupNames {
  owner: string;
  ledgerId: string;
  relayerId: string;
}

/** Works out the two sub-accounts, or says in plain words what's wrong with the input. */
export function setupNames(owner: string, ledgerPrefix = "ledger", relayerPrefix = "relayer"): SetupNames | { error: string } {
  const o = owner.trim().toLowerCase();
  if (!o.endsWith(".testnet")) return { error: "Use a NEAR testnet account, one that ends in .testnet." };
  if (!ACCOUNT_RE.test(o)) return { error: `"${owner}" isn't a valid NEAR account name.` };
  for (const p of [ledgerPrefix, relayerPrefix]) {
    if (!PREFIX_RE.test(p)) return { error: `"${p}" can only use lowercase letters, numbers, - and _.` };
  }
  if (ledgerPrefix === relayerPrefix) return { error: "The ledger and the relayer need different names." };
  const ledgerId = `${ledgerPrefix}.${o}`;
  const relayerId = `${relayerPrefix}.${o}`;
  if (ledgerId.length > 64 || relayerId.length > 64) return { error: "Those names are too long. NEAR allows 64 characters." };
  return { owner: o, ledgerId, relayerId };
}

/** A random code made of letters and digits, from the browser's secure random source. */
export function randomCode(length: number, rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes, so it can be read out loud
  const bytes = rand(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export interface SetupValues {
  contractId: string;
  relayerId: string;
  relayerKey: string;
  accessCode: string;
  apiKey: string;
}

/** The block the owner pastes into Vercel's environment variables. Vercel splits a pasted .env block into rows. */
export function envBlock(v: SetupValues): string {
  return [
    `NEAR_NETWORK=testnet`,
    `NEAR_CONTRACT_ID=${v.contractId}`,
    `NEAR_ACCOUNT_ID=${v.relayerId}`,
    `NEAR_PRIVATE_KEY=${v.relayerKey}`,
    `RECORD_ACCESS_CODE=${v.accessCode}`,
    `UPRALI_API_KEYS=${v.apiKey}`,
  ].join("\n");
}

/** yoctoNEAR string to a NEAR number, good enough to compare against NEEDED_NEAR. */
export function yoctoToNear(yocto: string | bigint): number {
  const s = BigInt(yocto).toString().padStart(25, "0");
  return Number(`${s.slice(0, -24)}.${s.slice(-24, -18)}`);
}
