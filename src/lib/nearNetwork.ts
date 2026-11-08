/**
 * Which NEAR network an account lives on. People sign in with either a mainnet account
 * (name.near) or a testnet one (name.testnet). The decision ledger itself stays on testnet:
 * testnet accounts record with their own wallet, and mainnet accounts, which can't sign on
 * testnet, have the server's relayer record the fingerprint of a decision signed in their name.
 * Safe to import in the browser and on the server.
 */

export type WalletNetwork = "testnet" | "mainnet";

export const WALLET_NETWORKS: WalletNetwork[] = ["mainnet", "testnet"];

export const DEFAULT_RPC: Record<WalletNetwork, string> = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://rpc.mainnet.fastnear.com",
};

export function isWalletNetwork(x: unknown): x is WalletNetwork {
  return x === "testnet" || x === "mainnet";
}

/** The network a named account belongs to, or null for implicit accounts (hex or 0x…), which exist on both. */
export function accountNetwork(accountId: string | null | undefined): WalletNetwork | null {
  const a = (accountId ?? "").trim().toLowerCase();
  if (a.endsWith(".testnet")) return "testnet";
  if (a.endsWith(".near")) return "mainnet";
  return null;
}

/**
 * The network to check a sign-in against: the one the account's name says, else the one the
 * wallet was on. Returns an error message when the two disagree.
 */
export function signInNetwork(accountId: string, claimed: unknown): WalletNetwork | { error: string } {
  const named = accountNetwork(accountId);
  const wallet = isWalletNetwork(claimed) ? claimed : null;
  if (named && wallet && named !== wallet) {
    return { error: `${accountId} is a ${named} account, but the wallet was on ${wallet}. Switch the network and sign in again.` };
  }
  return named ?? wallet ?? "testnet";
}

export function rpcUrlFor(network: WalletNetwork, env: Record<string, string | undefined>): string {
  if (network === "mainnet") return env.NEAR_MAINNET_RPC_URL?.trim() || DEFAULT_RPC.mainnet;
  return env.NEAR_RPC_URL?.trim() || DEFAULT_RPC.testnet;
}

export function explorerAccountUrl(accountId: string, network: WalletNetwork = accountNetwork(accountId) ?? "testnet"): string {
  return `${network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/address/${accountId}`;
}

export const networkLabel = (n: WalletNetwork) => (n === "mainnet" ? "NEAR mainnet (.near)" : "NEAR testnet (.testnet)");
