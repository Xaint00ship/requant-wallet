use super::{protocols::*, *};
use wallet::{btc, contracts::Condition, ln, swap, tron};
const MAKER: &str = "193.187.93.29:19390";
fn rate(v: &Value) -> Result<u64> {
    num(v, "rate").and_then(|n| {
        if (1..=1_000_000).contains(&n) {
            Ok(n)
        } else {
            Err("Invalid fee rate.".into())
        }
    })
}
fn checked_price(atoms: u64, price: u64) -> Result<u64> {
    u64::try_from((atoms as u128 * price as u128).div_ceil(100_000_000))
        .ok()
        .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
        .ok_or("Invalid maker price.".into())
}
fn validate(r: &Value) -> Result<()> {
    if r["requant_swap"] != 1 || r["network"] != "test" || r["maker"] != MAKER {
        return Err("Unsupported testnet swap.".into());
    }
    let h = swap::sha256(&hash(field(r, "secret")?)?);
    hash(field(r, "claim")?)?;
    let n = num(r, "rqt_atoms")?;
    if n == 0 || n > MAX_AMOUNT {
        return Err("Invalid RQT amount.".into());
    }
    if r["state"] == "draft" {
        return Ok(());
    }
    hash(field(r, "id")?)?;
    match field(r, "kind")? {
        "btc" => {
            let net = btc::network(field(r, "btc_network")?)?;
            if net == bitcoin::Network::Bitcoin {
                return Err("Use a Bitcoin test network with Requant testnet.".into());
            }
            let terms = swap::btc_htlc_from(&r["btc_htlc"])?;
            if terms.hash != h
                || terms.refund != btc::public_key(&hash(field(r, "btc_refund_key")?)?)?
                || num(r, "btc_sats")? == 0
            {
                return Err("Swap keys or BTC amount mismatch.".into());
            }
        }
        "ln" => {
            let inv = ln::decode_invoice(field(r, "bolt11")?)?;
            let msat = num(r, "btc_sats")?
                .checked_mul(1000)
                .ok_or("Invoice amount overflow.")?;
            if inv.payment_hash != h
                || inv.msat != Some(msat)
                || inv.prefix != ln::prefix_of(field(r, "btc_network")?)
                || inv.prefix == "lnbc"
            {
                return Err("Invoice does not match the swap.".into());
            }
        }
        "usdt" => {
            let d = tron::deployment(field(r, "tron_network")?)?;
            let t = tron::Terms::from_json(&r["terms"])?;
            if r["htlc"] != d.htlc
                || tron::to_base58(&t.token) != d.usdt
                || t.hash != h
                || tron::address_of(&hash(field(r, "tron_key")?)?)? != t.sender
                || t.amount != num(r, "units")?
            {
                return Err("TRON terms or keys mismatch.".into());
            }
        }
        _ => return Err("Unsupported swap kind.".into()),
    }
    Ok(())
}
fn public(r: &Value) -> Result<Value> {
    validate(r)?;
    let mut out = r.clone();
    for k in ["secret", "btc_refund_key", "tron_key"] {
        out.as_object_mut().unwrap().remove(k);
    }
    out["receiveAddress"] = json!(address(&Network::test(), &hash(field(r, "claim")?)?));
    out["receiveAmount"] = json!(wallet::format_amount(num(r, "rqt_atoms")?));
    Ok(json_strings(out))
}
fn saved(r: &Value, pass: &str) -> Result<Value> {
    Ok(json!({"record":seal(r,pass)?,"details":public(r)?}))
}
fn record(v: &Value) -> Result<Value> {
    let r = open(v)?;
    validate(&r)?;
    Ok(r)
}
fn block(raw: &str) -> Result<tron::RefBlock> {
    let b = parse(raw)?;
    let h = &b["block_header"]["raw_data"];
    Ok(tron::RefBlock {
        number: num(h, "number")?,
        id: hash(field(&b, "blockID")?)?,
        timestamp_ms: num(h, "timestamp")?,
    })
}
pub fn execute(op: &str, v: &Value) -> Result<Value> {
    match op {
        "swapEnvelope" => {
            envelope(field(v, "record")?)?;
            Ok(json!({"valid":true}))
        }
        "swapDraft" => {
            let info = rpc(field(v, "info")?)?;
            if info["rqt_network"] != "test" {
                return Err("Maker is on another Requant network.".into());
            }
            let atoms = wallet::parse_amount(field(v, "amount")?)?;
            if atoms < num(&info, "min_rqt")? || atoms > num(&info, "max_rqt")? {
                return Err("Amount is outside the maker's swap limits.".into());
            }
            let kind = field(v, "kind")?;
            let meta = metadata(field(v, "file")?)?;
            if meta["watchOnly"] == true {
                return Err("Select a wallet that can claim the RQT.".into());
            }
            let claim = parse_address(&Network::test(), field(&meta, "address")?)
                .map_err(|_| "Invalid receiving address.")?;
            let secret = Zeroizing::new(random::<32>()?);
            let key = Zeroizing::new(random::<32>()?);
            let hash = swap::sha256(secret.as_ref());
            let mut r = json!({"requant_swap":1,"state":"draft","kind":kind,"network":"test","maker":MAKER,"rqt_atoms":atoms,"claim":hex::encode(claim),"secret":hex::encode(*secret),"info":info});
            let request = match kind {
                "btc" | "ln" => {
                    let net = btc::network(field(&info, "btc_network")?)?;
                    if net == bitcoin::Network::Bitcoin {
                        return Err(
                            "Do not use mainnet BTC for valueless RQT testnet coins.".into()
                        );
                    }
                    r["btc_network"] = info["btc_network"].clone();
                    r["max_price"] = json!(checked_price(atoms, num(&info, "sats_per_rqt")?)?);
                    if kind == "ln" {
                        if info["lightning"] != true {
                            return Err("Maker does not support Lightning.".into());
                        }
                        json!({"method":"swap_create_ln","params":[atoms,hex::encode(hash),address(&Network::test(),&claim)]})
                    } else {
                        r["btc_refund_key"] = json!(hex::encode(*key));
                        json!({"method":"swap_create","params":[atoms,hex::encode(hash),btc::public_key(&key)?.to_string(),address(&Network::test(),&claim)]})
                    }
                }
                "usdt" => {
                    let i = &info["usdt"];
                    let d = tron::deployment(field(i, "network")?)?;
                    if i["htlc"] != d.htlc || i["token"] != d.usdt {
                        return Err("Maker advertises an unknown TRON deployment.".into());
                    }
                    r["tron_network"] = i["network"].clone();
                    r["tron_key"] = json!(hex::encode(*key));
                    r["max_price"] = json!(checked_price(atoms, num(i, "units_per_rqt")?)?);
                    json!({"method":"swap_create_usdt","params":[atoms,hex::encode(hash),tron::to_base58(&tron::address_of(&key)?),address(&Network::test(),&claim)]})
                }
                _ => return Err("Choose BTC, Lightning or USDT.".into()),
            };
            r["request"] = request.clone();
            let mut out = saved(&r, field(v, "password")?)?;
            out["request"] = json!(request.to_string());
            Ok(out)
        }
        "swapOffer" => {
            let mut r = record(v)?;
            if r["state"] != "draft" {
                return Err("This swap already has an offer.".into());
            }
            let o = rpc(field(v, "offer")?)?;
            let hash = swap::sha256(&hash(field(&r, "secret")?)?);
            hash_id(&o)?;
            r["id"] = o["id"].clone();
            match field(&r, "kind")? {
                "btc" => {
                    let net = btc::network(field(&r, "btc_network")?)?;
                    let h = swap::check_offer(
                        &o,
                        &hash,
                        &btc::public_key(&hash_key(&r, "btc_refund_key")?)?,
                        net,
                        num(&r, "max_price")?,
                    )?;
                    if h.claim.to_string() != field(&r["info"], "btc_pubkey")? {
                        return Err("Maker claim key changed.".into());
                    }
                    let now = num(&o, "created_btc_height")?;
                    if h.timeout as u64 != now + swap::BTC_TIMEOUT_BLOCKS as u64 {
                        return Err("Unexpected BTC refund timeout.".into());
                    }
                    r["btc_htlc"] = swap::btc_htlc_json(&h, net);
                    r["btc_sats"] = o["btc_sats"].clone();
                    r["funding_deadline"] = json!(now + 12);
                }
                "ln" => {
                    let inv = ln::decode_invoice(field(&o, "bolt11")?)?;
                    let sats = num(&o, "btc_sats")?;
                    let now = num(v, "now")?;
                    if sats == 0
                        || sats > num(&r, "max_price")?
                        || inv.msat != sats.checked_mul(1000)
                        || inv.payment_hash != hash
                        || inv.prefix != ln::prefix_of(field(&r, "btc_network")?)
                        || inv.timestamp.saturating_add(inv.expiry) <= now + 30
                    {
                        return Err(
                            "Maker invoice hash, amount, network or expiry is invalid.".into()
                        );
                    }
                    r["bolt11"] = o["bolt11"].clone();
                    r["btc_sats"] = json!(sats);
                    r["funding_deadline"] = json!(inv.timestamp + inv.expiry);
                }
                "usdt" => {
                    let key = hash_key(&r, "tron_key")?;
                    let d = tron::deployment(field(&r, "tron_network")?)?;
                    let now = num(v, "now")?;
                    let terms = swap::check_token_offer(
                        &o,
                        field(&r, "tron_network")?,
                        &hash,
                        &tron::address_of(&key)?,
                        num(&r, "max_price")?,
                        now,
                    )?;
                    let deadline = num(&o, "funding_deadline")?;
                    if tron::to_base58(&terms.receiver) != field(&r["info"]["usdt"], "receiver")?
                        || deadline <= now
                        || deadline > now + swap::TOKEN_FUNDING_SECS
                    {
                        return Err("Maker receiver or funding window changed.".into());
                    }
                    r["htlc"] = json!(d.htlc);
                    r["terms"] = terms.json();
                    r["units"] = json!(terms.amount);
                    r["funding_deadline"] = json!(deadline);
                }
                _ => return Err("Unsupported swap.".into()),
            }
            r["state"] = json!("offered");
            r.as_object_mut().unwrap().remove("request");
            saved(&r, field(v, "password")?)
        }
        "swapInspect" => {
            let r = record(v)?;
            public(&r)
        }
        "swapImport" => {
            let mut r = parse(field(v, "plain")?)?;
            if r.get("kind").is_none() {
                r["kind"] = json!("btc");
            }
            r["state"] = json!("offered");
            validate(&r)?;
            saved(&r, field(v, "password")?)
        }
        "swapStatus" | "swapClaimPrepare" => {
            let r = record(v)?;
            let st = rpc(field(v, "status")?)?;
            let c = if !st["rqt_htlc"].is_null() {
                let h = swap::rqt_htlc_from(&st["rqt_htlc"])?;
                swap::check_lock(
                    &h,
                    &swap::sha256(&hash_key(&r, "secret")?),
                    &hash_key(&r, "claim")?,
                )?;
                Some(Condition::Htlc(h))
            } else {
                None
            };
            if op == "swapStatus" {
                return Ok(
                    json!({"status":json_strings(st),"condition":c.map(|c|c.to_json(&Network::test()))}),
                );
            }
            let c = c.ok_or("Maker has not locked the RQT yet.")?;
            let Condition::Htlc(h) = c else {
                unreachable!()
            };
            if h.timeout <= num(v, "height")?.saturating_add(6) {
                return Err("RQT refund is too close. Do not reveal the swap secret.".into());
            }
            let mut args = v.clone();
            args["condition"] = c.to_json(&Network::test());
            args["path"] = json!("claim");
            args["preimage"] = r["secret"].clone();
            args["recipient"] = json!(address(&Network::test(), &hash_key(&r, "claim")?));
            args["anyoneCanPay"] = json!(false);
            let p = super::conditions::execute("contractPrepare", &args)?;
            if let Some(text) = p["payment"].as_str() {
                let payment = parse(text)?;
                let tx = tx(field(&payment, "tx")?)?;
                let value = tx.outputs()[0].value;
                let fee = wallet::parse_amount(field(&p["review"], "fee")?)?;
                if value.checked_add(fee) != Some(num(&r, "rqt_atoms")?) {
                    return Err("The RQT lock amount differs from the quote.".into());
                }
                let id = field(&st, "rqt_lock_txid")?;
                if let Tx::Transfer { inputs, .. } = &tx {
                    if inputs.iter().any(|i| hex::encode(i.prev.txid) != id) {
                        return Err("Unexpected RQT funding transaction.".into());
                    }
                }
            }
            Ok(p)
        }
        "swapBtcRefund" => {
            let r = record(v)?;
            if r["kind"] != "btc" {
                return Err("Only on-chain BTC swaps have a Bitcoin refund transaction.".into());
            }
            let net = btc::network(field(&r, "btc_network")?)?;
            let h = swap::btc_htlc_from(&r["btc_htlc"])?;
            let to = field(v, "recipient")?
                .parse::<bitcoin::Address<_>>()
                .map_err(|_| "Invalid Bitcoin address.")?
                .require_network(net)
                .map_err(|_| "Bitcoin address is on another network.")?;
            let op = bitcoin::OutPoint {
                txid: field(v, "txid")?
                    .parse()
                    .map_err(|_| "Invalid Bitcoin funding txid.")?,
                vout: u32::try_from(num(v, "vout")?)
                    .map_err(|_| "Invalid Bitcoin output index.")?,
            };
            let sats = num(v, "sats")?;
            if sats == 0 || sats > 2_100_000_000_000_000 {
                return Err("Invalid Bitcoin funding output value.".into());
            }
            let tx = h.spend(
                op,
                sats,
                btc::Path::Refund,
                &to,
                rate(v)?,
                &hash_key(&r, "btc_refund_key")?,
            )?;
            Ok(
                json!({"hex":bitcoin::consensus::encode::serialize_hex(&tx),"txid":tx.compute_txid().to_string(),"review":{"recipient":to.to_string(),"amount":tx.output[0].value.to_sat().to_string(),"fee":(sats-tx.output[0].value.to_sat()).to_string(),"refundHeight":h.timeout}}),
            )
        }
        "swapTronQueries" => {
            let r = record(v)?;
            if r["kind"] != "usdt" {
                return Err("This is not a TRON swap.".into());
            }
            let t = tron::Terms::from_json(&r["terms"])?;
            let htlc = tron::parse(field(&r, "htlc")?)?;
            let call = |contract, data: Vec<u8>| json!({"owner_address":tron::to_base58(&t.sender),"contract_address":tron::to_base58(&contract),"data":hex::encode(data),"visible":true});
            Ok(
                json!({"balance":call(t.token,tron::balance_of_call(&t.sender)),"allowance":call(t.token,tron::allowance_call(&t.sender,&htlc)),"state":call(htlc,t.state_call()),"account":{"address":tron::to_base58(&t.sender),"visible":true}}),
            )
        }
        "swapTronRead" => {
            let decode = |k: &str| -> Result<Vec<u8>> {
                let r = parse(field(v, k)?)?;
                if r["result"]["result"] != true {
                    return Err("TRON contract read failed.".into());
                }
                hex::decode(
                    r["constant_result"][0]
                        .as_str()
                        .ok_or("Missing TRON result.")?,
                )
                .map_err(|_| "Invalid TRON result.".into())
            };
            let bal = tron::decode_u64(&decode("balance")?)?;
            let state = tron::decode_u64(&decode("state")?)?;
            let allowance = decode("allowance")?;
            let account = parse(field(v, "account")?)?;
            let resource = parse(field(v, "resource")?)?;
            Ok(
                json!({"balance":bal.to_string(),"state":state.to_string(),"approved":allowance.len()>=32&&allowance[..24].iter().any(|b|*b!=0),"trx":number(&account["balance"]).unwrap_or(0).to_string(),"energy":number(&resource["EnergyLimit"]).unwrap_or(0).saturating_sub(number(&resource["EnergyUsed"]).unwrap_or(0)).to_string()}),
            )
        }
        "swapTronSign" => {
            let r = record(v)?;
            if r["kind"] != "usdt" {
                return Err("This is not a TRON swap.".into());
            }
            let t = tron::Terms::from_json(&r["terms"])?;
            let key = Zeroizing::new(hash_key(&r, "tron_key")?);
            let b = block(field(v, "block")?)?;
            if b.timestamp_ms / 1000 + 120 < num(v, "now")?
                || b.timestamp_ms / 1000 > num(v, "now")? + 120
            {
                return Err("TRON block is stale. Refresh before signing.".into());
            }
            let htlc = tron::parse(field(&r, "htlc")?)?;
            let action = field(v, "action")?;
            let state = num(v, "state")?;
            let held = num(v, "balance")?;
            let mut recipient = tron::to_base58(&htlc);
            let mut amount = t.amount;
            let (contract, data, fee) = match action {
                "approve" | "lock" => {
                    if state != 0
                        || b.timestamp_ms / 1000 >= num(&r, "funding_deadline")?
                        || held < t.amount
                    {
                        return Err("Swap already locked, funding deadline passed, or USDT balance is insufficient.".into());
                    }
                    if action == "approve" {
                        (t.token, tron::approve_max_call(&htlc), 30_000_000)
                    } else {
                        if v["approved"] != true {
                            return Err(
                                "Wait for the approval to become irreversible before locking."
                                    .into(),
                            );
                        }
                        (htlc, t.lock_call(), 60_000_000)
                    }
                }
                "refund" => {
                    if state != 1 || b.timestamp_ms / 1000 < t.timeout {
                        return Err("USDT refund is not available yet.".into());
                    }
                    (htlc, t.refund_call(), 30_000_000)
                }
                "withdraw" => {
                    if held == 0 {
                        return Err("Swap address has no USDT to withdraw.".into());
                    }
                    let to = tron::parse(field(v, "recipient")?)?;
                    recipient = tron::to_base58(&to);
                    amount = held;
                    (t.token, tron::transfer_call(&to, held), 30_000_000)
                }
                "returnFees" => {
                    let st = rpc(field(v, "status")?)?;
                    if st["fees"]["way"] != "trx" {
                        return Err("Maker did not lend TRX.".into());
                    }
                    let back = num(v, "trx")?
                        .saturating_sub(300_000)
                        .min(num(&st["fees"], "sun")?);
                    if back < 100_000 {
                        return Err("No unused maker TRX to return.".into());
                    }
                    let (signed, id) =
                        tron::sign(&tron::transfer(&b, &t.sender, &t.receiver, back), &key)?;
                    return Ok(
                        json!({"hex":hex::encode(signed),"txid":hex::encode(id),"review":{"action":action,"recipient":tron::to_base58(&t.receiver),"amount":tron::format_units(back),"asset":"TRX","maxFee":"0.3 TRX reserve"}}),
                    );
                }
                _ => return Err("Unsupported TRON action.".into()),
            };
            let (signed, id) =
                tron::sign(&tron::trigger(&b, &t.sender, &contract, &data, fee), &key)?;
            Ok(
                json!({"hex":hex::encode(signed),"txid":hex::encode(id),"review":{"action":action,"recipient":recipient,"amount":tron::format_units(amount),"asset":"USDT · Nile","maxFee":format!("{} TRX",fee/1_000_000),"expires":(b.timestamp_ms+60_000).to_string()}}),
            )
        }
        _ => Err("Unsupported swap operation.".into()),
    }
}
fn hash_key(v: &Value, k: &str) -> Result<Hash> {
    hash(field(v, k)?)
}
fn hash_id(v: &Value) -> Result<Hash> {
    hash_key(v, "id")
}
