use super::*;
use requant_consensus::tx::{Output, Tx};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
};

struct FakeNode {
    endpoint: String,
    changed: Arc<AtomicBool>,
    sends: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    mode: Arc<AtomicUsize>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Drop for FakeNode {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.worker.take().unwrap().join().unwrap();
    }
}
fn fake_node(owner: &str) -> FakeNode {
    let owner: [u8; 32] = hex::decode(owner).unwrap().try_into().unwrap();
    let parent = Tx::Coinbase {
        height: 1,
        extra: vec![],
        outputs: vec![Output {
            value: 2_000_000_000,
            pkh: owner,
        }],
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}/", listener.local_addr().unwrap());
    let changed = Arc::new(AtomicBool::new(false));
    let sends = Arc::new(AtomicUsize::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let mode = Arc::new(AtomicUsize::new(0));
    let behavior = mode.clone();
    let (change, send, finish) = (changed.clone(), sends.clone(), stop.clone());
    let worker = thread::spawn(move || {
        while !finish.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                thread::sleep(Duration::from_millis(5));
                continue;
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut header = Vec::new();
            let mut byte = [0; 1];
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
            let request: Value = serde_json::from_slice(&body).unwrap();
            assert!(!String::from_utf8(body)
                .unwrap()
                .contains("test-native-password-long"));
            let result = match request["method"].as_str().unwrap() {
                "getinfo" => json!({"network":"test","height":200,"tip":"01".repeat(32),"peers":2}),
                "getblock" => {
                    json!({"id":hex::encode(requant_consensus::block::genesis(&Network::test()).id(&Network::test()))})
                }
                "utxos" => {
                    json!([{"txid":hex::encode(parent.txid()),"vout":0,"value":if change.load(Ordering::SeqCst){1_999_999_999u64}else{2_000_000_000},"confirmed":true,"spendable":true,"coinbase":true,"height":1}])
                }
                "gettx" => json!({"hex":hex::encode(parent.encode())}),
                "sendtx" => {
                    let tx = Tx::decode_exact(
                        &hex::decode(request["params"][0].as_str().unwrap()).unwrap(),
                    )
                    .unwrap();
                    tx.check_standalone(&Network::test().chain_id).unwrap();
                    assert_eq!(tx.outputs()[0].value, 100_000_000);
                    assert_eq!(
                        tx.outputs().iter().map(|o| o.value).sum::<u64>(),
                        1_999_999_000
                    );
                    send.fetch_add(1, Ordering::SeqCst);
                    json!(hex::encode(tx.txid()))
                }
                method => panic!("Unexpected wallet request {method}"),
            };
            let method = request["method"].as_str().unwrap();
            let mode = behavior.load(Ordering::SeqCst);
            let unknown = method == "sendtx" && mode == 2;
            let error = if method == "gettx"
                && request["params"][0].as_str() != Some(hex::encode(parent.txid()).as_str())
            {
                Some("not found")
            } else if method == "sendtx" && mode == 1 {
                Some("rejected")
            } else {
                None
            };
            let reply = json!({"result":if error.is_some(){Value::Null}else{result},"error":error})
                .to_string();
            let status = if unknown {
                "503 Service Unavailable"
            } else {
                "200 OK"
            };
            write!(stream,"HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",status,reply.len(),reply).unwrap();
        }
    });
    FakeNode {
        endpoint,
        changed,
        sends,
        stop,
        mode,
        worker: Some(worker),
    }
}
fn state_fixture() -> (
    tempfile::TempDir,
    tauri::App<tauri::test::MockRuntime>,
    WalletInfo,
    FakeNode,
) {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::open(temp.path().to_owned()).unwrap();
    let wallet = store
        .create("Native test", "test-native-password-long")
        .unwrap();
    let node = fake_node(&store.wallet(&wallet.id).unwrap().owner);
    store
        .configure(Settings {
            endpoint: node.endpoint.clone(),
            auto_lock_minutes: 5,
        })
        .unwrap();
    store
        .unlock(&wallet.id, "test-native-password-long")
        .unwrap();
    let app = tauri::test::mock_app();
    app.manage(Mutex::new(Runtime {
        store,
        plans: Default::default(),
    }));
    (temp, app, wallet, node)
}
#[tokio::test]
async fn reviewed_transfer_signs_locally_persists_and_broadcasts_once() {
    let (_temp, app, wallet, node) = state_fixture();
    let state = app.state::<Mutex<Runtime>>();
    let recipient = requant_consensus::address::address(&Network::test(), &[9; 32]);
    let review = prepare_transfer(
        state.clone(),
        wallet.id.clone(),
        recipient.clone(),
        "1.00000000".into(),
        "0.00001000".into(),
        false,
    )
    .await
    .unwrap();
    assert_eq!(review.recipient, recipient);
    assert_eq!(review.total, "1.00001000");
    assert_eq!(review.input_count, 1);
    let sent = confirm_transfer(
        state.clone(),
        review.id.clone(),
        "test-native-password-long".into(),
    )
    .await
    .unwrap();
    assert_eq!(sent.status, "pending");
    assert_eq!(node.sends.load(Ordering::SeqCst), 1);
    let stored = state.lock().unwrap().store.broadcasts(&wallet.id);
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].txid, sent.txid);
    assert_eq!(stored[0].status, "pending");
    assert!(
        confirm_transfer(state, review.id, "test-native-password-long".into())
            .await
            .is_err()
    );
    assert_eq!(node.sends.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn changed_inputs_and_lock_invalidate_review_without_broadcast() {
    let (_temp, app, wallet, node) = state_fixture();
    let state = app.state::<Mutex<Runtime>>();
    let recipient = requant_consensus::address::address(&Network::test(), &[9; 32]);
    let review = prepare_transfer(
        state.clone(),
        wallet.id.clone(),
        recipient,
        "1".into(),
        "0.00001000".into(),
        false,
    )
    .await
    .unwrap();
    node.changed.store(true, Ordering::SeqCst);
    assert!(confirm_transfer(
        state.clone(),
        review.id.clone(),
        "test-native-password-long".into()
    )
    .await
    .err()
    .unwrap()
    .contains("changed"));
    assert_eq!(node.sends.load(Ordering::SeqCst), 0);
    lock_wallet(state.clone()).unwrap();
    assert!(
        confirm_transfer(state, review.id, "test-native-password-long".into())
            .await
            .is_err()
    );
    assert_eq!(node.sends.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rejected_and_unknown_broadcasts_have_durable_distinct_status() {
    for (mode, expected) in [(1, "rejected"), (2, "unknown")] {
        let (temp, app, wallet, node) = state_fixture();
        let state = app.state::<Mutex<Runtime>>();
        let recipient = requant_consensus::address::address(&Network::test(), &[9; 32]);
        let review = prepare_transfer(
            state.clone(),
            wallet.id.clone(),
            recipient,
            "1".into(),
            "0.00001000".into(),
            false,
        )
        .await
        .unwrap();
        node.mode.store(mode, Ordering::SeqCst);
        let sent = confirm_transfer(state, review.id, "test-native-password-long".into())
            .await
            .unwrap();
        assert_eq!(sent.status, expected);
        assert_eq!(node.sends.load(Ordering::SeqCst), 1);
        let persisted = Store::open(temp.path().to_owned()).unwrap();
        let broadcasts = persisted.broadcasts(&wallet.id);
        assert_eq!(broadcasts[0].txid, sent.txid);
        assert_eq!(broadcasts[0].status, expected);
        assert!(!broadcasts[0].hex.is_empty());
    }
}
