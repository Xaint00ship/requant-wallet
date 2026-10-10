use requant_consensus::{
    params::Network,
    tx::{Delayed, Htlc, HtlcRevocable, Input, OutPoint, Output, Tx, Unlock},
};
use requant_wallet_core::{network::Node, transfer::Coin};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn fixture(replies: Vec<(&'static str, Value)>) -> (Node, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let node = Node::new(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let worker = thread::spawn(move || {
        for (method, result) in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut header = Vec::new();
            let mut byte = [0u8; 1];
            while !header.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                header.push(byte[0]);
            }
            let length = String::from_utf8(header)
                .unwrap()
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length: ")
                        .map(|s| s.parse::<usize>().unwrap())
                })
                .unwrap();
            let mut body = vec![0; length];
            stream.read_exact(&mut body).unwrap();
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap()["method"],
                method
            );
            let body = json!({"result":result,"error":null}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    (node, worker)
}
#[tokio::test]
async fn rejects_a_node_with_the_wrong_genesis_even_when_named_testnet() {
    let (node, worker) = fixture(vec![
        (
            "getinfo",
            json!({"network":"test","height":10,"tip":"01".repeat(32),"peers":2}),
        ),
        ("getblock", json!({"id":"02".repeat(32)})),
    ]);
    assert!(node.info().await.err().unwrap().contains("genesis"));
    worker.join().unwrap();
}
#[tokio::test]
async fn verifies_source_transaction_hash_value_and_owner_before_signing() {
    let owner = [7; 32];
    let tx = Tx::Coinbase {
        height: 1,
        extra: vec![],
        outputs: vec![Output {
            value: 1 << 63,
            pkh: owner,
        }],
    };
    let coin = Coin {
        txid: hex::encode(tx.txid()),
        vout: 0,
        value: 1 << 63,
        confirmed: true,
        spendable: true,
        coinbase: true,
        height: Some(1),
    };
    let reply = json!({"hex":hex::encode(tx.encode())});
    let (node, worker) = fixture(vec![
        ("gettx", reply.clone()),
        ("gettx", reply.clone()),
        ("gettx", reply.clone()),
        ("gettx", reply),
    ]);
    node.verify_outputs(std::slice::from_ref(&coin), &hex::encode(owner))
        .await
        .unwrap();
    let mut wrong = coin.clone();
    wrong.value -= 1;
    assert!(node
        .verify_outputs(&[wrong], &hex::encode(owner))
        .await
        .is_err());
    assert!(node
        .verify_outputs(std::slice::from_ref(&coin), &hex::encode([8; 32]))
        .await
        .is_err());
    let mut wrong = coin;
    wrong.txid = "03".repeat(32);
    assert!(node
        .verify_outputs(&[wrong], &hex::encode(owner))
        .await
        .is_err());
    worker.join().unwrap();
}
/// Coins created by kind-2 transfers (spending conditions and time locks, Requant node 0.15.0) must
/// still verify: the source-transaction check decodes them with the pinned consensus.
#[tokio::test]
async fn verifies_coins_whose_source_spent_a_condition_or_time_lock() {
    let owner = [7; 32];
    let htlc = Htlc {
        hash: [1; 32],
        claim: [2; 32],
        refund: [3; 32],
        timeout: 1500,
    };
    let source = Tx::Transfer {
        inputs: vec![
            Input {
                after_height: 1500,
                unlock: Unlock::HtlcRefund { htlc },
                ..Input::new(OutPoint {
                    txid: [9; 32],
                    vout: 0,
                })
            },
            Input {
                after_blocks: 10,
                ..Input::new(OutPoint {
                    txid: [9; 32],
                    vout: 1,
                })
            },
        ],
        outputs: vec![Output {
            value: 123_456_789,
            pkh: owner,
        }],
    };
    assert!(source.is_v2());
    assert_eq!(source.encode()[4], 2, "a kind-2 transfer");
    let coin = Coin {
        txid: hex::encode(source.txid()),
        vout: 0,
        value: 123_456_789,
        confirmed: true,
        spendable: true,
        coinbase: false,
        height: Some(1500),
    };
    let (node, worker) = fixture(vec![("gettx", json!({"hex":hex::encode(source.encode())}))]);
    node.verify_outputs(&[coin], &hex::encode(owner))
        .await
        .unwrap();
    worker.join().unwrap();
}
/// Coins created by transfers that use the templates of Requant node 0.16.0 (revocable outputs, revocable
/// HTLCs, anyone-can-pay) must verify too: the pinned consensus decodes their source.
#[tokio::test]
async fn verifies_coins_whose_source_spent_a_revocable_output_with_anyone_can_pay() {
    let owner = [7; 32];
    let delayed = Delayed {
        owner: [2; 32],
        revoke: [3; 32],
        delay: 144,
    };
    let h = HtlcRevocable {
        hash: [1; 32],
        claim: [2; 32],
        refund: [3; 32],
        revoke: [4; 32],
        timeout: 5000,
        claim_delay: 6,
        refund_delay: 6,
    };
    let source = Tx::Transfer {
        inputs: vec![
            Input {
                after_blocks: 144,
                unlock: Unlock::DelayedOwner { d: delayed },
                anyone_can_pay: true,
                ..Input::new(OutPoint {
                    txid: [9; 32],
                    vout: 0,
                })
            },
            Input {
                after_blocks: 6,
                unlock: Unlock::RevocableClaim {
                    h,
                    preimage: [5; 32],
                },
                ..Input::new(OutPoint {
                    txid: [9; 32],
                    vout: 1,
                })
            },
        ],
        outputs: vec![Output {
            value: 123_456_789,
            pkh: owner,
        }],
    };
    assert!(source.uses_contracts());
    assert_eq!(source.encode()[4], 2, "a kind-2 transfer");
    let coin = Coin {
        txid: hex::encode(source.txid()),
        vout: 0,
        value: 123_456_789,
        confirmed: true,
        spendable: true,
        coinbase: false,
        height: Some(4800),
    };
    let (node, worker) = fixture(vec![("gettx", json!({"hex":hex::encode(source.encode())}))]);
    node.verify_outputs(&[coin], &hex::encode(owner))
        .await
        .unwrap();
    worker.join().unwrap();
}
#[tokio::test]
async fn snapshot_keeps_eight_decimal_precision_and_separates_immature_coins() {
    let net = Network::test();
    let genesis = hex::encode(requant_consensus::block::genesis(&net).id(&net));
    let info = json!({"network":"test","height":200,"tip":"01".repeat(32),"peers":2});
    let coins = json!([
        {"txid":"01".repeat(32),"vout":0,"value":9007199254740993u64,"height":1,"coinbase":false,"confirmed":true,"spendable":true},
        {"txid":"02".repeat(32),"vout":0,"value":9,"height":null,"coinbase":false,"confirmed":false,"spendable":true},
        {"txid":"03".repeat(32),"vout":0,"value":100,"height":199,"coinbase":true,"confirmed":true,"spendable":false}
    ]);
    let history = json!([{"txid":"01".repeat(32),"height":1,"confirmations":200,"time":1,"received":9007199254740993u64,"sent":0}]);
    let (node, worker) = fixture(vec![
        ("getinfo", info.clone()),
        ("getblock", json!({"id":genesis})),
        ("utxos", coins),
        ("history", history),
        ("getinfo", info),
        ("getblock", json!({"id":genesis})),
    ]);
    let snap = node.snapshot(&hex::encode([7; 32])).await.unwrap();
    assert_eq!(snap.confirmed, "90071992.54740993");
    assert_eq!(snap.pending, "0.00000009");
    assert_eq!(snap.maturing, "0.00000100");
    assert_eq!(
        serde_json::to_value(snap).unwrap()["events"][0]["received"],
        "9007199254740993"
    );
    worker.join().unwrap();
}
