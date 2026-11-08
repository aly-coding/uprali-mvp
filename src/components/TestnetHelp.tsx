/**
 * Uprali's ledger is on NEAR testnet. Many judges only have a mainnet account (name.near), which
 * doesn't exist on testnet, so this explains the one-minute way to make a free testnet one.
 */

/** A name ending in .near is a mainnet account; it can't sign anything on testnet. */
export function isMainnetAccount(accountId: string | null | undefined): boolean {
  return !!accountId && /\.near$/i.test(accountId.trim());
}

export function TestnetSteps() {
  return (
    <ol className="plain small">
      <li>Open <a href="https://wallet.near.org" target="_blank" rel="noreferrer">wallet.near.org</a> and pick <strong>Intear Wallet</strong> (Meteor works too).</li>
      <li>Switch the wallet to <strong>testnet</strong> and create a name that ends in <strong>.testnet</strong>. It&apos;s free.</li>
      <li>Save the recovery phrase it shows you.</li>
      <li>Come back here and press <strong>Sign in with NEAR wallet</strong>.</li>
    </ol>
  );
}

export function TestnetHelp({ open = false }: { open?: boolean }) {
  return (
    <details className="testnet-help" open={open}>
      <summary>Only have a .near (mainnet) account? Make a free .testnet one in a minute</summary>
      <p className="small muted">Uprali records on NEAR testnet, so it needs an account whose name ends in .testnet. Nothing here touches mainnet or real money.</p>
      <TestnetSteps />
    </details>
  );
}
