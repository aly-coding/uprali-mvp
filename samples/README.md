# Sample data (fictional)

Everything here is made up, so you can try Uprali without real company numbers.

- `acme-crm-answers.md`: a question to paste into the decision screen, and the memo to expect.
- `acme-crm-request.json`: the same decision as an API request, with two numbers a person supplied (each with its source and owner).
- `acme-crm-snapshot.json`: the decision snapshot the app fingerprints and records.

With the app running (`npm run dev`), try:

```bash
# Run the decision and record its fingerprint (local demo ledger, or NEAR testnet once configured)
curl -s -X POST localhost:3000/api/v1/build-vs-buy -H 'content-type: application/json' \
  -d @samples/acme-crm-request.json

# Record the sample snapshot, then check it
curl -s -X POST localhost:3000/api/v1/decisions/record -H 'content-type: application/json' \
  -d "{\"snapshot\": $(cat samples/acme-crm-snapshot.json)}"
curl -s -X POST localhost:3000/api/v1/decisions/verify -H 'content-type: application/json' \
  -d "{\"snapshot\": $(cat samples/acme-crm-snapshot.json)}"
```

The last call should say **Match**. Change any number in the snapshot and it says **No match**. If `UPRALI_API_KEYS` is set, add `-H 'authorization: Bearer <your key>'` to the first two calls.
