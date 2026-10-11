use super::{protocols::*, *};
use std::collections::{HashMap, HashSet};
pub fn inspect(v: &Value) -> Result<Value> {
    let p = parse(field(v, "package")?)?;
    if !p.is_array() && p.get("network").is_some() && p["network"] != "test" {
        return Err("Import a Requant testnet package.".into());
    }
    let rows = p
        .as_array()
        .or_else(|| p["transactions"].as_array())
        .ok_or("Import a JSON array of signed transaction hex strings, or a transactions array.")?;
    if rows.len() < 2 || rows.len() > 25 {
        return Err("A package must contain 2 to 25 transactions.".into());
    }
    let txs = rows
        .iter()
        .map(|s| tx(s.as_str().ok_or("Each transaction must be a hex string.")?))
        .collect::<Result<Vec<_>>>()?;
    if txs.iter().map(|t| t.encode().len()).sum::<usize>() > 200_000 {
        return Err("Package exceeds 200 kB.".into());
    }
    let all: HashSet<_> = txs.iter().map(Tx::txid).collect();
    if all.len() != txs.len() {
        return Err("Duplicate package transaction.".into());
    }
    let mut prev: HashMap<Hash, Tx> = HashMap::new();
    let mut spent = HashSet::new();
    let mut external = Vec::new();
    let mut reviews = Vec::new();
    let mut fees = 0u64;
    for t in &txs {
        t.check_standalone(&Network::test().chain_id)
            .map_err(|e| e.to_string())?;
        if let Some(height) = number(&v["height"]) {
            let locks = super::conditions::locks(t)?;
            let next = height.saturating_add(1);
            if next < number(&locks["activationHeight"]).unwrap_or(0)
                || next < number(&locks["afterHeight"]).unwrap_or(0)
            {
                return Err("A package transaction is not active or is still time locked.".into());
            }
        }
        let Tx::Transfer { inputs, .. } = t else {
            return Err("A package cannot contain a coinbase.".into());
        };
        let mut sources = Vec::new();
        for i in inputs {
            if !spent.insert(i.prev) {
                return Err("Package spends the same output twice.".into());
            }
            let parent = if let Some(p) = prev.get(&i.prev.txid) {
                if i.after_blocks > 0 {
                    return Err("A package child cannot use an immature relative lock.".into());
                }
                p.clone()
            } else {
                if all.contains(&i.prev.txid) {
                    return Err("Order package transactions with parents before children.".into());
                }
                external.push(json!({"txid":hex::encode(i.prev.txid),"vout":i.prev.vout.to_string(),"owner":hex::encode(i.owner().map_err(|e|e.to_string())?),"afterBlocks":i.after_blocks.to_string()}));
                if v["parents"].is_null() {
                    continue;
                }
                let raw = field(&v["parents"], &hex::encode(i.prev.txid))?;
                let r = rpc(raw)?;
                tx(field(&r, "hex")?)?
            };
            let o = parent
                .outputs()
                .get(i.prev.vout as usize)
                .ok_or("Source output is missing.")?;
            if parent.txid() != i.prev.txid || o.pkh != i.owner().map_err(|e| e.to_string())? {
                return Err("Package source owner mismatch.".into());
            }
            sources.push(parent);
        }
        if !v["parents"].is_null() {
            let r = review(t, sources)?;
            fees = fees
                .checked_add(wallet::parse_amount(field(&r, "fee")?)?)
                .ok_or("Package fee overflow.")?;
            reviews.push(r);
        }
        prev.insert(t.txid(), t.clone());
    }
    Ok(
        json!({"transactions":txs.iter().map(|t|hex::encode(t.encode())).collect::<Vec<_>>(),"txids":txs.iter().map(|t|hex::encode(t.txid())).collect::<Vec<_>>(),"external":external,"reviews":reviews,"fee":wallet::format_amount(fees),"bytes":txs.iter().map(|t|t.encode().len()).sum::<usize>()}),
    )
}
