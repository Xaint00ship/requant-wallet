use ed25519_dalek::SigningKey;
use requant_browser_core::execute;
use requant_consensus::{
    address::address,
    params::Network,
    tx::{Output, Tx},
};
use requant_wallet_portable::{hd, wallet::WalletFile};
use serde_json::{json, Value};
const PASS: &str = "unfunded-contract-test-password";
fn call(op: &str, v: Value) -> Value {
    serde_json::from_str(&execute(op, &v.to_string()).unwrap()).unwrap()
}
fn wallet(entropy: u8) -> (String, SigningKey) {
    let e = [entropy; 32];
    let w = WalletFile::new(&Network::test(), &e, Some(PASS), &[1; 16], &[2; 24]).unwrap();
    let seed = hd::seed_of(&e, "");
    let k = w.keyring(&seed).remove(&w.receive[0]).unwrap();
    (w.to_text(), k)
}
fn prepare(c: Value, path: &str, preimage: &str, acp: bool) -> Value {
    let result = call("condition", json!({"condition":c}));
    let owner = hex::decode(result["owner"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let parent = Tx::Coinbase {
        height: 1500,
        extra: vec![],
        outputs: vec![Output {
            value: 200_000_000,
            pkh: owner,
        }],
    };
    call(
        "contractPrepare",
        json!({"condition":c,"path":path,"recipient":address(&Network::test(),&[7;32]),"rate":"8","preimage":preimage,"anyoneCanPay":acp,"coins":[{"owner":hex::encode(owner),"raw":json!({"error":null,"result":[{"txid":hex::encode(parent.txid()),"vout":0,"value":200_000_000,"confirmed":true,"spendable":true}]}).to_string()}],"parents":{hex::encode(parent.txid()):json!({"error":null,"result":{"hex":hex::encode(parent.encode())}}).to_string()}}),
    )
}
#[test]
fn two_signers_roundtrip_cli_partial_and_reject_forgery() {
    let (f1, k1) = wallet(1);
    let (f2, k2) = wallet(2);
    let c=call("condition",json!({"words":["multi2",hex::encode(k1.verifying_key().to_bytes()),hex::encode(k2.verifying_key().to_bytes())]}))["condition"].clone();
    let p = prepare(c, "both", "", false);
    let partial = call(
        "contractSign",
        json!({"file":f1,"password":PASS,"payment":p["payment"]}),
    );
    let mut packet: Value = serde_json::from_str(partial["partial"].as_str().unwrap()).unwrap();
    assert_eq!(packet["requant_partial"], 1);
    let signed = call(
        "contractSign",
        json!({"file":f2,"password":PASS,"payment":packet.to_string()}),
    );
    let tx = Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap()).unwrap();
    tx.check_standalone(&Network::test().chain_id).unwrap();
    let parsed = call(
        "signed",
        json!({"hex":signed["hex"],"parents":packet["parents"]}),
    );
    assert_eq!(parsed["review"]["fee"], p["review"]["fee"]);
    assert!(execute(
        "contractSign",
        &json!({"file":f1,"password":PASS,"payment":packet.to_string()}).to_string()
    )
    .is_err());
    let mut tx = tx;
    if let Tx::Transfer { inputs, outputs } = &mut tx {
        inputs[0].unlock = requant_consensus::tx::Unlock::Multi2 {
            pubkey2: k2.verifying_key().to_bytes(),
            sig2: [0; 64],
        };
        outputs[0].value -= 1;
    }
    packet["tx"] = json!(hex::encode(tx.encode()));
    assert!(execute(
        "contractInspect",
        &json!({"payment":packet.to_string()}).to_string()
    )
    .is_err());
}
#[test]
fn every_htlc_and_revocation_path_uses_current_consensus() {
    let (file, key) = wallet(3);
    let who = address(&Network::test(), &requant_wallet_portable::owner_of(&key));
    let secret = [9; 32];
    let h = hex::encode(requant_wallet_portable::contracts::sha256(&secret));
    for words in [
        vec![
            "htlc".to_owned(),
            h.clone(),
            who.clone(),
            who.clone(),
            "5000".into(),
        ],
        vec!["delayed".into(), who.clone(), who.clone(), "144".into()],
        vec![
            "htlc-revocable".into(),
            h.clone(),
            who.clone(),
            who.clone(),
            who.clone(),
            "5000".into(),
            "12".into(),
            "144".into(),
        ],
    ] {
        let c = call("condition", json!({"words":words}));
        for path in c["condition"]["paths"].as_array().unwrap() {
            let p = prepare(
                c["condition"].clone(),
                path.as_str().unwrap(),
                &hex::encode(secret),
                true,
            );
            let signed = call(
                "contractSign",
                json!({"file":file,"password":PASS,"payment":p["payment"]}),
            );
            let tx =
                Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap()).unwrap();
            tx.check_standalone(&Network::test().chain_id).unwrap();
            assert_eq!(signed["review"]["locks"]["activationHeight"], 4700);
            call("contractInspect", json!({"payment":p["payment"]}));
        }
    }
}
#[test]
fn condition_parent_and_path_tampering_fail_before_signing() {
    let (file, key) = wallet(4);
    let who = address(&Network::test(), &requant_wallet_portable::owner_of(&key));
    let c = call("condition", json!({"words":["delayed",who,who,"12"]}))["condition"].clone();
    let p = prepare(c.clone(), "owner", "", false);
    let mut packet: Value = serde_json::from_str(p["payment"].as_str().unwrap()).unwrap();
    packet["path"] = json!("revoke");
    assert!(execute(
        "contractSign",
        &json!({"file":file,"password":PASS,"payment":packet.to_string()}).to_string()
    )
    .is_err());
    let mut packet: Value = serde_json::from_str(p["payment"].as_str().unwrap()).unwrap();
    let id = packet["parents"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    let fake = Tx::Coinbase {
        height: 1500,
        extra: vec![],
        outputs: vec![Output {
            value: 200_000_000,
            pkh: [8; 32],
        }],
    };
    packet["parents"][id] =
        json!(json!({"result":{"hex":hex::encode(fake.encode())},"error":null}).to_string());
    assert!(execute(
        "contractInspect",
        &json!({"payment":packet.to_string()}).to_string()
    )
    .is_err());
    let mut tampered = c;
    tampered["delay"] = json!(13);
    assert!(execute("condition", &json!({"condition":tampered}).to_string()).is_err());
}
#[test]
fn secret_and_public_key_match_cli_and_watch_only_cannot_unlock() {
    let (file, key) = wallet(5);
    let who = address(&Network::test(), &requant_wallet_portable::owner_of(&key));
    let v = call("pubkey", json!({"file":file,"password":PASS,"address":who}));
    assert_eq!(v["pubkey"], hex::encode(key.verifying_key().to_bytes()));
    let s = call("secret", json!({}));
    let bytes = hex::decode(s["secret"].as_str().unwrap()).unwrap();
    assert_eq!(
        s["hash"],
        hex::encode(requant_wallet_portable::contracts::sha256(&bytes))
    );
    let watch = call("watch", json!({"file":file}));
    assert!(execute(
        "pubkey",
        &json!({"file":watch["file"],"password":PASS,"address":who}).to_string()
    )
    .is_err());
    let c = call(
        "condition",
        json!({"words":["htlc",s["hash"],who,who,"5000"]}),
    )["condition"]
        .clone();
    assert!(execute("contractPrepare",&json!({"condition":c,"path":"claim","recipient":who,"rate":5,"preimage":hex::encode([0;32]),"coins":[]}).to_string()).is_err());
}
