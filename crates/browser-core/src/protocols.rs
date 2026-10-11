//! Protocol secrets stay inside the local core. Persist only authenticated encrypted envelopes.
use super::*;
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit, Nonce,
};
pub fn parse(s: &str) -> Result<Value> {
    if s.len() > 8 * 1024 * 1024 {
        return Err("Protocol file is too large.".into());
    }
    serde_json::from_str(s).map_err(|_| "Invalid protocol file.".into())
}
pub fn seal(value: &Value, pass: &str) -> Result<String> {
    if !(12..=256).contains(&pass.len()) {
        return Err("Use a backup password of 12 to 256 characters.".into());
    }
    let key = Zeroizing::new(random::<32>()?);
    let nonce = random::<12>()?;
    let text = Zeroizing::new(value.to_string());
    let cipher =
        ChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "Encryption failed.")?;
    let payload = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: text.as_bytes(),
                aad: b"requant-swap:1:test",
            },
        )
        .map_err(|_| "Encryption failed.")?;
    Ok(json!({"requant_swap_encrypted":1,"network":"test","key":wallet::encrypt_key(&key,pass,&random()?,&random()?).map_err(str::to_owned)?,"nonce":hex::encode(nonce),"payload":hex::encode(payload)}).to_string())
}
pub fn envelope(s: &str) -> Result<Value> {
    let v = parse(s)?;
    if v.as_object().is_none_or(|o| {
        o.keys().any(|k| {
            ![
                "requant_swap_encrypted",
                "network",
                "key",
                "nonce",
                "payload",
            ]
            .contains(&k.as_str())
        })
    }) {
        return Err("Unsupported encrypted swap fields.".into());
    }
    if v["requant_swap_encrypted"] != 1 || v["network"] != "test" {
        return Err("Import an encrypted Requant testnet swap backup.".into());
    }
    let k = field(&v, "key")?;
    if !k.starts_with("requant-key:1:argon2id:") {
        return Err("Encrypted swap key required.".into());
    }
    cost(k)?;
    if hex::decode(field(&v, "nonce")?)
        .ok()
        .is_none_or(|b| b.len() != 12)
        || hex::decode(field(&v, "payload")?)
            .ok()
            .is_none_or(|b| b.len() < 16)
    {
        return Err("Invalid encrypted swap.".into());
    }
    Ok(v)
}
pub fn open(v: &Value) -> Result<Value> {
    let e = envelope(field(v, "record")?)?;
    let key = Zeroizing::new(
        wallet::decrypt_key(field(&e, "key")?, Some(field(v, "password")?))
            .map_err(|_| "Wrong swap password.")?,
    );
    let nonce = hex::decode(field(&e, "nonce")?).map_err(|_| "Invalid nonce.")?;
    let payload = hex::decode(field(&e, "payload")?).map_err(|_| "Invalid payload.")?;
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "Invalid key.")?;
    let text = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &payload,
                    aad: b"requant-swap:1:test",
                },
            )
            .map_err(|_| "Damaged or modified swap backup.")?,
    );
    serde_json::from_slice(&text).map_err(|_| "Invalid encrypted record.".into())
}
pub fn tx(s: &str) -> Result<Tx> {
    if s.len() > 200_000 {
        return Err("Transaction exceeds 100 kB.".into());
    }
    Tx::decode_exact(&hex::decode(s.trim()).map_err(|_| "Invalid transaction hex.")?)
        .map_err(|e| e.to_string())
}
pub fn keys(v: &Value) -> Result<Vec<SigningKey>> {
    super::conditions::keyring(v)
}
pub fn num(v: &Value, k: &str) -> Result<u64> {
    number(&v[k]).ok_or(format!("Invalid {k}."))
}
pub fn json_strings(v: Value) -> Value {
    super::strings(v)
}
pub fn parents(tx: &Tx, v: &Value) -> Result<Vec<Tx>> {
    super::conditions::parents(tx, v, None)
}
pub fn review(tx: &Tx, prev: Vec<Tx>) -> Result<Value> {
    super::conditions::review(tx, prev)
}
pub fn signed(tx: &Tx) -> Result<Value> {
    tx.check_standalone(&Network::test().chain_id)
        .map_err(|e| e.to_string())?;
    Ok(json!({"hex":hex::encode(tx.encode()),"txid":hex::encode(tx.txid())}))
}
pub fn store(text: &str, previous: Option<&str>) -> Result<()> {
    let v = parse(text)?;
    fn no_plain_secrets(v: &Value) -> Result<()> {
        match v {
            Value::Object(o) => {
                for (k, v) in o {
                    if [
                        "secret",
                        "password",
                        "phrase",
                        "seed",
                        "btc_refund_key",
                        "tron_key",
                    ]
                    .contains(&k.as_str())
                    {
                        return Err("Protocol storage cannot contain plaintext secrets.".into());
                    }
                    no_plain_secrets(v)?;
                }
            }
            Value::Array(a) => {
                for v in a {
                    no_plain_secrets(v)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    no_plain_secrets(&v)?;
    let swaps = v["swaps"]
        .as_array()
        .filter(|a| a.len() <= 100)
        .ok_or("Invalid swap storage.")?;
    let channels = v["channels"]
        .as_array()
        .filter(|a| a.len() <= 100)
        .ok_or("Invalid channel storage.")?;
    let mut ids = HashSet::new();
    for r in swaps {
        if !ids.insert(field(r, "id")?.to_owned()) || field(r, "walletId")?.len() > 80 {
            return Err("Invalid swap identity.".into());
        }
        envelope(field(r, "record")?)?;
    }
    let old = previous
        .map(parse)
        .transpose()?
        .unwrap_or_else(|| json!({"channels":[]}));
    ids.clear();
    for r in channels {
        let public_channel = parse(field(r, "channel")?)?;
        no_plain_secrets(&public_channel)?;
        let c = wallet::channel::Channel::from_json(&Network::test(), &public_channel)?;
        let id = hex::encode(c.funding.txid());
        if field(r, "id")? != id || !ids.insert(id.clone()) {
            return Err("Invalid channel identity.".into());
        }
        if let Some(rows) = old["channels"].as_array() {
            for before in rows {
                if before["id"] == r["id"] {
                    let o = wallet::channel::Channel::from_json(
                        &Network::test(),
                        &parse(field(before, "channel")?)?,
                    )?;
                    if c.paid < o.paid {
                        return Err("Cannot replace a channel with an older payment total.".into());
                    }
                }
            }
        }
        if let Some(s) = r["state"].as_str().filter(|s| !s.is_empty()) {
            if c.paid_by(&Network::test(), &tx(s)?)? != c.paid {
                return Err("Channel state payment total mismatch.".into());
            }
        }
    }
    Ok(())
}
