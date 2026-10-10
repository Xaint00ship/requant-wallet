use requant_consensus::{address::parse_address, params::Network};
use requant_wallet_core::{
    crypto::{self, Result},
    network::{Node, Snapshot},
    store::{Broadcast, Settings, Store, WalletInfo},
    transfer::{self, Coin},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, State};
use tauri_plugin_wallet_share::WalletShareExt;
use zeroize::Zeroizing;
#[derive(Clone)]
struct Plan {
    wallet: String,
    recipient: String,
    value: u64,
    fee: u64,
    coins: Vec<Coin>,
    endpoint: String,
    allow_pending: bool,
    created: Instant,
}
struct Runtime {
    store: Store,
    plans: std::collections::HashMap<String, Plan>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Review {
    id: String,
    recipient: String,
    amount: String,
    fee: String,
    total: String,
    input_count: usize,
    expires_in: u64,
}
#[derive(Serialize)]
struct Sent {
    txid: String,
    status: String,
    message: String,
}
type RuntimeState<'a> = State<'a, Mutex<Runtime>>;
fn access<'a>(state: &'a RuntimeState<'_>) -> Result<std::sync::MutexGuard<'a, Runtime>> {
    state
        .lock()
        .map_err(|_| "Wallet state is unavailable.".into())
}
#[tauri::command]
fn list_wallets(state: RuntimeState) -> Result<Vec<WalletInfo>> {
    Ok(access(&state)?.store.list())
}
#[tauri::command]
fn create_wallet(state: RuntimeState, name: String, password: String) -> Result<WalletInfo> {
    access(&state)?
        .store
        .create(&name, &Zeroizing::new(password))
}
#[tauri::command]
fn import_wallet(
    state: RuntimeState,
    name: String,
    backup: String,
    password: String,
    legacy: bool,
) -> Result<WalletInfo> {
    access(&state)?
        .store
        .import(&name, &backup, &Zeroizing::new(password), legacy)
}
#[tauri::command]
fn unlock_wallet(state: RuntimeState, id: String, password: String) -> Result<()> {
    access(&state)?.store.unlock(&id, &Zeroizing::new(password))
}
#[tauri::command]
fn lock_wallet(state: RuntimeState) -> Result<()> {
    let mut rt = access(&state)?;
    rt.store.lock_all();
    rt.plans.clear();
    Ok(())
}
#[tauri::command]
fn touch_wallet(state: RuntimeState, id: String) -> Result<()> {
    access(&state)?.store.touch(&id)
}
#[tauri::command]
fn get_settings(state: RuntimeState) -> Result<Settings> {
    Ok(access(&state)?.store.settings())
}
#[tauri::command]
fn save_settings(state: RuntimeState, settings: Settings) -> Result<()> {
    let mut rt = access(&state)?;
    rt.store.configure(settings)?;
    rt.plans.clear();
    Ok(())
}
#[tauri::command]
fn export_backup(state: RuntimeState, id: String, password: String) -> Result<String> {
    access(&state)?.store.backup(&id, &Zeroizing::new(password))
}
#[tauri::command]
fn confirm_backup(state: RuntimeState, id: String, password: String) -> Result<()> {
    access(&state)?
        .store
        .confirm_backup(&id, &Zeroizing::new(password))
}
#[tauri::command]
fn change_password(
    state: RuntimeState,
    id: String,
    current: String,
    password: String,
) -> Result<()> {
    let mut rt = access(&state)?;
    rt.store
        .change_password(&id, &Zeroizing::new(current), &Zeroizing::new(password))?;
    rt.plans.clear();
    Ok(())
}
#[tauri::command]
async fn wallet_snapshot(state: RuntimeState<'_>, id: String) -> Result<Snapshot> {
    let (owner, endpoint) = {
        let rt = access(&state)?;
        if !rt.store.authorized(&id) {
            return Err("Wallet is locked. Unlock it to continue.".into());
        }
        (rt.store.wallet(&id)?.owner, rt.store.settings().endpoint)
    };
    let snapshot = Node::new(&endpoint)?.snapshot(&owner).await?;
    if !access(&state)?.store.authorized(&id) {
        return Err("Wallet is locked. Unlock it to continue.".into());
    }
    Ok(snapshot)
}
#[tauri::command]
async fn transaction_detail(state: RuntimeState<'_>, id: String, txid: String) -> Result<Value> {
    let endpoint = {
        let rt = access(&state)?;
        if !rt.store.authorized(&id) {
            return Err("Wallet is locked. Unlock it to continue.".into());
        }
        rt.store.settings().endpoint
    };
    if txid.len() != 64 || hex::decode(&txid).is_err() {
        return Err("Invalid transaction ID.".into());
    }
    let node = Node::new(&endpoint)?;
    node.info().await?;
    let mut tx = node.rpc("gettx", json!([txid])).await?;
    for field in ["inputs", "outputs"] {
        if let Some(rows) = tx[field].as_array_mut() {
            for row in rows {
                if let Some(value) = row["value"].as_u64() {
                    row["value"] = json!(transfer::amount(value))
                }
                if let Some(owner) = row["owner"].as_str() {
                    if let Ok(bytes) = hex::decode(owner) {
                        if let Ok(hash) = <[u8; 32]>::try_from(bytes) {
                            row["address"] =
                                json!(requant_consensus::address::address(&Network::test(), &hash))
                        }
                    }
                }
            }
        }
    }
    if let Some(fee) = tx["fee"].as_u64() {
        tx["fee"] = json!(transfer::amount(fee))
    }
    if !access(&state)?.store.authorized(&id) {
        return Err("Wallet is locked. Unlock it to continue.".into());
    }
    Ok(tx)
}
#[tauri::command]
async fn prepare_transfer(
    state: RuntimeState<'_>,
    id: String,
    recipient: String,
    amount: String,
    fee: String,
    allow_pending: bool,
) -> Result<Review> {
    parse_address(&Network::test(), &recipient)
        .map_err(|_| "The recipient must be a valid Requant testnet address.")?;
    let value = transfer::parse_amount(&amount)?;
    let fee = transfer::parse_amount(&fee)?;
    let (wallet, endpoint) = {
        let mut rt = access(&state)?;
        rt.store.touch(&id)?;
        (rt.store.wallet(&id)?, rt.store.settings().endpoint)
    };
    let node = Node::new(&endpoint)?;
    let info = node.info().await?;
    let coins = node.coins(&wallet.owner).await?;
    if node.info().await?.tip != info.tip {
        return Err("The chain changed. Refresh before preparing the transfer.".into());
    }
    let selected = transfer::select(&coins, value, fee, allow_pending)?;
    node.verify_outputs(&selected, &wallet.owner).await?;
    let quote = hex::encode(crypto::random::<16>()?);
    let mut rt = access(&state)?;
    rt.store.touch(&id)?;
    if rt.store.settings().endpoint != endpoint {
        return Err("The node connection changed. Review the transfer again.".into());
    }
    rt.plans
        .retain(|_, p| p.wallet != id && p.created.elapsed() < Duration::from_secs(120));
    rt.plans.insert(
        quote.clone(),
        Plan {
            wallet: id,
            recipient: recipient.clone(),
            value,
            fee,
            coins: selected.clone(),
            endpoint,
            allow_pending,
            created: Instant::now(),
        },
    );
    Ok(Review {
        id: quote,
        recipient,
        amount: transfer::amount(value),
        fee: transfer::amount(fee),
        total: transfer::amount(value + fee),
        input_count: selected.len(),
        expires_in: 120,
    })
}
#[tauri::command]
async fn confirm_transfer(
    state: RuntimeState<'_>,
    review_id: String,
    password: String,
) -> Result<Sent> {
    let password = Zeroizing::new(password);
    let plan = {
        let rt = access(&state)?;
        let plan = rt
            .plans
            .get(&review_id)
            .cloned()
            .ok_or("Transfer review expired. Review it again.")?;
        if plan.created.elapsed() > Duration::from_secs(120) || !rt.store.authorized(&plan.wallet) {
            return Err("Transfer review expired or wallet locked. Review it again.".into());
        }
        plan
    };
    let node = Node::new(&plan.endpoint)?;
    let info = node.info().await?;
    let owner = access(&state)?.store.wallet(&plan.wallet)?.owner;
    let fresh = node.coins(&owner).await?;
    if node.info().await?.tip != info.tip {
        return Err("The chain changed. Review the transfer again.".into());
    }
    for coin in &plan.coins {
        if !fresh.iter().any(|c| {
            c.txid == coin.txid
                && c.vout == coin.vout
                && c.value == coin.value
                && c.spendable
                && (c.confirmed || plan.allow_pending)
        }) {
            return Err("Selected funds changed or were spent. Review the transfer again.".into());
        }
    }
    node.verify_outputs(&plan.coins, &owner).await?;
    let (txid, raw) = {
        let mut rt = access(&state)?;
        rt.store.touch(&plan.wallet)?;
        if plan.created.elapsed() > Duration::from_secs(120)
            || rt.store.settings().endpoint != plan.endpoint
            || !rt.plans.contains_key(&review_id)
        {
            return Err("Transfer review changed. Review it again.".into());
        }
        let secret = rt.store.secret(&plan.wallet, &password)?;
        let tx = transfer::sign(&secret, &plan.coins, &plan.recipient, plan.value, plan.fee)?;
        let txid = hex::encode(tx.txid());
        let raw = hex::encode(tx.encode());
        rt.store.record(Broadcast {
            wallet_id: plan.wallet.clone(),
            txid: txid.clone(),
            hex: raw.clone(),
            status: "unknown".into(),
        })?;
        rt.plans.remove(&review_id);
        (txid, raw)
    };
    let response = node.rpc("sendtx", json!([raw.clone()])).await;
    let accepted = response.as_ref().ok().and_then(Value::as_str) == Some(txid.as_str())
        || node
            .rpc("gettx", json!([txid.clone()]))
            .await
            .ok()
            .is_some_and(|tx| tx["hex"].as_str() == Some(raw.as_str()));
    let rejected = response
        .as_ref()
        .err()
        .is_some_and(|e| e == "The node rejected this request.");
    let status = if accepted {
        "pending"
    } else if rejected {
        "rejected"
    } else {
        "unknown"
    };
    access(&state)?.store.record(Broadcast {
        wallet_id: plan.wallet,
        txid: txid.clone(),
        hex: raw,
        status: status.into(),
    })?;
    Ok(Sent{txid,status:status.into(),message:if accepted{"Transfer submitted. Waiting for confirmation."}else if rejected{"The node rejected this transfer. Refresh the wallet and review the funds before trying again."}else{"Broadcast result is unknown. Check this transaction in the explorer before sending again."}.into()})
}
#[tauri::command]
fn pending_broadcasts(state: RuntimeState, id: String) -> Result<Vec<Value>> {
    let rt = access(&state)?;
    if !rt.store.authorized(&id) {
        return Err("Wallet is locked.".into());
    }
    Ok(rt
        .store
        .broadcasts(&id)
        .into_iter()
        .map(|b| json!({"txid":b.txid,"status":b.status}))
        .collect())
}
#[tauri::command]
fn share_address(app: tauri::AppHandle, state: RuntimeState, id: String) -> Result<()> {
    let rt = access(&state)?;
    if !rt.store.authorized(&id) {
        return Err("Wallet is locked.".into());
    }
    app.wallet_share().address(&rt.store.wallet(&id)?.address)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .plugin(tauri_plugin_wallet_share::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("REQUANT_WALLET_DEV_DATA")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    if app.config().identifier == "network.requant.wallet.qa" {
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("../.wallet-test/native")
                    } else {
                        directory
                    }
                });
            let store = Store::open(directory).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(Runtime {
                store,
                plans: Default::default(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_wallets,
            create_wallet,
            import_wallet,
            unlock_wallet,
            lock_wallet,
            touch_wallet,
            get_settings,
            save_settings,
            export_backup,
            confirm_backup,
            change_password,
            wallet_snapshot,
            transaction_detail,
            prepare_transfer,
            confirm_transfer,
            pending_broadcasts,
            share_address,
            app_update_info,
            check_app_update,
            install_app_update,
            open_wallet_downloads
        ])
        .run(tauri::generate_context!())
        .expect("Requant Wallet could not start")
}

#[cfg(test)]
mod tests;

#[tauri::command]
fn app_update_info(app: tauri::AppHandle) -> Value {
    let platform = if cfg!(target_os = "android") { "android" }
        else if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() { "linux-package" }
        else { "desktop" };
    json!({"version": app.package_info().version.to_string(), "platform": platform})
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || app.wallet_share().check_update())
        .await.map_err(|_| "Update check failed.".to_string())?
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle, state: RuntimeState<'_>) -> Result<Value> {
    { let mut rt = access(&state)?; rt.store.lock_all(); rt.plans.clear(); }
    tauri::async_runtime::spawn_blocking(move || app.wallet_share().install_update())
        .await.map_err(|_| "Cannot open the update installer.".to_string())?
}

#[tauri::command]
fn open_wallet_downloads(app: tauri::AppHandle) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url("https://requant.network/docs/wallet#download-wallet", None::<&str>)
        .map_err(|_| "Cannot open wallet downloads.".into())
}
