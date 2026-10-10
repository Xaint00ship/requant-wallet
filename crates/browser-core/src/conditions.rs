//! Portable contract operations. Every review checks actual parent bytes; no RPC or storage here.
use super::*;
use ed25519_dalek::{Signature, VerifyingKey};
use requant_consensus::tx::Unlock;
use wallet::contracts::{self, Condition, Signers};

fn condition(v: &Value) -> Result<Condition> {
    let descriptor = if let Some(s) = v["condition"].as_str() {
        serde_json::from_str(s).map_err(|_| "Invalid condition file.")?
    } else {
        v["condition"].clone()
    };
    Condition::from_json(&Network::test(), &descriptor)
}
fn decode(s: &str) -> Result<Tx> {
    if s.len() > 200_000 {
        return Err("Transaction exceeds 100 kB.".into());
    }
    Tx::decode_exact(&hex::decode(s).map_err(|_| "Invalid transaction hex.")?)
        .map_err(|_| "Invalid condition transaction.".into())
}
fn inputs(tx: &Tx) -> Result<&[requant_consensus::tx::Input]> {
    match tx {
        Tx::Transfer { inputs, .. } if !inputs.is_empty() && inputs.len() <= 600 => Ok(inputs),
        _ => Err("Use a transfer with 1 to 600 inputs.".into()),
    }
}
fn parents(tx: &Tx, v: &Value, owner: Option<Hash>) -> Result<Vec<Tx>> {
    let mut prev = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for i in inputs(tx)? {
        let id = hex::encode(i.prev.txid);
        let text = v["parents"][&id]
            .as_str()
            .ok_or("Missing source transaction. Load its parents online before signing offline.")?;
        let p = rpc(text)?;
        let parent = decode(field(&p, "hex")?)?;
        parent
            .check_standalone(&Network::test().chain_id)
            .map_err(|_| "Invalid source signatures.")?;
        let out = parent
            .outputs()
            .get(i.prev.vout as usize)
            .ok_or("Missing source output.")?;
        let expected = match owner {
            Some(o) => o,
            None => i.owner().map_err(|_| "Invalid spending condition.")?,
        };
        if parent.txid() != i.prev.txid || out.pkh != expected {
            return Err("Source transaction or condition owner mismatch.".into());
        }
        total = total
            .checked_add(out.value)
            .filter(|n| *n <= MAX_AMOUNT)
            .ok_or("Source amount overflow.")?;
        if seen.insert(i.prev.txid) {
            prev.push(parent);
        }
    }
    Ok(prev)
}
pub fn locks(tx: &Tx) -> Result<Value> {
    let i = inputs(tx)?;
    Ok(
        json!({"activationHeight":if tx.uses_contracts(){Network::test().contracts_height}else if tx.is_v2(){Network::test().conditions_height}else{0},
        "afterHeight":i.iter().map(|i|i.after_height).max().unwrap_or(0).to_string(),
        "afterBlocks":i.iter().map(|i|i.after_blocks).max().unwrap_or(0),
        "anyoneCanPay":i.iter().any(|i|i.anyone_can_pay),
        "revealsSecret":i.iter().any(|i|matches!(i.unlock,Unlock::HtlcClaim{..}|Unlock::RevocableClaim{..}))}),
    )
}
fn review(tx: &Tx, prev: Vec<Tx>) -> Result<Value> {
    tx.check_shape()
        .map_err(|_| "Invalid transfer amounts or duplicate inputs.")?;
    let u = Unsigned {
        network: "test".into(),
        tx: tx.clone(),
        prev,
        paths: vec![],
        change: vec![],
    };
    let mut r = payment_review(&u)?;
    r["locks"] = locks(tx)?;
    r["bytes"] = json!(tx.encode().len());
    Ok(r)
}
fn keyring(v: &Value) -> Result<Vec<SigningKey>> {
    let text = field(v, "file")?;
    let j: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
    let pass = Zeroizing::new(field(v, "password")?.to_owned());
    if let Some((encrypted, owner)) = legacy(&j)? {
        let key = Zeroizing::new(
            wallet::decrypt_key(&encrypted, Some(&pass)).map_err(|_| "Wrong password.")?,
        );
        let key = SigningKey::from_bytes(&key);
        if wallet::owner_of(&key) != owner {
            return Err("Key metadata mismatch.".into());
        }
        Ok(vec![key])
    } else {
        let (w, seed) = unlocked(text, &pass)?;
        Ok(w.keyring(&seed).into_values().collect())
    }
}
fn package(v: &Value) -> Result<Value> {
    let text = field(v, "payment")?;
    if text.len() > 8 * 1024 * 1024 {
        return Err("Condition payment file is too large.".into());
    }
    let p: Value = serde_json::from_str(text).map_err(|_| "Invalid condition payment file.")?;
    if p["network"] != "test" || (p["requant_contract_payment"] != 1 && p["requant_partial"] != 1) {
        return Err("Import a Requant testnet condition payment or partial signature file.".into());
    }
    Ok(p)
}
fn verify_partial(tx: &Tx, second: Hash) -> Result<()> {
    tx.check_shape()
        .map_err(|_| "Invalid partial payment shape.")?;
    for (k, i) in inputs(tx)?.iter().enumerate() {
        let Unlock::Multi2 { pubkey2, sig2 } = &i.unlock else {
            return Err("A partial file must contain only 2-of-2 inputs.".into());
        };
        if *pubkey2 != second || *sig2 != [0; 64] {
            return Err("Partial file second key or signature mismatch.".into());
        }
        i.owner().map_err(|_| "Invalid partial condition.")?;
        VerifyingKey::from_bytes(&i.pubkey)
            .map_err(|_| "Invalid first public key.")?
            .verify_strict(
                &tx.input_sighash(&Network::test().chain_id, &tx.txid(), k),
                &Signature::from_bytes(&i.sig),
            )
            .map_err(|_| "The first signature is invalid. Do not cosign this file.")?;
    }
    Ok(())
}
pub fn execute(op: &str, v: &Value) -> Result<Value> {
    let net = Network::test();
    match op {
        "secret" => {
            let secret = Zeroizing::new(random::<32>()?);
            Ok(
                json!({"secret":hex::encode(*secret),"hash":hex::encode(contracts::sha256(secret.as_ref()))}),
            )
        }
        "pubkey" => {
            let keys = keyring(v)?;
            let owner = contracts::who(&net, field(v, "address")?)?;
            let key = keys
                .iter()
                .find(|k| wallet::owner_of(k) == owner)
                .ok_or("This address has no signing key in the wallet.")?;
            Ok(
                json!({"address":address(&net,&owner),"pubkey":hex::encode(key.verifying_key().to_bytes())}),
            )
        }
        "condition" => {
            let c = if let Some(words) = v["words"].as_array() {
                let words = words
                    .iter()
                    .map(|s| s.as_str().ok_or("Invalid condition field."))
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Condition::from_words(&net, &words)?
            } else {
                condition(v)?
            };
            if let Condition::Multi2 { first, second } = c {
                VerifyingKey::from_bytes(&first).map_err(|_| "Invalid first public key.")?;
                VerifyingKey::from_bytes(&second).map_err(|_| "Invalid second public key.")?;
            }
            Ok(
                json!({"condition":c.to_json(&net),"file":serde_json::to_string_pretty(&c.to_json(&net)).unwrap(),"owner":hex::encode(c.owner()),"activationHeight":if matches!(c,Condition::Delayed(_)|Condition::Revocable(_)){net.contracts_height}else{net.conditions_height}}),
            )
        }
        "contractPrepare" => {
            let c = condition(v)?;
            let path = field(v, "path")?;
            c.signers(path)?;
            let rate = number(&v["rate"])
                .filter(|r| *r > 0 && *r <= 1_000_000)
                .ok_or("Invalid fee rate.")?;
            let to = requant_consensus::address::parse_address(&net, field(v, "recipient")?)
                .map_err(|_| "Enter a complete testnet recipient address.")?;
            let preimage = v["preimage"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(hash)
                .transpose()?;
            // Confirmed only, including outputs whose relative condition is not mature yet.
            let mut batches = v["coins"].clone();
            for batch in batches
                .as_array_mut()
                .ok_or("Invalid condition output list.")?
            {
                if field(batch, "owner")? != hex::encode(c.owner()) {
                    return Err("Coins belong to another condition.".into());
                }
                let mut rows = rpc(field(batch, "raw")?)?;
                for row in rows.as_array_mut().ok_or("Invalid coins.")? {
                    row["spendable"] = json!(row["confirmed"] == true);
                }
                batch["raw"] = json!(json!({"result":rows,"error":null}).to_string());
            }
            let coins = coins(&batches)?;
            if coins.is_empty() || coins.len() > 600 {
                return Err("A condition payment needs 1 to 600 confirmed outputs.".into());
            }
            let list = coins.iter().map(|c| (c.op, c.value)).collect::<Vec<_>>();
            let (mut tx, fee) = contracts::spend(
                &c,
                path,
                &list,
                &to,
                rate,
                preimage,
                v["anyoneCanPay"] == true,
            )?;
            if let Condition::Multi2 { first, .. } = c {
                if let Tx::Transfer { inputs, .. } = &mut tx {
                    for i in inputs {
                        i.pubkey = first;
                    }
                }
            }
            if tx.encode().len() > 100_000 {
                return Err("Condition payment exceeds 100 kB. Spend fewer outputs.".into());
            }
            if v["parents"].is_null() {
                return Ok(
                    json!({"inputs":coins.iter().map(|c|json!({"txid":hex::encode(c.op.txid)})).collect::<Vec<_>>()}),
                );
            }
            let prev = parents(&tx, v, Some(c.owner()))?;
            for coin in &coins {
                let value = prev
                    .iter()
                    .find(|p| p.txid() == coin.op.txid)
                    .and_then(|p| p.outputs().get(coin.op.vout as usize))
                    .ok_or("Missing source output.")?
                    .value;
                if value != coin.value {
                    return Err("Node amount differs from verified source bytes.".into());
                }
            }
            let r = review(&tx, prev)?;
            if r["fee"] != wallet::format_amount(fee) {
                return Err("Fee mismatch.".into());
            }
            let p = json!({"requant_contract_payment":1,"network":"test","condition":c.to_json(&net),"path":path,"tx":hex::encode(tx.encode()),"parents":v["parents"]});
            Ok(json!({"payment":serde_json::to_string_pretty(&p).unwrap(),"review":r}))
        }
        "contractInspect" | "contractSign" => {
            let mut p = package(v)?;
            let mut tx = decode(field(&p, "tx")?)?;
            if p["parents"].is_null() {
                p["parents"] = v["parents"].clone();
            }
            let partial = p["requant_partial"] == 1;
            let c = if partial { None } else { Some(condition(&p)?) };
            let signers = if let Some(c) = c {
                let path = field(&p, "path")?;
                let s = c.signers(path)?;
                for i in inputs(&tx)? {
                    let preimage = match i.unlock {
                        Unlock::HtlcClaim { preimage, .. }
                        | Unlock::RevocableClaim { preimage, .. } => Some(preimage),
                        _ => None,
                    };
                    let mut expected = c.input(i.prev, path, preimage)?;
                    expected.pubkey = i.pubkey;
                    expected.sig = i.sig;
                    expected.anyone_can_pay = i.anyone_can_pay;
                    if &expected != i || i.sig != [0; 64] {
                        return Err(
                            "Transaction does not match its condition and unsigned path.".into(),
                        );
                    }
                    if let Signers::Both(first, _) = s {
                        if i.pubkey != first {
                            return Err("First key mismatch.".into());
                        }
                    } else if i.pubkey != [0; 32] {
                        return Err("Unexpected signing key in unsigned file.".into());
                    }
                }
                s
            } else {
                let second = hash(field(&p, "second")?)?;
                verify_partial(&tx, second)?;
                Signers::Both(inputs(&tx)?[0].pubkey, second)
            };
            if p["parents"].is_null() {
                return Ok(
                    json!({"inputs":inputs(&tx)?.iter().map(|i|hex::encode(i.prev.txid)).collect::<Vec<_>>()}),
                );
            }
            let prev = parents(&tx, &p, c.map(|c| c.owner()))?;
            let mut r = review(&tx, prev)?;
            r["kind"] = json!(c.map(|c| c.kind()).unwrap_or("multi2"));
            r["path"] = p["path"].clone();
            r["second"] = p["second"].clone();
            if op == "contractInspect" {
                return Ok(
                    json!({"payment":serde_json::to_string_pretty(&p).unwrap(),"review":r,"partial":partial}),
                );
            }
            let keys = keyring(v)?;
            let n = inputs(&tx)?.len();
            if partial {
                let Signers::Both(_, second) = signers else {
                    unreachable!()
                };
                let key = keys
                    .iter()
                    .find(|k| k.verifying_key().to_bytes() == second)
                    .ok_or("This wallet does not hold the second key.")?;
                for i in 0..n {
                    tx.sign_second(&net.chain_id, i, key);
                }
            } else {
                let first = keys
                    .iter()
                    .find(|k| contracts::role(&signers, &k.verifying_key().to_bytes()).0)
                    .ok_or("This wallet has no key for the selected spending path.")?;
                tx.sign(&net.chain_id, &vec![first; n]);
                if let Signers::Both(_, second) = signers {
                    if let Some(k) = keys.iter().find(|k| k.verifying_key().to_bytes() == second) {
                        for i in 0..n {
                            tx.sign_second(&net.chain_id, i, k);
                        }
                    } else {
                        verify_partial(&tx, second)?;
                        let p = json!({"requant_partial":1,"network":"test","tx":hex::encode(tx.encode()),"second":hex::encode(second),"parents":p["parents"]});
                        return Ok(
                            json!({"partial":serde_json::to_string_pretty(&p).unwrap(),"review":r}),
                        );
                    }
                }
            }
            tx.check_standalone(&net.chain_id)
                .map_err(|_| "Signed condition payment failed validation.")?;
            parents(&tx, &p, None)?;
            Ok(json!({"hex":hex::encode(tx.encode()),"txid":hex::encode(tx.txid()),"review":r}))
        }
        _ => Err("Unsupported condition operation.".into()),
    }
}
