mod conditions;
use ed25519_dalek::SigningKey;
use requant_consensus::{
    address::{address, parse_address},
    params::{Network, MAX_AMOUNT},
    tx::{Hash, OutPoint, Tx},
};
use requant_wallet_portable::{
    self as wallet, hd,
    wallet::{Unsigned, WalletFile},
    Spendable,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;
type Result<T> = std::result::Result<T, String>;
fn field<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or(format!("Missing {k}."))
}
fn random<const N: usize>() -> Result<[u8; N]> {
    let mut b = [0; N];
    getrandom::getrandom(&mut b).map_err(|_| "Secure randomness is unavailable.")?;
    Ok(b)
}
fn password(v: &Value, k: &str) -> Result<Zeroizing<String>> {
    let p = field(v, k)?;
    if p.len() < 12 || p.len() > 256 {
        return Err("Use a local password between 12 and 256 characters.".into());
    }
    Ok(Zeroizing::new(p.to_owned()))
}
fn count(v: &Value) -> Result<u32> {
    match v.get("count") {
        None => Ok(1),
        Some(n) => n
            .as_u64()
            .filter(|n| *n >= 1 && *n <= 100000)
            .map(|n| n as u32)
            .ok_or("Address count must be between 1 and 100,000.".into()),
    }
}
fn number(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| {
        v.as_str()
            .filter(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
            .and_then(|s| s.parse().ok())
    })
}
fn hash(s: &str) -> Result<Hash> {
    hex::decode(s)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("Invalid 32-byte hash.".into())
}
fn cost(text: &str) -> Result<()> {
    let p: Vec<_> = text.split(':').collect();
    if p.len() != 9 {
        return Err("Unsupported encrypted backup.".into());
    }
    for (i, max) in [(3, 65536), (4, 3), (5, 1)] {
        let n = p[i]
            .parse::<u32>()
            .map_err(|_| "Invalid encryption parameters.")?;
        if n == 0 || n > max {
            return Err("Unsupported encryption cost.".into());
        }
    }
    Ok(())
}
fn hd_file(text: &str) -> Result<WalletFile> {
    if text.len() > 32 * 1024 * 1024 {
        return Err("Wallet backup is too large.".into());
    }
    let v: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
    if let Some(s) = v["seed"].as_str() {
        if !s.starts_with("requant-seed:1:argon2id:") {
            return Err("Import an encrypted wallet file.".into());
        }
        cost(s)?
    }
    let w = WalletFile::parse(text)?;
    if w.network != "test"
        || w.receive.is_empty()
        || w.receive_issued == 0
        || w.receive.len() > 100020
        || w.change.len() > 100020
    {
        return Err("Invalid Requant testnet wallet.".into());
    }
    let owners = w.owners();
    let unique: HashSet<_> = owners.iter().collect();
    if unique.len() != owners.len() {
        return Err("Duplicate wallet addresses.".into());
    }
    Ok(w)
}
fn legacy(v: &Value) -> Result<Option<(String, Hash)>> {
    if v["requant_legacy"] != 1 {
        return Ok(None);
    }
    if v["network"] != "test" {
        return Err("Requant testnet backup required.".into());
    }
    let key = field(v, "encrypted")?.to_owned();
    cost(&key)?;
    Ok(Some((key, hash(field(v, "owner")?)?)))
}
fn metadata(text: &str) -> Result<Value> {
    let v: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
    if let Some((_, owner)) = legacy(&v)? {
        return Ok(
            json!({"address":address(&Network::test(),&owner),"watchOnly":false,"legacy":true,"addresses":[{"address":address(&Network::test(),&owner),"owner":hex::encode(owner),"chain":0,"index":0,"issued":true}]}),
        );
    }
    let w = hd_file(text)?;
    let entries:Vec<_>=[(0,&w.receive,w.receive_issued),(1,&w.change,w.change_issued)].into_iter().flat_map(|(chain,list,issued)|list.iter().enumerate().map(move |(i,h)|json!({"address":address(&Network::test(),h),"owner":hex::encode(h),"chain":chain,"index":i,"issued":i<(issued as usize)}))).collect();
    Ok(
        json!({"address":address(&Network::test(),&w.receive[0]),"watchOnly":w.watch_only(),"legacy":false,"addresses":entries}),
    )
}
fn unlocked(text: &str, p: &str) -> Result<(WalletFile, Zeroizing<[u8; 64]>)> {
    let w = hd_file(text)?;
    let e = w
        .entropy(Some(p))
        .map_err(|_| "Wrong password or damaged wallet file.")?;
    let seed = hd::seed_of(&e, "");
    if w.keyring(&seed).len() != w.owners().len() {
        return Err("Wallet addresses do not match its recovery phrase.".into());
    }
    Ok((w, seed))
}
fn rpc(raw: &str) -> Result<Value> {
    if raw.len() > 4 * 1024 * 1024 {
        return Err("Node response is too large.".into());
    }
    let v: Value = serde_json::from_str(raw).map_err(|_| "Invalid node response.")?;
    if !v["error"].is_null() {
        return Err("The node rejected this request.".into());
    }
    v.get("result")
        .cloned()
        .ok_or("Missing node result.".into())
}
fn strings(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::String(n.to_string()),
        Value::Array(a) => Value::Array(a.into_iter().map(strings).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, strings(v))).collect()),
        v => v,
    }
}
fn coins(v: &Value) -> Result<Vec<Spendable>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for batch in v.as_array().ok_or("Invalid output batches.")? {
        let owner = hash(field(batch, "owner")?)?;
        let a = rpc(field(batch, "raw")?)?;
        for c in a.as_array().ok_or("Invalid output list.")? {
            let txid = hash(field(c, "txid")?)?;
            let vout = number(&c["vout"])
                .and_then(|x| u32::try_from(x).ok())
                .ok_or("Invalid output index.")?;
            let value = number(&c["value"])
                .filter(|x| *x > 0 && *x <= MAX_AMOUNT)
                .ok_or("Invalid output value.")?;
            if !seen.insert((txid, vout)) {
                return Err("Duplicate source output.".into());
            }
            if c["spendable"] == true && c["confirmed"] == true {
                total = total
                    .checked_add(value)
                    .filter(|x| *x <= MAX_AMOUNT)
                    .ok_or("Output value overflow.")?;
                out.push(Spendable {
                    op: OutPoint { txid, vout },
                    value,
                    owner,
                });
            }
        }
    }
    Ok(out)
}
fn payment_review(u: &Unsigned) -> Result<Value> {
    let Tx::Transfer { inputs, outputs } = &u.tx else {
        return Err("Not a payment.".into());
    };
    let mut spent = 0u64;
    for i in inputs {
        let parent = u
            .prev
            .iter()
            .find(|t| t.txid() == i.prev.txid)
            .ok_or("Missing source transaction.")?;
        parent
            .check_standalone(&Network::test().chain_id)
            .map_err(|_| "Invalid source transaction.")?;
        spent = spent
            .checked_add(
                parent
                    .outputs()
                    .get(i.prev.vout as usize)
                    .ok_or("Missing source output.")?
                    .value,
            )
            .filter(|x| *x <= MAX_AMOUNT)
            .ok_or("Amount overflow.")?;
    }
    let mut amount = 0u64;
    let mut change = 0u64;
    let mut rows = Vec::new();
    for (i, o) in outputs.iter().enumerate() {
        let is_change = u.change.iter().any(|c| c.0 as usize == i);
        if is_change {
            change = change.checked_add(o.value).ok_or("Amount overflow.")?
        } else {
            amount = amount.checked_add(o.value).ok_or("Amount overflow.")?
        }
        rows.push(json!({"address":address(&Network::test(),&o.pkh),"amount":wallet::format_amount(o.value),"change":is_change}));
    }
    let fee = spent
        .checked_sub(amount.checked_add(change).ok_or("Amount overflow.")?)
        .ok_or("Outputs exceed inputs.")?;
    Ok(
        json!({"outputs":rows,"amount":wallet::format_amount(amount),"change":wallet::format_amount(change),"fee":wallet::format_amount(fee),"total":wallet::format_amount(amount+fee),"inputCount":inputs.len()}),
    )
}
fn unsigned(text: &str) -> Result<Unsigned> {
    if text.len() > 8 * 1024 * 1024 {
        return Err("Payment file is too large.".into());
    }
    let u = Unsigned::parse(text)?;
    if u.network != "test"
        || u.paths.len() > 600
        || u.paths.iter().any(|(c, i)| *c > 1 || *i >= 100020)
        || u.change.iter().any(|(_, c, i)| *c > 1 || *i >= 100020)
    {
        return Err("Invalid testnet payment paths.".into());
    }
    let Tx::Transfer { inputs, .. } = &u.tx else {
        return Err("Not a transfer.".into());
    };
    let mut seen = HashSet::new();
    if inputs
        .iter()
        .any(|i| !seen.insert((i.prev.txid, i.prev.vout)))
    {
        return Err("Duplicate payment input.".into());
    }
    Ok(u)
}
pub fn execute(op: &str, input: &str) -> Result<String> {
    if input.len() > 64 * 1024 * 1024 {
        return Err("Request is too large.".into());
    }
    let v: Value = serde_json::from_str(input).map_err(|_| "Invalid local wallet request.")?;
    let net = Network::test();
    if matches!(
        op,
        "condition" | "secret" | "pubkey" | "contractPrepare" | "contractInspect" | "contractSign"
    ) {
        return conditions::execute(op, &v).map(|v| v.to_string());
    }
    let out = match op {
        "create" | "restorePhrase" => {
            let p = password(&v, "password")?;
            let entropy = if op == "create" {
                Zeroizing::new(random::<32>()?)
            } else {
                hd::entropy_of(field(&v, "phrase")?)?
            };
            let n = count(&v)?;
            let mut w = WalletFile::new(&net, &entropy, Some(&p), &random()?, &random()?)?;
            w.receive_issued = n;
            w.top_up(&hd::seed_of(&entropy, ""));
            json!({"file":w.to_text(),"meta":metadata(&w.to_text())?,"phrase":if op=="create"{Some(hd::phrase_of(&entropy).to_string())}else{None}})
        }
        "metadata" => metadata(field(&v, "file")?)?,
        "importPlain" => {
            let text = field(&v, "file")?.trim();
            if text.len() != 64 || !text.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("Plain legacy key must contain exactly 64 hexadecimal digits.".into());
            }
            let p = password(&v, "password")?;
            let key = Zeroizing::new(wallet::decrypt_key(text, None).map_err(str::to_owned)?);
            let owner = wallet::owner_of(&SigningKey::from_bytes(&key));
            let encrypted =
                wallet::encrypt_key(&key, &p, &random()?, &random()?).map_err(str::to_owned)?;
            let file=json!({"requant_legacy":1,"network":"test","encrypted":encrypted,"owner":hex::encode(owner)}).to_string();
            json!({"file":file,"meta":metadata(&file)?})
        }
        "import" => {
            let text = field(&v, "file")?.trim();
            let p = Zeroizing::new(field(&v, "password")?.to_owned());
            if text.starts_with("requant-key:1:argon2id:") {
                cost(text)?;
                let key = Zeroizing::new(
                    wallet::decrypt_key(text, Some(&p))
                        .map_err(|_| "Wrong password or damaged key file.")?,
                );
                let owner = wallet::owner_of(&SigningKey::from_bytes(&key));
                let file=json!({"requant_legacy":1,"network":"test","encrypted":text,"owner":hex::encode(owner)}).to_string();
                json!({"meta":metadata(&file)?,"file":file})
            } else {
                let w = hd_file(text)?;
                if !w.watch_only() {
                    unlocked(text, &p)?;
                }
                json!({"file":w.to_text(),"meta":metadata(text)?})
            }
        }
        "phrase" => {
            let (w, _) = unlocked(field(&v, "file")?, field(&v, "password")?)?;
            let e = w.entropy(Some(field(&v, "password")?))?;
            json!({"phrase":hd::phrase_of(&e).to_string()})
        }
        "changePassword" => {
            let text = field(&v, "file")?;
            let old = Zeroizing::new(field(&v, "password")?.to_owned());
            let next = password(&v, "nextPassword")?;
            let j: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
            let file = if let Some((encrypted, owner)) = legacy(&j)? {
                let key = Zeroizing::new(
                    wallet::decrypt_key(&encrypted, Some(&old)).map_err(|_| "Wrong password.")?,
                );
                if wallet::owner_of(&SigningKey::from_bytes(&key)) != owner {
                    return Err("Key metadata mismatch.".into());
                }
                json!({"requant_legacy":1,"network":"test","encrypted":wallet::encrypt_key(&key,&next,&random()?,&random()?).map_err(str::to_owned)?,"owner":hex::encode(owner)}).to_string()
            } else {
                let (mut w, _) = unlocked(text, &old)?;
                let e = w.entropy(Some(&old))?;
                w.reseal(&e, Some(&next), &random()?, &random()?)?;
                w.to_text()
            };
            json!({"file":file})
        }
        "nextAddress" | "scan" => {
            let (mut w, seed) = unlocked(field(&v, "file")?, field(&v, "password")?)?;
            if op == "scan" {
                let used: HashSet<Hash> = v["used"]
                    .as_array()
                    .ok_or("Missing used address list.")?
                    .iter()
                    .map(|x| hash(x.as_str().unwrap_or_default()))
                    .collect::<Result<_>>()?;
                for (list, issued) in [
                    (&w.receive, &mut w.receive_issued),
                    (&w.change, &mut w.change_issued),
                ] {
                    if let Some(i) = list.iter().rposition(|h| used.contains(h)) {
                        *issued = (*issued).max(i as u32 + 1)
                    }
                }
                w.top_up(&seed);
            } else {
                let n = count(&v)?;
                let next = w
                    .receive_issued
                    .checked_add(n)
                    .filter(|n| *n <= 100000)
                    .ok_or("This wallet supports up to 100,000 issued receive addresses.")?;
                w.receive_issued = next;
                w.top_up(&seed);
            }
            if w.owners().len() > 200040 {
                return Err("Recovery scan exceeds this wallet's address limit.".into());
            }
            json!({"file":w.to_text(),"meta":metadata(&w.to_text())?})
        }
        "watch" => {
            let w = hd_file(field(&v, "file")?)?;
            json!({"file":w.watch_copy().to_text()})
        }
        "transaction" => {
            let result = rpc(field(&v, "raw")?)?;
            let bytes =
                hex::decode(field(&result, "hex")?).map_err(|_| "Invalid transaction bytes.")?;
            let tx = Tx::decode_exact(&bytes).map_err(|_| "Invalid transaction.")?;
            tx.check_standalone(&net.chain_id)
                .map_err(|_| "Invalid transaction signatures.")?;
            let txid = hex::encode(tx.txid());
            if txid != field(&v, "txid")? {
                return Err("Transaction ID mismatch.".into());
            }
            json!({"txid":txid,"coinbase":matches!(tx,Tx::Coinbase{..}),"confirmations":strings(result["confirmations"].clone()),"outputs":tx.outputs().iter().map(|o|json!({"address":address(&net,&o.pkh),"amount":wallet::format_amount(o.value)})).collect::<Vec<_>>()})
        }
        "rpc" => strings(rpc(field(&v, "raw")?)?),
        "info" => {
            let info = rpc(field(&v, "raw")?)?;
            let expected = hex::encode(requant_consensus::block::genesis(&net).id(&net));
            if info["network"] != "test"
                || rpc(field(&v, "genesis")?)?["id"] != expected
                || hash(info["tip"].as_str().unwrap_or_default()).is_err()
                || info["height"].as_u64().is_none()
            {
                return Err("The node does not match Requant testnet.".into());
            }
            strings(info)
        }
        "validateAddress" => {
            parse_address(&net, field(&v, "address")?)
                .map_err(|_| "Enter a complete Requant testnet address.")?;
            json!(true)
        }
        "plan" => {
            let text = field(&v, "file")?;
            let j: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
            let old = legacy(&j)?;
            let mut w = if old.is_some() {
                None
            } else {
                Some(hd_file(text)?)
            };
            let owners: HashSet<_> = if let Some((_, owner)) = &old {
                vec![*owner]
            } else {
                w.as_ref().unwrap().owners()
            }
            .into_iter()
            .collect();
            let mut c = coins(&v["coins"])?;
            if c.iter().any(|c| !owners.contains(&c.owner)) {
                return Err("Output does not belong to this wallet.".into());
            }
            let rate = v["rate"]
                .as_u64()
                .filter(|r| *r > 0 && *r <= 1_000_000)
                .ok_or("Invalid fee rate.")?;
            let change_to = if let Some((_, owner)) = &old {
                *owner
            } else {
                w.as_mut()
                    .unwrap()
                    .next_change()
                    .ok_or("Unlock to derive more change addresses.")?
            };
            let mut cp = Vec::new();
            let (tx, chosen, fee) = if v["mode"] == "max" || v["mode"] == "consolidate" {
                let to = if v["mode"] == "consolidate" {
                    change_to
                } else {
                    parse_address(&net, field(&v, "recipient")?)
                        .map_err(|_| "Enter a complete testnet address.")?
                };
                if v["mode"] == "consolidate" {
                    c.sort_by_key(|c| c.value)
                } else {
                    c.sort_by_key(|c| std::cmp::Reverse(c.value))
                }
                let (tx, chosen, _, fee) = wallet::plan_sweep(&c, &to, rate)?;
                if v["mode"] == "consolidate" {
                    let (chain, index) = if old.is_some() {
                        (0, 0)
                    } else {
                        w.as_ref()
                            .unwrap()
                            .path_of(&to)
                            .ok_or("Invalid change path.")?
                    };
                    cp.push((0, chain, index));
                }
                (tx, chosen, fee)
            } else {
                let payments = v["payments"]
                    .as_array()
                    .filter(|a| !a.is_empty() && a.len() <= 100)
                    .ok_or("Use between 1 and 100 recipients.")?;
                let payments = payments
                    .iter()
                    .map(|p| {
                        Ok((
                            parse_address(&net, field(p, "address")?)
                                .map_err(|_| "Enter a complete testnet address.")?,
                            wallet::parse_amount(field(p, "amount")?).map_err(str::to_owned)?,
                        ))
                    })
                    .collect::<Result<Vec<_>>>()?;
                let (tx, chosen, fee) = wallet::plan_payment(&c, &payments, rate, change_to)?;
                if tx.outputs().len() > payments.len() {
                    let (chain, index) = if old.is_some() {
                        (0, 0)
                    } else {
                        w.as_ref()
                            .unwrap()
                            .path_of(&change_to)
                            .ok_or("Invalid change path.")?
                    };
                    cp.push((payments.len() as u32, chain, index));
                }
                (tx, chosen, fee)
            };
            if v["parents"].is_null() {
                return Ok(json!({"inputs":chosen.iter().map(|c|json!({"txid":hex::encode(c.op.txid),"vout":c.op.vout})).collect::<Vec<_>>()} ).to_string());
            }
            let mut prev = Vec::new();
            let mut seen = HashSet::new();
            for coin in &chosen {
                let id = hex::encode(coin.op.txid);
                let p = rpc(v["parents"][&id]
                    .as_str()
                    .ok_or("Missing source transaction.")?)?;
                let tx = Tx::decode_exact(
                    &hex::decode(field(&p, "hex")?).map_err(|_| "Invalid source bytes.")?,
                )
                .map_err(|_| "Invalid source transaction.")?;
                tx.check_standalone(&net.chain_id)
                    .map_err(|_| "Invalid source transaction.")?;
                let o = tx
                    .outputs()
                    .get(coin.op.vout as usize)
                    .ok_or("Missing source output.")?;
                if tx.txid() != coin.op.txid || o.value != coin.value || o.pkh != coin.owner {
                    return Err("Source transaction value or owner mismatch.".into());
                }
                if seen.insert(tx.txid()) {
                    prev.push(tx);
                }
            }
            let paths = chosen
                .iter()
                .map(|c| {
                    if old.is_some() {
                        Ok((0, 0))
                    } else {
                        w.as_ref()
                            .unwrap()
                            .path_of(&c.owner)
                            .ok_or_else(|| "Unknown wallet path.".to_string())
                    }
                })
                .collect::<Result<_>>()?;
            let u = Unsigned {
                network: "test".into(),
                tx,
                paths,
                prev,
                change: cp,
            };
            let review = payment_review(&u)?;
            if review["fee"] != wallet::format_amount(fee) {
                return Err("Fee mismatch.".into());
            }
            json!({"unsigned":u.to_text(),"file":if let Some(w)=&w{w.to_text()}else{text.to_owned()},"review":review,"inputs":chosen.iter().map(|c|json!({"txid":hex::encode(c.op.txid),"vout":c.op.vout,"value":c.value.to_string(),"owner":hex::encode(c.owner)})).collect::<Vec<_>>()})
        }
        "reviewOffline" | "sign" => {
            let text = field(&v, "file")?;
            let j: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
            let u = unsigned(field(&v, "unsigned")?)?;
            let tx = if let Some((encrypted, owner)) = legacy(&j)? {
                let key = Zeroizing::new(
                    wallet::decrypt_key(&encrypted, Some(field(&v, "password")?))
                        .map_err(|_| "Wrong password or damaged key file.")?,
                );
                let key = SigningKey::from_bytes(&key);
                if wallet::owner_of(&key) != owner {
                    return Err("Key metadata mismatch.".into());
                }
                let Tx::Transfer { inputs, outputs } = &u.tx else {
                    return Err("Not a payment.".into());
                };
                for i in inputs {
                    let parent = u
                        .prev
                        .iter()
                        .find(|t| t.txid() == i.prev.txid)
                        .ok_or("Missing source transaction.")?;
                    if parent
                        .outputs()
                        .get(i.prev.vout as usize)
                        .ok_or("Missing source output.")?
                        .pkh
                        != owner
                    {
                        return Err("Source output does not belong to this key.".into());
                    }
                }
                for (index, _, _) in &u.change {
                    if outputs
                        .get(*index as usize)
                        .ok_or("Invalid change index.")?
                        .pkh
                        != owner
                    {
                        return Err("Change does not return to this key.".into());
                    }
                }
                let mut tx = u.tx.clone();
                tx.sign(&net.chain_id, &vec![&key; inputs.len()]);
                tx
            } else {
                let (_, seed) = unlocked(text, field(&v, "password")?)?;
                u.review(&seed)?;
                u.sign(&net, &seed)
            };
            let review = payment_review(&u)?;
            if op == "sign" {
                tx.check_standalone(&net.chain_id)
                    .map_err(|_| "Invalid signed payment.")?;
                json!({"hex":hex::encode(tx.encode()),"txid":hex::encode(tx.txid()),"review":review})
            } else {
                json!({"review":review})
            }
        }
        "signed" => {
            let raw = hex::decode(field(&v, "hex")?.trim())
                .map_err(|_| "Invalid signed transaction hex.")?;
            if raw.len() > 100_000 {
                return Err("Signed transaction is too large.".into());
            }
            let tx = Tx::decode_exact(&raw).map_err(|_| "Invalid transaction file.")?;
            if !matches!(tx, Tx::Transfer { .. }) {
                return Err("Only signed transfers can be broadcast.".into());
            }
            tx.check_standalone(&net.chain_id)
                .map_err(|_| "Invalid testnet transaction signatures.")?;
            let Tx::Transfer { inputs, .. } = &tx else {
                unreachable!()
            };
            if v["parents"].is_null() {
                return Ok(json!({"hex":hex::encode(tx.encode()),"txid":hex::encode(tx.txid()),"inputs":inputs.iter().map(|i|hex::encode(i.prev.txid)).collect::<Vec<_>>(),"locks":conditions::locks(&tx)?,"details":inputs.iter().map(|i|Ok(json!({"txid":hex::encode(i.prev.txid),"vout":i.prev.vout,"owner":hex::encode(i.owner().map_err(|_| "Invalid input condition.")?),"afterHeight":i.after_height.to_string(),"afterBlocks":i.after_blocks}))).collect::<Result<Vec<_>>>()?} ).to_string());
            }
            let mut prev = Vec::new();
            let mut seen = HashSet::new();
            for i in inputs {
                let p = rpc(v["parents"][hex::encode(i.prev.txid)]
                    .as_str()
                    .ok_or("Missing source transaction.")?)?;
                let parent = Tx::decode_exact(
                    &hex::decode(field(&p, "hex")?).map_err(|_| "Invalid source bytes.")?,
                )
                .map_err(|_| "Invalid source transaction.")?;
                if parent.txid() != i.prev.txid
                    || parent
                        .outputs()
                        .get(i.prev.vout as usize)
                        .ok_or("Missing source output.")?
                        .pkh
                        != i.owner().map_err(|_| "Invalid input condition.")?
                {
                    return Err("Signed input does not match its source output.".into());
                }
                if seen.insert(parent.txid()) {
                    prev.push(parent);
                }
            }
            let u = Unsigned {
                network: "test".into(),
                tx,
                prev,
                paths: vec![],
                change: vec![],
            };
            let mut review = payment_review(&u)?;
            review["locks"] = conditions::locks(&u.tx)?;
            json!({"hex":hex::encode(u.tx.encode()),"txid":hex::encode(u.tx.txid()),"review":review})
        }
        _ => return Err("Unsupported local wallet operation.".into()),
    };
    Ok(out.to_string())
}
#[wasm_bindgen]
pub fn run(op: &str, input: &str) -> std::result::Result<String, JsValue> {
    execute(op, input).map_err(|e| JsValue::from_str(&e))
}
