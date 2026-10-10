use requant_browser_core::execute;
use requant_consensus::{
    params::Network,
    tx::{Output, Tx},
};
use requant_wallet_portable::{hd, wallet::WalletFile};
use serde_json::{json, Value};
const PASS: &str = "test-only-unfunded-wallet-password";
fn call(op: &str, v: Value) -> Value {
    serde_json::from_str(&execute(op, &v.to_string()).unwrap()).unwrap()
}
fn fixture() -> (String, Value) {
    let w = WalletFile::new(&Network::test(), &[0; 32], Some(PASS), &[1; 16], &[2; 24]).unwrap();
    let owner = w.receive[0];
    let parent = Tx::Coinbase {
        height: 1,
        extra: vec![],
        outputs: vec![Output {
            value: 200_000_000,
            pkh: owner,
        }],
    };
    let to = requant_consensus::address::address(&Network::test(), &[7; 32]);
    let req = json!({"file":w.to_text(),"coins":[{"owner":hex::encode(owner),"raw":json!({"error":null,"result":[{"txid":hex::encode(parent.txid()),"vout":0,"value":200_000_000,"confirmed":true,"spendable":true}]}).to_string()}],"parents":{hex::encode(parent.txid()):json!({"error":null,"result":{"hex":hex::encode(parent.encode())}}).to_string()},"payments":[{"address":to,"amount":"1.00000000"},{"address":requant_consensus::address::address(&Network::test(),&[8;32]),"amount":"0.25000000"}],"rate":8});
    (w.to_text(), req)
}
#[test]
fn recovery_matches_upstream_and_keeps_encrypted_format() {
    let entropy = [0; 32];
    let phrase = hd::phrase_of(&entropy);
    let v = call(
        "restorePhrase",
        json!({"phrase":phrase.to_string(),"password":PASS}),
    );
    let reference = WalletFile::new(&Network::test(), &entropy, None, &[0; 16], &[0; 24]).unwrap();
    assert_eq!(
        v["meta"]["address"],
        requant_consensus::address::address(&Network::test(), &reference.receive[0])
    );
    assert!(v["file"]
        .as_str()
        .unwrap()
        .contains("requant-seed:1:argon2id"));
    assert!(!v["file"].as_str().unwrap().contains(phrase.as_str()));
    assert!(execute(
        "import",
        &json!({"file":v["file"],"password":"wrong"}).to_string()
    )
    .is_err());
}
#[test]
fn multi_recipient_payment_signs_and_rejects_tampering() {
    let (file, req) = fixture();
    let plan = call("plan", req.clone());
    assert_eq!(plan["review"]["fee"], "0.00002104");
    assert_eq!(plan["review"]["total"], "1.25002104");
    assert_eq!(plan["review"]["change"], "0.74997896");
    let signed = call(
        "sign",
        json!({"file":file,"unsigned":plan["unsigned"],"password":PASS}),
    );
    let tx = Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap()).unwrap();
    tx.check_standalone(&Network::test().chain_id).unwrap();
    assert_eq!(tx.outputs().len(), 3);
    let mut changed = req;
    let raw = &mut changed["coins"][0]["raw"];
    *raw = json!(raw.as_str().unwrap().replace("200000000", "200000001"));
    assert!(execute("plan", &changed.to_string()).is_err());
    let mut unsigned: Value = serde_json::from_str(plan["unsigned"].as_str().unwrap()).unwrap();
    unsigned["change"][0][2] = json!(1);
    assert!(execute(
        "sign",
        &json!({"file":file,"unsigned":unsigned.to_string(),"password":PASS}).to_string()
    )
    .is_err());
}
#[test]
fn watch_only_can_prepare_but_cannot_sign() {
    let (file, mut req) = fixture();
    let watch = call("watch", json!({"file":file}));
    req["file"] = watch["file"].clone();
    let plan = call("plan", req);
    assert!(execute(
        "sign",
        &json!({"file":watch["file"],"unsigned":plan["unsigned"],"password":PASS}).to_string()
    )
    .is_err());
}
#[test]
fn scan_extends_gap_and_export_import_roundtrip() {
    let (file, _) = fixture();
    let w = WalletFile::parse(&file).unwrap();
    let scanned = call(
        "scan",
        json!({"file":file,"password":PASS,"used":[hex::encode(w.receive[19])]}),
    );
    let w = WalletFile::parse(scanned["file"].as_str().unwrap()).unwrap();
    assert_eq!(w.receive_issued, 20);
    assert_eq!(w.receive.len(), 40);
    let imported = call("import", json!({"file":scanned["file"],"password":PASS}));
    assert_eq!(imported["meta"]["addresses"].as_array().unwrap().len(), 60);
}
#[test]
fn resource_limits_and_exact_uint64_transport() {
    let r = call(
        "rpc",
        json!({"raw":"{\"result\":{\"value\":9223372036854775808},\"error\":null}"}),
    );
    assert_eq!(r["value"], "9223372036854775808");
    let (file, _) = fixture();
    let v: Value = serde_json::from_str(&file).unwrap();
    let mut v = v;
    v["seed"] = json!(v["seed"]
        .as_str()
        .unwrap()
        .replace(":65536:", ":999999999:"));
    assert!(execute(
        "import",
        &json!({"file":v.to_string(),"password":PASS}).to_string()
    )
    .is_err());
}
#[test]
fn legacy_encrypted_key_can_pay_without_mnemonic() {
    let key = [11u8; 32];
    let encrypted = requant_wallet_portable::encrypt_key(&key, PASS, &[1; 16], &[2; 24]).unwrap();
    let w = call("import", json!({"file":encrypted,"password":PASS}));
    let owner = requant_wallet_portable::owner_of(&ed25519_dalek::SigningKey::from_bytes(&key));
    let parent = Tx::Coinbase {
        height: 1,
        extra: vec![],
        outputs: vec![Output {
            value: 200_000_000,
            pkh: owner,
        }],
    };
    let req = json!({"file":w["file"],"coins":[{"owner":hex::encode(owner),"raw":json!({"error":null,"result":[{"txid":hex::encode(parent.txid()),"vout":0,"value":200_000_000,"confirmed":true,"spendable":true}]}).to_string()}],"parents":{hex::encode(parent.txid()):json!({"error":null,"result":{"hex":hex::encode(parent.encode())}}).to_string()},"payments":[{"address":requant_consensus::address::address(&Network::test(),&[7;32]),"amount":"1.00000000"}],"rate":5});
    let plan = call("plan", req);
    let signed = call(
        "sign",
        json!({"file":w["file"],"unsigned":plan["unsigned"],"password":PASS}),
    );
    Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap())
        .unwrap()
        .check_standalone(&Network::test().chain_id)
        .unwrap();
}

