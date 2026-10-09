use crate::crypto::{self, Result};
use ed25519_dalek::SigningKey;
use requant_consensus::{address::address, params::Network, tx::pkh};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;
pub const DEFAULT_ENDPOINT: &str = "https://requant.network/wallet-api/v1/rpc";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wallet {
    pub id: String,
    pub name: String,
    pub address: String,
    pub owner: String,
    pub public_key: String,
    pub encrypted_key: String,
    pub backed_up: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletInfo {
    pub id: String,
    pub name: String,
    pub address: String,
    pub backed_up: bool,
    pub locked: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub endpoint: String,
    pub auto_lock_minutes: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_ENDPOINT.into(),
            auto_lock_minutes: 5,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Broadcast {
    pub wallet_id: String,
    pub txid: String,
    pub hex: String,
    pub status: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Disk {
    schema: u8,
    wallets: Vec<Wallet>,
    settings: Settings,
    #[serde(default)]
    broadcasts: Vec<Broadcast>,
}
pub struct Store {
    directory: PathBuf,
    disk: Disk,
    unlocked: HashMap<String, Instant>,
    attempts: HashMap<String, (u8, Instant)>,
}
impl Store {
    pub fn open(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory).map_err(|_| "Cannot create wallet storage.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect wallet storage.")?;
        }
        let path = directory.join("wallets.json");
        let disk = if path.exists() {
            if fs::metadata(&path)
                .map_err(|_| "Cannot read wallet storage.")?
                .len()
                > 4 * 1024 * 1024
            {
                return Err("Wallet storage is too large.".into());
            }
            serde_json::from_slice::<Disk>(
                &fs::read(path).map_err(|_| "Cannot read wallet storage.")?,
            )
            .map_err(|_| "Wallet storage is damaged. Restore your backup.")?
        } else {
            Disk {
                schema: 1,
                wallets: vec![],
                settings: Settings::default(),
                broadcasts: vec![],
            }
        };
        if disk.schema != 1 {
            return Err("Unsupported wallet storage version.".into());
        }
        Ok(Self {
            directory,
            disk,
            unlocked: HashMap::new(),
            attempts: HashMap::new(),
        })
    }
    fn persist(&mut self, next: Disk) -> Result<()> {
        let path = self.directory.join(format!(
            ".wallet-{}.tmp",
            hex::encode(crypto::random::<8>()?)
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result: Result<()> = (|| {
            let mut file = options
                .open(&path)
                .map_err(|_| "Cannot save wallet storage.")?;
            file.write_all(
                &serde_json::to_vec(&next).map_err(|_| "Cannot encode wallet storage.")?,
            )
            .map_err(|_| "Cannot save wallet storage.")?;
            file.sync_all().map_err(|_| "Cannot save wallet storage.")?;
            fs::rename(&path, self.directory.join("wallets.json"))
                .map_err(|_| "Cannot replace wallet storage.")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(path);
        }
        result?;
        self.disk = next;
        Ok(())
    }
    pub fn settings(&self) -> Settings {
        self.disk.settings.clone()
    }
    pub fn configure(&mut self, settings: Settings) -> Result<()> {
        crate::network::validate_endpoint(&settings.endpoint)?;
        if !(1..=30).contains(&settings.auto_lock_minutes) {
            return Err("Auto-lock must be between 1 and 30 minutes.".into());
        }
        let mut disk = self.disk.clone();
        disk.settings = settings;
        self.persist(disk)?;
        self.lock_all();
        Ok(())
    }
    pub fn wallet(&self, id: &str) -> Result<Wallet> {
        self.disk
            .wallets
            .iter()
            .find(|w| w.id == id)
            .cloned()
            .ok_or("Wallet not found.".into())
    }
    pub fn authorized(&self, id: &str) -> bool {
        self.unlocked.get(id).is_some_and(|time| {
            time.elapsed() < Duration::from_secs(self.disk.settings.auto_lock_minutes * 60)
        })
    }
    pub fn touch(&mut self, id: &str) -> Result<()> {
        if !self.authorized(id) {
            self.unlocked.remove(id);
            return Err("Wallet is locked. Unlock it to continue.".into());
        }
        self.unlocked.insert(id.into(), Instant::now());
        Ok(())
    }
    pub fn list(&self) -> Vec<WalletInfo> {
        self.disk
            .wallets
            .iter()
            .map(|w| WalletInfo {
                id: w.id.clone(),
                name: w.name.clone(),
                address: w.address.clone(),
                backed_up: w.backed_up,
                locked: !self.authorized(&w.id),
            })
            .collect()
    }
    fn add(
        &mut self,
        name: &str,
        secret: &[u8; 32],
        password: &str,
        backed_up: bool,
    ) -> Result<WalletInfo> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
            return Err("Use a wallet name between 1 and 60 characters.".into());
        }
        if self.disk.wallets.len() >= 20 {
            return Err("This version supports up to 20 separate wallets.".into());
        }
        let key = SigningKey::from_bytes(secret);
        let owner = pkh(&key.verifying_key().to_bytes());
        if self
            .disk
            .wallets
            .iter()
            .any(|w| w.owner == hex::encode(owner))
        {
            return Err("This key is already in your wallet list.".into());
        }
        let id = hex::encode(crypto::random::<16>()?);
        let wallet = Wallet {
            id: id.clone(),
            name: name.into(),
            address: address(&Network::test(), &owner),
            owner: hex::encode(owner),
            public_key: hex::encode(key.verifying_key().to_bytes()),
            encrypted_key: crypto::encrypt(secret, password)?,
            backed_up,
        };
        let mut next = self.disk.clone();
        next.wallets.push(wallet);
        self.persist(next)?;
        self.unlocked.insert(id.clone(), Instant::now());
        Ok(self.list().into_iter().find(|w| w.id == id).unwrap())
    }
    pub fn create(&mut self, name: &str, password: &str) -> Result<WalletInfo> {
        crypto::new_password(password)?;
        let secret = Zeroizing::new(crypto::random::<32>()?);
        self.add(name, &secret, password, false)
    }
    pub fn import(
        &mut self,
        name: &str,
        backup: &str,
        password: &str,
        legacy: bool,
    ) -> Result<WalletInfo> {
        if legacy {
            crypto::new_password(password)?
        }
        let secret = crypto::decrypt(backup, password, legacy)?;
        self.add(name, &secret, password, false)
    }
    pub fn secret(&mut self, id: &str, password: &str) -> Result<Zeroizing<[u8; 32]>> {
        if let Some((attempts, start)) = self.attempts.get(id) {
            if *attempts >= 5 && start.elapsed() < Duration::from_secs(60) {
                return Err("Too many unlock attempts. Try again in one minute.".into());
            }
        }
        let wallet = self.wallet(id)?;
        let secret = match crypto::decrypt(&wallet.encrypted_key, password, false) {
            Ok(s) => s,
            Err(e) => {
                let item = self
                    .attempts
                    .entry(id.into())
                    .or_insert((0, Instant::now()));
                if item.1.elapsed() > Duration::from_secs(60) {
                    *item = (0, Instant::now())
                }
                item.0 += 1;
                return Err(e);
            }
        };
        let key = SigningKey::from_bytes(&secret);
        if hex::encode(pkh(&key.verifying_key().to_bytes())) != wallet.owner
            || hex::encode(key.verifying_key().to_bytes()) != wallet.public_key
            || address(&Network::test(), &pkh(&key.verifying_key().to_bytes())) != wallet.address
        {
            return Err(
                "Wallet metadata does not match its key. Restore the encrypted backup.".into(),
            );
        }
        self.attempts.remove(id);
        Ok(secret)
    }
    pub fn unlock(&mut self, id: &str, password: &str) -> Result<()> {
        let _secret = self.secret(id, password)?;
        self.unlocked.insert(id.into(), Instant::now());
        Ok(())
    }
    pub fn lock_all(&mut self) {
        self.unlocked.clear()
    }
    pub fn backup(&mut self, id: &str, password: &str) -> Result<String> {
        let _secret = self.secret(id, password)?;
        Ok(self.wallet(id)?.encrypted_key)
    }
    pub fn confirm_backup(&mut self, id: &str, password: &str) -> Result<()> {
        let _secret = self.secret(id, password)?;
        self.mark_backed_up(id)
    }
    pub fn backed_up(&mut self, id: &str) -> Result<()> {
        self.touch(id)?;
        self.mark_backed_up(id)
    }
    fn mark_backed_up(&mut self, id: &str) -> Result<()> {
        let mut next = self.disk.clone();
        next.wallets
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or("Wallet not found.")?
            .backed_up = true;
        self.persist(next)
    }
    pub fn change_password(&mut self, id: &str, current: &str, next_password: &str) -> Result<()> {
        crypto::new_password(next_password)?;
        let secret = self.secret(id, current)?;
        let encrypted = crypto::encrypt(&secret, next_password)?;
        let mut next = self.disk.clone();
        let wallet = next
            .wallets
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or("Wallet not found.")?;
        wallet.encrypted_key = encrypted;
        wallet.backed_up = false;
        self.persist(next)?;
        self.lock_all();
        Ok(())
    }
    pub fn record(&mut self, broadcast: Broadcast) -> Result<()> {
        let mut next = self.disk.clone();
        next.broadcasts.retain(|b| b.txid != broadcast.txid);
        next.broadcasts.push(broadcast);
        if next.broadcasts.len() > 100 {
            next.broadcasts.remove(0);
        }
        self.persist(next)
    }
    pub fn broadcasts(&self, id: &str) -> Vec<Broadcast> {
        self.disk
            .broadcasts
            .iter()
            .filter(|b| b.wallet_id == id)
            .cloned()
            .collect()
    }
}
