use requant_wallet_core::store::Store;
fn main() {
    let directory = std::env::args()
        .nth(1)
        .expect("Provide an isolated .wallet-test directory.");
    let directory = std::path::PathBuf::from(directory);
    assert!(
        directory
            .components()
            .any(|p| p.as_os_str() == ".wallet-test"),
        "Use an isolated .wallet-test directory."
    );
    assert!(
        !directory.join("wallets.json").exists(),
        "Refusing to replace existing wallet data."
    );
    let mut store = Store::open(directory).unwrap();
    store
        .create("Development test wallet", "test-only-no-funds-password")
        .unwrap();
    println!("Isolated development wallet created; never fund this test wallet.");
}
