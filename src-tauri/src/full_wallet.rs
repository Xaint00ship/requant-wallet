use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::State;
use zeroize::Zeroizing;
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct StateFile {
    pub revision: u64,
    pub data: BTreeMap<String, String>,
}
pub struct FullWalletStore {
    pub directory: PathBuf,
    pub disk: StateFile,
}
fn validate(data: &BTreeMap<String, String>) -> Result<()> {
    for key in data.keys() {
        if ![
            "requant.web.v1",
            "requant.web.outbox.v1",
            "requant.settings.v1",
            "requant.protocols.v1",
        ]
        .contains(&key.as_str())
        {
            return Err("Unsupported wallet storage key.".into());
        }
    }
    if let Some(data) = data.get("requant.protocols.v1") {
        requant_browser_core::execute("protocolStore", &json!({"data":data}).to_string())?;
    }
    let list: Value = serde_json::from_str(
        data.get("requant.web.v1")
            .map(String::as_str)
            .unwrap_or("[]"),
    )
    .map_err(|_| "Invalid wallet storage.".to_string())?;
    let rows = list
        .as_array()
        .filter(|a| a.len() <= 20)
        .ok_or("Wallet limit exceeded.")?;
    for row in rows {
        let file = row["file"].as_str().ok_or("Missing encrypted wallet.")?;
        let meta: Value = serde_json::from_str(&requant_browser_core::execute(
            "metadata",
            &json!({"file": file}).to_string(),
        )?)
        .map_err(|_| "Invalid wallet metadata.")?;
        if meta != row["meta"] || row["id"].as_str().is_none() || row["name"].as_str().is_none() {
            return Err("Wallet metadata mismatch.".into());
        }
    }
    Ok(())
}
impl FullWalletStore {
    pub fn open(directory: PathBuf) -> Result<Self> {
        let path = directory.join("full-wallet-state.json");
        let disk = if path.exists() {
            if fs::metadata(&path)
                .map_err(|_| "Cannot read wallet storage.")?
                .len()
                > 64 * 1024 * 1024
            {
                return Err("Wallet storage exceeds the supported size.".into());
            }
            serde_json::from_slice(&fs::read(&path).map_err(|_| "Cannot read wallet storage.")?)
                .map_err(|_| "Wallet storage is unreadable. Restore your encrypted backup.")?
        } else {
            StateFile::default()
        };
        validate(&disk.data)?;
        Ok(Self { directory, disk })
    }
    fn save(&mut self, expected: u64, key: String, value: String) -> Result<u64> {
        if expected != self.disk.revision {
            return Err(
                "Wallet storage changed in another window. Reopen this wallet before continuing."
                    .into(),
            );
        }
        if key == "requant.protocols.v1" {
            requant_browser_core::execute(
                "protocolStore",
                &json!({"data":value,"previous":self.disk.data.get(&key)}).to_string(),
            )?;
        }
        let mut next = self.disk.clone();
        next.data.insert(key, value);
        validate(&next.data)?;
        next.revision += 1;
        let bytes = serde_json::to_vec(&next).map_err(|_| "Cannot encode wallet storage.")?;
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("Wallet storage is full. Export an encrypted backup.".into());
        }
        let temp = self.directory.join("full-wallet-state.tmp");
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temp)
            .map_err(|_| "Cannot save wallet storage.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot save wallet storage.")?;
        fs::rename(&temp, self.directory.join("full-wallet-state.json"))
            .map_err(|_| "Cannot replace wallet storage.")?;
        self.disk = next;
        Ok(self.disk.revision)
    }
}
#[tauri::command]
pub fn full_state_load(
    full: State<'_, Mutex<FullWalletStore>>,
    legacy: super::RuntimeState<'_>,
) -> Result<StateFile> {
    let mut store = full.lock().map_err(|_| "Wallet storage is busy.")?;
    let mut disk = store.disk.clone();
    if !disk.data.contains_key("requant.web.v1") {
        let rt = super::access(&legacy)?;
        let mut rows = Vec::new();
        let mut outbox = Vec::new();
        for old in rt.store.list() {
            let saved = rt.store.wallet(&old.id)?;
            let file = json!({"requant_legacy":1,"network":"test","encrypted":saved.encrypted_key,"owner":saved.owner}).to_string();
            let meta: Value = serde_json::from_str(&requant_browser_core::execute(
                "metadata",
                &json!({"file":file}).to_string(),
            )?)
            .map_err(|_| "Cannot migrate wallet.")?;
            rows.push(json!({"id":old.id,"name":old.name,"file":file,"meta":meta,"backedUp":old.backed_up}));
            for tx in rt.store.broadcasts(&old.id) {
                outbox.push(json!({"walletId":old.id,"txid":tx.txid,"hex":tx.hex,"status":if tx.status=="pending"{"Pending"}else{"Broadcast status unknown"},"created":0}));
            }
        }
        disk.data
            .insert("requant.web.v1".into(), json!(rows).to_string());
        disk.data
            .insert("requant.web.outbox.v1".into(), json!(outbox).to_string());
    }
    if store.disk.data != disk.data {
        // Persist the entire migration before returning; no partially migrated state.
        let bytes = serde_json::to_vec(&disk).map_err(|_| "Cannot migrate wallet storage.")?;
        let path = store.directory.join("full-wallet-migration.tmp");
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(path)
            .map_err(|_| "Cannot persist migrated wallets.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot persist migrated wallets.")?;
        fs::rename(
            store.directory.join("full-wallet-migration.tmp"),
            store.directory.join("full-wallet-state.json"),
        )
        .map_err(|_| "Cannot commit migrated wallets.")?;
        store.disk = disk.clone();
    }
    Ok(disk)
}
#[tauri::command]
pub fn full_state_save(
    full: State<'_, Mutex<FullWalletStore>>,
    revision: u64,
    key: String,
    value: String,
) -> Result<u64> {
    full.lock()
        .map_err(|_| "Wallet storage is busy.")?
        .save(revision, key, value)
}
#[tauri::command]
pub async fn portable_wallet(op: String, input: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let input = Zeroizing::new(input);
        requant_browser_core::execute(&op, &input)
    })
    .await
    .map_err(|_| "Local wallet operation failed.".to_string())?
}
#[tauri::command]
pub async fn full_wallet_rpc(
    state: super::RuntimeState<'_>,
    method: String,
    params: Value,
) -> Result<String> {
    if ![
        "getinfo",
        "getblock",
        "gettx",
        "gettxbatch",
        "utxos",
        "history",
        "estimatefee",
        "sendtx",
        "sendpackage",
    ]
    .contains(&method.as_str())
    {
        return Err("Unsupported wallet network method.".into());
    }
    let endpoint = super::access(&state)?.store.settings().endpoint;
    let node = requant_wallet_core::network::Node::new(&endpoint)?;
    let result = if method == "gettxbatch" {
        let ids = params[0]
            .as_array()
            .filter(|ids| !ids.is_empty() && ids.len() <= 100)
            .ok_or("Invalid transaction batch.")?;
        let mut rows = Vec::new();
        for id in ids {
            let txid = id
                .as_str()
                .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
                .ok_or("Invalid transaction ID.")?;
            let tx = node.rpc("gettx", json!([txid])).await?;
            rows.push(json!({"txid":txid,"raw":json!({"result":tx,"error":null}).to_string()}));
        }
        json!(rows)
    } else {
        node.rpc(&method, params).await?
    };
    Ok(json!({"result":result,"error":null}).to_string())
}
#[tauri::command]
pub fn share_full_address(app: tauri::AppHandle, address: String) -> Result<()> {
    use tauri_plugin_wallet_share::WalletShareExt;
    requant_consensus::address::parse_address(
        &requant_consensus::params::Network::test(),
        &address,
    )
    .map_err(|_| "Invalid testnet address.".to_string())?;
    app.wallet_share().address(&address)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_is_atomic_revision_checked_and_never_accepts_plain_seed() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = FullWalletStore::open(dir.path().into()).unwrap();
        assert_eq!(
            store.save(0, "requant.web.v1".into(), "[]".into()).unwrap(),
            1
        );
        assert!(store.save(0, "requant.web.v1".into(), "[]".into()).is_err());
        assert!(store
            .save(1, "walletPassword".into(), "secret".into())
            .is_err());
        let bad = json!([{"id":"test","name":"test","file":"{\"seed\":\"plaintext\"}","meta":{}}]);
        assert!(store
            .save(1, "requant.web.v1".into(), bad.to_string())
            .is_err());
        assert_eq!(
            FullWalletStore::open(dir.path().into())
                .unwrap()
                .disk
                .revision,
            1
        );
    }
}

#[tauri::command]
pub async fn full_wallet_protocol(method: String, params: Value) -> Result<String> {
    if !(method.starts_with("maker.") || method.starts_with("tron."))
        || !params.is_array()
        || params.to_string().len() > 32768
    {
        return Err("Unsupported protocol request.".into());
    }
    let result =
        requant_wallet_core::network::Node::new("https://requant.network/wallet-api/v1/protocol")?
            .rpc(&method, params)
            .await?;
    Ok(json!({"result":result,"error":null}).to_string())
}
