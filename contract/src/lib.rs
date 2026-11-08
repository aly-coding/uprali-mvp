//! Uprali decision ledger.
//!
//! Stores only a SHA-256 fingerprint of each finance decision snapshot, never the
//! numbers themselves. Anyone can read an anchor and check that a decision memo
//! was not changed after it was recorded.
//!
//! Recording is open by default, so a finance lead can sign a decision with their own
//! NEAR wallet and the anchor shows their account as `recorded_by`. The owner can close
//! recording to the owner and an allowlist of writers with `set_open(false)` if the
//! contract's storage ever gets spammed.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

/// What kind of event a fingerprint stands for.
pub const KINDS: [&str; 3] = ["decision", "approval", "outcome_review"];

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    /// Lowercase hex SHA-256 of the canonical snapshot JSON.
    pub hash: String,
    /// One of KINDS.
    pub kind: String,
    /// Uprali case id, e.g. "BC-2026-000014". Not secret: it identifies, it doesn't reveal.
    pub case_id: String,
    /// Case version the fingerprint was taken from.
    pub version: u32,
    /// Account that sent the transaction.
    pub recorded_by: AccountId,
    /// Block timestamp in milliseconds since the Unix epoch.
    pub timestamp_ms: u64,
    pub block_height: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    writers: LookupMap<AccountId, bool>,
    anchors: LookupMap<String, Anchor>,
    count: u64,
    open: bool,
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            writers: LookupMap::new(b"w"),
            anchors: LookupMap::new(b"a"),
            count: 0,
            open: true,
        }
    }

    /// Owner only: open recording to every account, or close it to the owner and writers.
    pub fn set_open(&mut self, open: bool) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can change this");
        self.open = open;
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Owner only: allow another account (for example a team member's own wallet) to record.
    pub fn add_writer(&mut self, account_id: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can add writers");
        self.writers.insert(account_id, true);
    }

    /// Owner only.
    pub fn remove_writer(&mut self, account_id: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can remove writers");
        self.writers.remove(&account_id);
    }

    /// Record a fingerprint. Fails if the same fingerprint was already recorded,
    /// so a record can never be overwritten.
    pub fn record(&mut self, hash: String, kind: String, case_id: String, version: u32) -> Anchor {
        let caller = env::predecessor_account_id();
        require!(
            self.open || caller == self.owner || self.writers.get(&caller).copied().unwrap_or(false),
            "Caller is not allowed to record"
        );
        require!(is_sha256_hex(&hash), "hash must be 64 lowercase hex characters");
        require!(KINDS.contains(&kind.as_str()), "kind must be decision, approval or outcome_review");
        require!(!case_id.is_empty() && case_id.len() <= 64, "case_id must be 1 to 64 characters");
        require!(self.anchors.get(&hash).is_none(), "This fingerprint is already recorded");

        let anchor = Anchor {
            hash: hash.clone(),
            kind,
            case_id,
            version,
            recorded_by: caller,
            timestamp_ms: env::block_timestamp_ms(),
            block_height: env::block_height(),
        };
        self.anchors.insert(hash, anchor.clone());
        self.count += 1;

        // NEP-297 style event so indexers can follow decisions without reading state.
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"uprali_ledger\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{{\"hash\":\"{}\",\"case_id\":\"{}\",\"version\":{}}}]}}",
            anchor.kind, anchor.hash, anchor.case_id.replace('"', ""), anchor.version
        ));
        anchor
    }

    pub fn get(&self, hash: String) -> Option<Anchor> {
        self.anchors.get(&hash).cloned()
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn is_writer(&self, account_id: AccountId) -> bool {
        account_id == self.owner || self.writers.get(&account_id).copied().unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const H: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn ctx(caller: AccountId) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(caller).block_timestamp(1_700_000_000_000_000_000);
        testing_env!(b.build());
    }

    #[test]
    fn owner_records_and_anyone_reads() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        let a = c.record(H.into(), "decision".into(), "BC-1".into(), 3);
        assert_eq!(a.recorded_by, accounts(0));
        assert_eq!(a.timestamp_ms, 1_700_000_000_000);
        ctx(accounts(1));
        assert_eq!(c.get(H.into()), Some(a));
        assert_eq!(c.count(), 1);
    }

    #[test]
    #[should_panic(expected = "already recorded")]
    fn cannot_overwrite() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        c.record(H.into(), "decision".into(), "BC-1".into(), 1);
        c.record(H.into(), "approval".into(), "BC-1".into(), 1);
    }

    #[test]
    fn any_wallet_can_record_while_open() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        assert!(c.is_open());
        ctx(accounts(2));
        let a = c.record(H.into(), "decision".into(), "BC-1".into(), 1);
        assert_eq!(a.recorded_by, accounts(2));
    }

    #[test]
    #[should_panic(expected = "not allowed")]
    fn stranger_cannot_record_once_closed() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        c.set_open(false);
        ctx(accounts(2));
        c.record(H.into(), "decision".into(), "BC-1".into(), 1);
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn only_owner_can_close() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        ctx(accounts(2));
        c.set_open(false);
    }

    #[test]
    fn writer_can_record_after_owner_adds_it() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        c.set_open(false);
        c.add_writer(accounts(1));
        ctx(accounts(1));
        let a = c.record(H.into(), "approval".into(), "BC-1".into(), 2);
        assert_eq!(a.recorded_by, accounts(1));
    }

    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn rejects_bad_hash() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        c.record("NOT-A-HASH".into(), "decision".into(), "BC-1".into(), 1);
    }

    #[test]
    #[should_panic(expected = "kind must be")]
    fn rejects_unknown_kind() {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        c.record(H.into(), "payment".into(), "BC-1".into(), 1);
    }
}