#[test]
fn deposit_counts_restore_exact_paths_and_do_not_reissue_addresses() {
    let phrase = hd::phrase_of(&[0; 32]);
    let restored = call(
        "restorePhrase",
        json!({"phrase":phrase.to_string(),"password":PASS,"count":30}),
    );
    let file = WalletFile::parse(restored["file"].as_str().unwrap()).unwrap();
    assert_eq!(file.receive_issued, 30);
    assert_eq!(file.receive.len(), 50);
    let next = call(
        "nextAddress",
        json!({"file":restored["file"],"password":PASS,"count":3}),
    );
    let changed = WalletFile::parse(next["file"].as_str().unwrap()).unwrap();
    assert_eq!(changed.receive_issued, 33);
    assert_eq!(&changed.receive[..30], &file.receive[..30]);
    for count in [0, 100001] {
        assert!(execute(
            "restorePhrase",
            &json!({"phrase":phrase.to_string(),"password":PASS,"count":count}).to_string()
        )
        .is_err());
    }
}
#[test]
fn plain_legacy_import_encrypts_before_persistence_and_matches_address() {
    let secret = hex::encode([9; 32]);
    let imported = call("importPlain", json!({"file":secret,"password":PASS}));
    let saved = imported["file"].as_str().unwrap();
    assert!(!saved.contains(&secret));
    assert!(saved.contains("requant-key:1:argon2id"));
    let parsed: Value = serde_json::from_str(saved).unwrap();
    let imported_again = call(
        "import",
        json!({"file":parsed["encrypted"],"password":PASS}),
    );
    assert_eq!(imported["meta"], imported_again["meta"]);
}
#[test]
fn batch_string_amounts_keep_exact_integer_coin_values() {
    let (_, mut request) = fixture();
    request["coins"][0]["raw"] = json!(request["coins"][0]["raw"]
        .as_str()
        .unwrap()
        .replace("\"value\":200000000", "\"value\":\"200000000\"")
        .replace("\"vout\":0", "\"vout\":\"0\""));
    let plan = call("plan", request);
    assert_eq!(plan["review"]["total"], "1.25002104");
}

#[test]
fn export_public_unfunded_integration_fixture() {
    let (file, request) = fixture();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("full-test-fixture.json"),
        json!({"file":file,"request":request,"password":PASS}).to_string(),
    )
    .unwrap();
}
