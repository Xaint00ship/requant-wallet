use requant_consensus::{
    params::Network,
    tx::{Output, Tx},
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
    node.verify_outputs(&[coin.clone()], &hex::encode(owner))
        .await
        .unwrap();
    let mut wrong = coin.clone();
    wrong.value -= 1;
    assert!(node
        .verify_outputs(&[wrong], &hex::encode(owner))
        .await
        .is_err());
    assert!(node
        .verify_outputs(&[coin.clone()], &hex::encode([8; 32]))
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
