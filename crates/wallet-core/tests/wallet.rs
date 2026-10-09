use ed25519_dalek::SigningKey;
use requant_consensus::{address::address, params::Network, tx::pkh};
use requant_wallet_core::{
    crypto,
    network::validate_endpoint,
    store::Store,
    transfer::{self, Coin},
};
#[test]
fn encrypted_backup_is_authenticated_and_resource_bounded() {
    let secret = [7; 32];
    let backup = crypto::encrypt(&secret, "test-password-long").unwrap();
    assert_eq!(
        *crypto::decrypt(&backup, "test-password-long", false).unwrap(),
        secret
    );
    assert!(crypto::decrypt(&backup, "incorrect-password", false).is_err());
    assert!(crypto::decrypt(
        &backup.replace(":65536:", ":4294967295:"),
        "test-password-long",
        false
    )
    .is_err());
    let mut corrupt = backup.clone();
    corrupt.pop();
    corrupt.push('x');
    assert!(crypto::decrypt(&corrupt, "test-password-long", false).is_err());
    assert!(crypto::decrypt(&hex::encode(secret), "test-password-long", false).is_err());
    assert_eq!(
        *crypto::decrypt(&hex::encode(secret), "test-password-long", true).unwrap(),
        secret
    );
}
#[test]
fn local_storage_persists_only_encrypted_key_and_password_changes_require_new_backup() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path().to_owned()).unwrap();
    let wallet = store.create("Test wallet", "test-password-long").unwrap();
    let backup = store.backup(&wallet.id, "test-password-long").unwrap();
    store.lock_all();
    store
        .confirm_backup(&wallet.id, "test-password-long")
        .unwrap();
    assert!(store.list()[0].backed_up);
    store.lock_all();
    assert!(!store.authorized(&wallet.id));
    assert!(store.unlock(&wallet.id, "wrong").is_err());
    store.unlock(&wallet.id, "test-password-long").unwrap();
    store
        .change_password(&wallet.id, "test-password-long", "new-test-password-long")
        .unwrap();
    assert!(!store.list()[0].backed_up);
    assert!(!store.authorized(&wallet.id));
    drop(store);
    let mut restored = Store::open(directory.path().to_owned()).unwrap();
    assert!(restored.unlock(&wallet.id, "test-password-long").is_err());
    restored
        .unlock(&wallet.id, "new-test-password-long")
        .unwrap();
    assert_eq!(restored.list()[0].address, wallet.address);
    let raw = std::fs::read_to_string(directory.path().join("wallets.json")).unwrap();
    assert!(!raw.contains("new-test-password-long"));
    assert!(!raw.contains("test-password-long"));
    let other = tempfile::tempdir().unwrap();
    let mut imported = Store::open(other.path().to_owned()).unwrap();
    assert_eq!(
        imported
            .import("Restored", &backup, "test-password-long", false)
            .unwrap()
            .address,
        wallet.address
    );
}
#[test]
fn amounts_never_use_float_or_wrap() {
    assert_eq!(
        transfer::parse_amount("92233720368.54775808").unwrap(),
        1 << 63
    );
    assert_eq!(transfer::amount(1 << 63), "92233720368.54775808");
    for value in ["-1", "1e8", "0.000000001", "92233720368.54775809", " 1"] {
        assert!(transfer::parse_amount(value).is_err());
    }
}
fn coin(value: u64, confirmed: bool, spendable: bool) -> Coin {
    Coin {
        txid: "01".repeat(32),
        vout: 0,
        value,
        confirmed,
        spendable,
        coinbase: false,
        height: Some(1),
    }
}
#[test]
fn signing_matches_consensus_and_excludes_immature_or_unapproved_pending_coins() {
    let coins = vec![coin(1000000000, true, true)];
    let recipient = address(
        &Network::test(),
        &pkh(&SigningKey::from_bytes(&[9; 32]).verifying_key().to_bytes()),
    );
    let tx = transfer::sign(&[7; 32], &coins, &recipient, 100000000, 1000).unwrap();
    tx.check_standalone(&Network::test().chain_id).unwrap();
    assert!(tx.check_standalone(&Network::regtest().chain_id).is_err());
    assert_eq!(tx.outputs().iter().map(|o| o.value).sum::<u64>(), 999999000);
    assert!(transfer::select(&[coin(1000000000, true, false)], 100, 1, false).is_err());
    assert!(transfer::select(&[coin(1000000000, false, true)], 100, 1, false).is_err());
    assert!(transfer::select(&[coins[0].clone(), coins[0].clone()], 100, 1, false).is_err());
    assert!(transfer::sign(&[7; 32], &coins, &recipient.replace("trq", "rq"), 100, 1).is_err());
}
#[test]
fn network_endpoint_requires_tls_and_has_no_embedded_credentials() {
    assert!(validate_endpoint("https://requant.network/wallet-api/v1/rpc").is_ok());
    assert!(validate_endpoint("http://127.0.0.1:19334").is_ok());
    for url in [
        "http://public-node.example",
        "https://user:password@requant.network",
        "https://requant.network?secret=abc",
        "file:///tmp/wallet",
    ] {
        assert!(validate_endpoint(url).is_err());
    }
}
