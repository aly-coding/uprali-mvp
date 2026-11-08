# Sample data (fictional)

Everything here is made up, so you can try Uprali without real company numbers.

- `acme-crm-answers.md`: answers to type or say for the build vs buy case.
- `acme-hire-answers.md`: answers for the new hire case.
- `acme-crm-snapshot.json`: a decision snapshot in the format the app records.

To try the snapshot without the UI, start the app, then run:

```bash
curl -s -X POST localhost:3000/api/ledger/record -H 'content-type: application/json' \
  -d "{\"snapshot\": $(cat samples/acme-crm-snapshot.json)}"
```

You should see a `hash` and `"network":"local-demo"` (or `near-testnet` with a `txHash` once the contract is set up). Then drop the file on the **Verify a decision** page and you should see **Match**.
