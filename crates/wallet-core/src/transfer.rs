use crate::crypto::Result;
use ed25519_dalek::SigningKey;
use requant_consensus::{
    address::parse_address,
    params::{Network, MAX_AMOUNT},
    tx::{Input, OutPoint, Output, Tx},
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Coin {
    pub txid: String,
    pub vout: u32,
    pub value: u64,
    pub confirmed: bool,
    pub spendable: bool,
    pub coinbase: bool,
    pub height: Option<u64>,
}
pub fn parse_amount(text: &str) -> Result<u64> {
    if text.is_empty() || text.len() > 30 || text.trim() != text {
        return Err("Enter an amount in RQT.".into());
    }
    let parts: Vec<_> = text.split('.').collect();
    if parts.len() > 2 || parts[0].is_empty() || !parts[0].bytes().all(|c| c.is_ascii_digit()) {
        return Err("Use a decimal amount without signs or exponents.".into());
    }
    let fraction = parts.get(1).copied().unwrap_or("");
    if fraction.len() > 8 || !fraction.bytes().all(|c| c.is_ascii_digit()) {
        return Err("RQT supports up to eight decimal places.".into());
    }
    let whole = parts[0]
        .parse::<u64>()
        .map_err(|_| "Amount is too large.")?;
    let frac = format!("{fraction:0<8}")
        .parse::<u64>()
        .map_err(|_| "Invalid amount.")?;
    whole
        .checked_mul(100_000_000)
        .and_then(|x| x.checked_add(frac))
        .filter(|x| *x <= MAX_AMOUNT)
        .ok_or("Amount is too large.".into())
}
pub fn amount(value: u64) -> String {
    format!("{}.{:08}", value / 100_000_000, value % 100_000_000)
}
pub fn validate_coins(coins: &[Coin]) -> Result<()> {
    if coins.len() > 10000 {
        return Err("The wallet has too many outputs for this version.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    for c in coins {
        let tx: [u8; 32] = hex::decode(&c.txid)
            .map_err(|_| "Invalid node output.")?
            .try_into()
            .map_err(|_| "Invalid node output.")?;
        if !seen.insert((tx, c.vout)) || c.value == 0 || c.value > MAX_AMOUNT {
            return Err("The node returned invalid or duplicate outputs.".into());
        }
        total = total
            .checked_add(c.value)
            .filter(|x| *x <= MAX_AMOUNT)
            .ok_or("Node balance exceeds the consensus limit.")?;
    }
    Ok(())
}
pub fn select(coins: &[Coin], value: u64, fee: u64, allow_pending: bool) -> Result<Vec<Coin>> {
    validate_coins(coins)?;
    if value == 0 {
        return Err("Amount must be greater than zero.".into());
    }
    let need = value
        .checked_add(fee)
        .filter(|x| *x <= MAX_AMOUNT)
        .ok_or("Amount and fee exceed the consensus limit.")?;
    let mut sorted: Vec<_> = coins
        .iter()
        .filter(|c| c.spendable && (c.confirmed || allow_pending))
        .cloned()
        .collect();
    sorted.sort_by(|a, b| {
        b.value
            .cmp(&a.value)
            .then(a.txid.cmp(&b.txid))
            .then(a.vout.cmp(&b.vout))
    });
    let mut chosen = Vec::new();
    let mut total = 0;
    for c in sorted {
        if total >= need {
            break;
        }
        total += c.value;
        chosen.push(c)
    }
    if total < need {
        return Err("Insufficient spendable funds for the amount and fee.".into());
    }
    Ok(chosen)
}
pub fn sign(
    secret: &[u8; 32],
    coins: &[Coin],
    recipient: &str,
    value: u64,
    fee: u64,
) -> Result<Tx> {
    let net = Network::test();
    let to = parse_address(&net, recipient)
        .map_err(|_| "The recipient must be a valid Requant testnet address.")?;
    let key = SigningKey::from_bytes(secret);
    let selected = select(coins, value, fee, true)?;
    let total: u64 = selected.iter().map(|c| c.value).sum();
    let mut outputs = vec![Output { value, pkh: to }];
    if total > value + fee {
        outputs.push(Output {
            value: total - value - fee,
            pkh: requant_consensus::tx::pkh(&key.verifying_key().to_bytes()),
        })
    }
    let inputs = selected
        .iter()
        .map(|c| {
            Ok(Input::new(OutPoint {
                txid: hex::decode(&c.txid)
                    .map_err(|_| "Invalid transaction ID.")?
                    .try_into()
                    .map_err(|_| "Invalid transaction ID.")?,
                vout: c.vout,
            }))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut tx = Tx::Transfer { inputs, outputs };
    tx.sign(&net.chain_id, &vec![&key; selected.len()]);
    tx.check_standalone(&net.chain_id)
        .map_err(|_| "The locally signed transfer failed validation.")?;
    Ok(tx)
}
