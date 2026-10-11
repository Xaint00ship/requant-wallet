//! Unfunded synthetic chains only. No network calls, wallet funds or production secrets.
use ed25519_dalek::SigningKey;
use requant_browser_core::execute;
use requant_consensus::{
    address::{address, parse_address},
    params::Network,
    tx::{multi2_owner, pkh, Input, OutPoint, Output, Tx},
};
use requant_wallet_portable::{
    btc,
    channel::Channel,
    hd, swap, tron,
    wallet::{Unsigned, WalletFile},
};
use serde_json::{json, Value};
const PASS: &str = "unfunded-protocol-test-password";
fn call(op: &str, v: Value) -> Value {
    serde_json::from_str(&execute(op, &v.to_string()).unwrap()).unwrap()
}
fn refuse(op: &str, v: Value) {
    assert!(
        execute(op, &v.to_string()).is_err(),
        "{op} accepted forged data"
    );
}
fn wallet(n: u8) -> (String, SigningKey) {
    let w = WalletFile::new(&Network::test(), &[n; 32], Some(PASS), &[1; 16], &[2; 24]).unwrap();
    let key = w
        .keyring(&hd::seed_of(&[n; 32], ""))
        .remove(&w.receive[0])
        .unwrap();
    (w.to_text(), key)
}
fn envelope(v: Value) -> String {
    json!({"result":v,"error":null}).to_string()
}
fn info() -> Value {
    json!({"rqt_network":"test","btc_network":"signet","btc_pubkey":btc::public_key(&[2;32]).unwrap().to_string(),"sats_per_rqt":1000,"min_rqt":1,"max_rqt":10_000_000_000u64,"lightning":true,"usdt":{"network":"nile","htlc":tron::DEPLOYMENTS[0].htlc,"token":tron::DEPLOYMENTS[0].usdt,"receiver":tron::to_base58(&tron::address_of(&[2;32]).unwrap()),"units_per_rqt":100000,"pays_fees":true}})
}
fn draft(kind: &str, file: &str) -> Value {
    call(
        "swapDraft",
        json!({"file":file,"kind":kind,"amount":"1","password":PASS,"info":envelope(info())}),
    )
}
fn btc_offer(d: &Value) -> Value {
    let req: Value = serde_json::from_str(d["request"].as_str().unwrap()).unwrap();
    let hash: [u8; 32] = hex::decode(req["params"][1].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let h = btc::Htlc {
        hash,
        claim: btc::public_key(&[2; 32]).unwrap(),
        refund: req["params"][2].as_str().unwrap().parse().unwrap(),
        timeout: 1144,
    };
    json!({"id":hex::encode([5;32]),"btc_sats":1000,"btc_address":h.address(bitcoin::Network::Signet).to_string(),"btc_htlc":swap::btc_htlc_json(&h,bitcoin::Network::Signet),"created_btc_height":1000})
}
#[test]
fn encrypted_swaps_check_offer_and_refuse_tampered_backups() {
    let (f, _) = wallet(1);
    let d = draft("btc", &f);
    let offer = btc_offer(&d);
    let saved = call(
        "swapOffer",
        json!({"record":d["record"],"password":PASS,"offer":envelope(offer.clone()),"now":"10000"}),
    );
    assert!(saved["details"].get("secret").is_none());
    assert!(saved["details"].get("btc_refund_key").is_none());
    assert!(!saved["record"].as_str().unwrap().contains("btc_refund_key"));
    let public = call(
        "swapInspect",
        json!({"record":saved["record"],"password":PASS}),
    );
    assert_eq!(public["btc_sats"], "1000");
    refuse(
        "swapInspect",
        json!({"record":saved["record"],"password":"wrong-test-only-password"}),
    );
    refuse(
        "protocolStore",
        json!({"data":json!({"swaps":[{"id":"fixture","walletId":"fixture","record":saved["record"],"details":{"password":"must-not-persist"}}],"channels":[]}).to_string()}),
    );
    let mut corrupt: Value = serde_json::from_str(saved["record"].as_str().unwrap()).unwrap();
    let mut bytes = hex::decode(corrupt["payload"].as_str().unwrap()).unwrap();
    bytes[0] ^= 1;
    corrupt["payload"] = json!(hex::encode(bytes));
    refuse(
        "swapInspect",
        json!({"record":corrupt.to_string(),"password":PASS}),
    );
    let mut forged = offer;
    forged["btc_htlc"]["address"] = json!("forged");
    refuse(
        "swapOffer",
        json!({"record":d["record"],"password":PASS,"offer":envelope(forged),"now":"10000"}),
    );
    let req: Value = serde_json::from_str(d["request"].as_str().unwrap()).unwrap();
    let claim = parse_address(&Network::test(), req["params"][3].as_str().unwrap()).unwrap();
    let h = requant_consensus::tx::Htlc {
        hash: hex::decode(req["params"][1].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap(),
        claim,
        refund: [9; 32],
        timeout: 6000,
    };
    let parent = Tx::Coinbase {
        height: 5000,
        extra: vec![],
        outputs: vec![Output {
            value: 100_000_000,
            pkh: h.owner(),
        }],
    };
    let st = envelope(
        json!({"state":"rqt_locked","rqt_htlc":swap::rqt_htlc_json(&h),"rqt_lock_txid":hex::encode(parent.txid())}),
    );
    let args = json!({"record":saved["record"],"password":PASS,"status":st,"height":"5100","rate":"5","coins":[{"owner":hex::encode(h.owner()),"raw":envelope(json!([{"txid":hex::encode(parent.txid()),"vout":0,"value":100000000,"spendable":true,"confirmed":true}]))}],"parents":{hex::encode(parent.txid()):envelope(json!({"hex":hex::encode(parent.encode())}))}});
    let payment = call("swapClaimPrepare", args.clone());
    let signed = call(
        "contractSign",
        json!({"file":f,"password":PASS,"payment":payment["payment"]}),
    );
    Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap())
        .unwrap()
        .check_standalone(&Network::test().chain_id)
        .unwrap();
    let mut late = args.clone();
    late["height"] = json!("5994");
    refuse("swapClaimPrepare", late);
    let mut wrong = args;
    wrong["coins"][0]["raw"] = json!(envelope(
        json!([{"txid":hex::encode(parent.txid()),"vout":0,"value":99999999,"spendable":true,"confirmed":true}])
    ));
    refuse("swapClaimPrepare", wrong);
    if let Ok(path) = std::env::var("REQUANT_PROTOCOL_FIXTURE_DIR") {
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            std::path::Path::new(&path).join("btc-swap.json"),
            saved["record"].as_str().unwrap(),
        )
        .unwrap();
        std::fs::write(std::path::Path::new(&path).join("wallet.json"), &f).unwrap();
    }
    let mut mainnet = info();
    mainnet["btc_network"] = json!("bitcoin");
    refuse(
        "swapDraft",
        json!({"file":f,"kind":"btc","amount":"1","password":PASS,"info":envelope(mainnet)}),
    );
}
// Synthetic checksum-valid invoices exercise our binding checks; invoice-signature
// verification stays with the paying Lightning wallet, as in the upstream CLI.
fn invoice(hash: &[u8], hrp: &str, timestamp: u64) -> String {
    let mut data: Vec<u8> = (0..7)
        .rev()
        .map(|i| ((timestamp >> (5 * i)) & 31) as u8)
        .collect();
    data.extend([1, 1, 20]);
    for i in 0..52 {
        let mut n = 0;
        for b in 0..5 {
            let bit = i * 5 + b;
            n = (n << 1)
                | if bit < 256 {
                    (hash[bit / 8] >> (7 - bit % 8)) & 1
                } else {
                    0
                };
        }
        data.push(n);
    }
    data.extend([6, 0, 2, 18, 24]); // expiry: 600 seconds
    data.extend([0; 104]);
    let mut check: Vec<u8> = hrp.bytes().map(|b| b >> 5).collect();
    check.push(0);
    check.extend(hrp.bytes().map(|b| b & 31));
    check.extend(&data);
    check.extend([0; 6]);
    let mut c = 1u32;
    let g = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    for v in check {
        let top = c >> 25;
        c = (c & 0x1ffffff) << 5 ^ v as u32;
        for (i, x) in g.iter().enumerate() {
            if top >> i & 1 == 1 {
                c ^= x;
            }
        }
    }
    c ^= 1;
    data.extend((0..6).rev().map(|i| ((c >> (5 * i)) & 31) as u8));
    let chars = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    format!(
        "{hrp}1{}",
        data.iter()
            .map(|v| chars[*v as usize] as char)
            .collect::<String>()
    )
}
#[test]
fn lightning_offer_binds_hash_amount_network_and_expiry() {
    let (f, _) = wallet(5);
    let d = draft("ln", &f);
    let req: Value = serde_json::from_str(d["request"].as_str().unwrap()).unwrap();
    let h = hex::decode(req["params"][1].as_str().unwrap()).unwrap();
    let offer = |h: &[u8], hrp: &str, time: u64| {
        envelope(json!({"id":hex::encode([7;32]),"btc_sats":1000,"bolt11":invoice(h,hrp,time)}))
    };
    let args = json!({"record":d["record"],"password":PASS,"offer":offer(&h,"lntbs10u",100000),"now":"100000"});
    let accepted = call("swapOffer", args.clone());
    assert_eq!(accepted["details"]["funding_deadline"], "100600");
    for wrong in [
        offer(&[0; 32], "lntbs10u", 100000),
        offer(&h, "lnbc10u", 100000),
        offer(&h, "lntbs20u", 100000),
        offer(&h, "lntbs10u", 99000),
    ] {
        let mut a = args.clone();
        a["offer"] = json!(wrong);
        refuse("swapOffer", a);
    }
}
#[test]
fn usdt_uses_known_contract_local_signing_and_refund_deadlines() {
    let (f, _) = wallet(3);
    let d = draft("usdt", &f);
    let req: Value = serde_json::from_str(d["request"].as_str().unwrap()).unwrap();
    let i = info();
    let t = tron::Terms {
        token: tron::parse(tron::DEPLOYMENTS[0].usdt).unwrap(),
        sender: tron::parse(req["params"][2].as_str().unwrap()).unwrap(),
        receiver: tron::parse(i["usdt"]["receiver"].as_str().unwrap()).unwrap(),
        amount: 100000,
        hash: hex::decode(req["params"][1].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap(),
        timeout: 143200,
    };
    let offer = json!({"id":hex::encode([6;32]),"htlc":tron::DEPLOYMENTS[0].htlc,"terms":t.json(),"funding_deadline":107200});
    let saved = call(
        "swapOffer",
        json!({"record":d["record"],"password":PASS,"offer":envelope(offer.clone()),"now":"100000"}),
    );
    assert_eq!(saved["details"]["terms"]["sender"], req["params"][2]);
    let block=json!({"blockID":hex::encode([7;32]),"block_header":{"raw_data":{"number":1234,"timestamp":100000000}}}).to_string();
    let args = json!({"record":saved["record"],"password":PASS,"action":"lock","balance":"100000","state":"0","approved":true,"block":block,"now":"100000"});
    let signed = call("swapTronSign", args.clone());
    assert_eq!(signed["review"]["maxFee"], "60 TRX");
    assert!(!signed["hex"].as_str().unwrap().is_empty());
    let mut early = args.clone();
    early["action"] = json!("refund");
    early["state"] = json!("1");
    refuse("swapTronSign", early);
    let mut late = args;
    late["block"]=json!(json!({"blockID":hex::encode([7;32]),"block_header":{"raw_data":{"number":1234,"timestamp":108000000}}}).to_string());
    late["now"] = json!("108000");
    refuse("swapTronSign", late);
    let mut forged = offer;
    forged["htlc"] = json!("TYfBAJYoXxJnVdnF8Gk3CpNZkPvT6ohg8T");
    refuse(
        "swapOffer",
        json!({"record":d["record"],"password":PASS,"offer":envelope(forged),"now":"100000"}),
    );
    assert_eq!(hex::encode(&t.state_call()[..4]), "fbdc1ef1");
}
#[test]
fn channel_end_to_end_and_monotonic_state_storage() {
    let net = Network::test();
    let (f1, k1) = wallet(1);
    let (f2, k2) = wallet(2);
    let owner = multi2_owner(
        &k1.verifying_key().to_bytes(),
        &k2.verifying_key().to_bytes(),
    );
    let parent = Tx::Coinbase {
        height: 5000,
        extra: vec![],
        outputs: vec![Output {
            value: 200_000_000,
            pkh: pkh(&k1.verifying_key().to_bytes()),
        }],
    };
    let funding = Tx::Transfer {
        inputs: vec![Input::new(OutPoint {
            txid: parent.txid(),
            vout: 0,
        })],
        outputs: vec![Output {
            value: 199_999_000,
            pkh: owner,
        }],
    };
    let u = Unsigned {
        network: "test".into(),
        tx: funding,
        paths: vec![(0, 0)],
        prev: vec![parent.clone()],
        change: vec![],
    };
    let c = call(
        "channelCreate",
        json!({"file":f1,"password":PASS,"unsigned":u.to_text(),"clientAddress":address(&net,&pkh(&k1.verifying_key().to_bytes())),"server":hex::encode(k2.verifying_key().to_bytes()),"serverAddress":address(&net,&pkh(&k2.verifying_key().to_bytes())),"expiry":"6000","height":"5100"}),
    );
    let parents =
        json!({hex::encode(parent.txid()):envelope(json!({"hex":hex::encode(parent.encode())}))});
    refuse(
        "channelFund",
        json!({"channel":c["channel"],"file":f1,"password":PASS,"parents":parents,"height":"5100"}),
    );
    let accepted = call(
        "channelAccept",
        json!({"channel":c["channel"],"file":f2,"password":PASS,"height":"5100"}),
    );
    let funded = call(
        "channelFund",
        json!({"channel":accepted["channel"],"file":f1,"password":PASS,"parents":parents,"height":"5100"}),
    );
    let funding = Tx::decode_exact(&hex::decode(funded["hex"].as_str().unwrap()).unwrap()).unwrap();
    funding.check_standalone(&net.chain_id).unwrap();
    let paid = call(
        "channelPay",
        json!({"channel":accepted["channel"],"file":f1,"password":PASS,"amount":"0.25","height":"5101"}),
    );
    refuse(
        "channelPay",
        json!({"channel":paid["channel"],"file":f1,"password":PASS,"amount":"0.1","height":"5101"}),
    );
    let received = call(
        "channelReceive",
        json!({"channel":accepted["channel"],"state":paid["state"]}),
    );
    assert_eq!(received["details"]["paidAmount"], "0.25000000");
    let closed = call(
        "channelClose",
        json!({"channel":received["channel"],"state":received["state"],"file":f2,"password":PASS,"height":"5101"}),
    );
    assert_eq!(closed["review"]["outputs"][0]["amount"], "0.25000000");
    assert_eq!(closed["review"]["outputs"][1]["amount"], "1.74998000");
    assert_eq!(closed["review"]["fee"], "0.00001000");
    Tx::decode_exact(&hex::decode(closed["hex"].as_str().unwrap()).unwrap())
        .unwrap()
        .check_standalone(&net.chain_id)
        .unwrap();
    refuse(
        "channelRefund",
        json!({"channel":accepted["channel"],"height":"5998"}),
    );
    call(
        "channelRefund",
        json!({"channel":accepted["channel"],"height":"5999"}),
    );
    let saved = json!({"swaps":[],"channels":[{"id":accepted["details"]["funding_txid"],"walletId":"fixture","channel":paid["channel"],"state":paid["state"]}]});
    call("protocolStore", json!({"data":saved.to_string()}));
    let mut rollback = saved.clone();
    rollback["channels"][0]["channel"] = accepted["channel"].clone();
    rollback["channels"][0]
        .as_object_mut()
        .unwrap()
        .remove("state");
    refuse(
        "protocolStore",
        json!({"data":rollback.to_string(),"previous":saved.to_string()}),
    );
    let parsed: Value = serde_json::from_str(accepted["channel"].as_str().unwrap()).unwrap();
    Channel::from_json(&net, &parsed).unwrap();
}
#[test]
fn package_verifies_parents_order_owner_values_and_duplicate_spends() {
    let net = Network::test();
    let k = SigningKey::from_bytes(&[8; 32]);
    let owner = pkh(&k.verifying_key().to_bytes());
    let parent = Tx::Coinbase {
        height: 1,
        extra: vec![],
        outputs: vec![Output {
            value: 1_000_000,
            pkh: owner,
        }],
    };
    let mut a = Tx::Transfer {
        inputs: vec![Input::new(OutPoint {
            txid: parent.txid(),
            vout: 0,
        })],
        outputs: vec![Output {
            value: 999_999,
            pkh: owner,
        }],
    };
    a.sign(&net.chain_id, &[&k]);
    let mut b = Tx::Transfer {
        inputs: vec![Input::new(OutPoint {
            txid: a.txid(),
            vout: 0,
        })],
        outputs: vec![Output {
            value: 990_000,
            pkh: owner,
        }],
    };
    b.sign(&net.chain_id, &[&k]);
    let hexes = json!([hex::encode(a.encode()), hex::encode(b.encode())]).to_string();
    let parents =
        json!({hex::encode(parent.txid()):envelope(json!({"hex":hex::encode(parent.encode())}))});
    let p = call("packageInspect", json!({"package":hexes,"parents":parents}));
    assert_eq!(p["fee"], "0.00010000");
    assert_eq!(p["external"].as_array().unwrap().len(), 1);
    refuse(
        "packageInspect",
        json!({"package":json!([hex::encode(b.encode()),hex::encode(a.encode())]).to_string(),"parents":parents}),
    );
    refuse(
        "packageInspect",
        json!({"package":json!([hex::encode(a.encode()),hex::encode(a.encode())]).to_string(),"parents":parents}),
    );
    let _ = parse_address(&net, &address(&net, &owner)).unwrap();
}
