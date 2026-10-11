use super::{protocols::*, *};
use requant_consensus::tx::{multi2_owner, Unlock};
use wallet::channel::{Channel, CHANNEL_FEE};
fn channel(v: &Value) -> Result<Channel> {
    let c = Channel::from_json(&Network::test(), &parse(field(v, "channel")?)?)?;
    if c.client == c.server {
        return Err("Channel client and server must use different keys.".into());
    }
    ed25519_dalek::VerifyingKey::from_bytes(&c.client).map_err(|_| "Invalid client key.")?;
    ed25519_dalek::VerifyingKey::from_bytes(&c.server).map_err(|_| "Invalid server key.")?;
    c.funding.check_shape().map_err(|e| e.to_string())?;
    let Tx::Transfer { inputs, .. } = &c.funding else {
        return Err("Invalid channel funding.".into());
    };
    if inputs.is_empty() || inputs.len() > 600 {
        return Err("Invalid channel input count.".into());
    }
    for (i, o) in inputs.iter().zip(&c.funding_owners) {
        if i.owner().map_err(|e| e.to_string())? != *o
            || !matches!(i.unlock, Unlock::Key)
            || i.anyone_can_pay
            || i.after_height != 0
            || i.after_blocks != 0
        {
            return Err("Channel funding owner or spending path mismatch.".into());
        }
    }
    Ok(c)
}
fn summary(c: &Channel) -> Value {
    let net = Network::test();
    let mut j = json_strings(c.to_json(&net));
    j["depositAmount"] = json!(wallet::format_amount(c.deposit));
    j["paidAmount"] = json!(wallet::format_amount(c.paid));
    j["remainingAmount"] = json!(wallet::format_amount(c.deposit - CHANNEL_FEE - c.paid));
    j["feeAmount"] = json!(wallet::format_amount(CHANNEL_FEE));
    j
}
fn result(c: &Channel) -> Value {
    json!({"channel":c.to_json(&Network::test()).to_string(),"details":summary(c),"inputs":if let Tx::Transfer{inputs,..}=&c.funding {inputs.iter().map(|i|hex::encode(i.prev.txid)).collect::<Vec<_>>()}else{vec![]}})
}
fn settlement_review(c: &Channel, t: &Tx) -> Result<Value> {
    let amount = c
        .deposit
        .checked_sub(CHANNEL_FEE)
        .ok_or("Invalid deposit.")?;
    Ok(
        json!({"amount":wallet::format_amount(amount),"fee":wallet::format_amount(CHANNEL_FEE),"total":wallet::format_amount(c.deposit),"outputs":t.outputs().iter().map(|o|json!({"address":address(&Network::test(),&o.pkh),"amount":wallet::format_amount(o.value),"change":false})).collect::<Vec<_>>(),"locks":super::conditions::locks(t)?}),
    )
}
fn key<'a>(ring: &'a [SigningKey], pubkey: &Hash) -> Result<&'a SigningKey> {
    ring.iter()
        .find(|k| k.verifying_key().to_bytes() == *pubkey)
        .ok_or("Selected wallet does not hold the required channel key.".into())
}
pub fn execute(op: &str, v: &Value) -> Result<Value> {
    let net = Network::test();
    if op == "channelAddress" {
        let client = hash(field(v, "client")?)?;
        let server = hash(field(v, "server")?)?;
        ed25519_dalek::VerifyingKey::from_bytes(&server)
            .map_err(|_| "Invalid server public key.")?;
        if client == server {
            return Err("Use distinct channel keys.".into());
        }
        return Ok(json!({"address":address(&net,&multi2_owner(&client,&server))}));
    }
    if op == "channelCreate" {
        let signed: Value = serde_json::from_str(&super::execute("sign", &v.to_string())?)
            .map_err(|_| "Invalid funding result.")?;
        let funding = tx(field(&signed, "hex")?)?;
        let ring = keys(v)?;
        let client_to = parse_address(&net, field(v, "clientAddress")?)
            .map_err(|_| "Invalid client address.")?;
        let client = ring
            .iter()
            .find(|k| wallet::owner_of(k) == client_to)
            .ok_or("Client address has no key in this wallet.")?;
        let server = hash(field(v, "server")?)?;
        let server_to = parse_address(&net, field(v, "serverAddress")?)
            .map_err(|_| "Invalid server address.")?;
        ed25519_dalek::VerifyingKey::from_bytes(&server)
            .map_err(|_| "Invalid server public key.")?;
        if server == client.verifying_key().to_bytes() {
            return Err("Use distinct channel keys.".into());
        }
        let owner = multi2_owner(&client.verifying_key().to_bytes(), &server);
        let expiry = num(v, "expiry")?;
        if expiry <= num(v, "height")?.saturating_add(20) {
            return Err("Expiry must be at least 21 blocks ahead.".into());
        }
        let vout = funding
            .outputs()
            .iter()
            .position(|o| o.pkh == owner)
            .ok_or("Funding does not pay this channel.")?;
        let Tx::Transfer { inputs, .. } = &funding else {
            return Err("Invalid funding.".into());
        };
        let owners = inputs
            .iter()
            .map(|i| i.owner().map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>>>()?;
        let mut c = Channel::new(
            client.verifying_key().to_bytes(),
            server,
            client_to,
            server_to,
            expiry,
            &funding,
            vout as u32,
            owners,
        )?;
        c.refund.sign(&net.chain_id, &[client]);
        c.check(&net)?;
        return Ok(result(&c));
    }
    let mut c = channel(v)?;
    match op {
        "channelInspect" => Ok(result(&c)),
        "channelFundingInputs" => Ok(
            json!({"inputs":if let Tx::Transfer{inputs,..}=&c.funding{inputs.iter().map(|i|json!({"txid":hex::encode(i.prev.txid),"vout":i.prev.vout.to_string()})).collect::<Vec<_>>()}else{vec![]}}),
        ),
        "channelAccept" => {
            let ring = keys(v)?;
            let server = key(&ring, &c.server)?;
            if !ring.iter().any(|k| wallet::owner_of(k) == c.server_to) {
                return Err("Payments would go to an address outside this wallet.".into());
            }
            if c.expiry < num(v, "height")?.saturating_add(144) {
                return Err("Server requires at least 144 blocks before refund expiry.".into());
            }
            c.refund.sign_second(&net.chain_id, 0, server);
            if !c.refund_accepted(&net) {
                return Err("Refund signature verification failed.".into());
            }
            Ok(result(&c))
        }
        "channelFundReview" | "channelFund" => {
            if !c.refund_accepted(&net) {
                return Err("Never fund before the server signs your refund.".into());
            }
            if c.expiry <= num(v, "height")?.saturating_add(20) {
                return Err("Channel expiry is too close to fund.".into());
            }
            let prev = parents(&c.funding, v)?;
            let review = review(&c.funding, prev)?;
            if op == "channelFundReview" {
                return Ok(
                    json!({"review":review,"inputs":if let Tx::Transfer{inputs,..}=&c.funding {inputs.iter().map(|i|json!({"txid":hex::encode(i.prev.txid),"vout":i.prev.vout.to_string(),"owner":hex::encode(i.owner().unwrap())})).collect::<Vec<_>>()}else{vec![]}}),
                );
            }
            let ring = keys(v)?;
            key(&ring, &c.client)?;
            if !ring.iter().any(|k| wallet::owner_of(k) == c.client_to) {
                return Err("Refund address is outside this wallet.".into());
            }
            for (i, o) in c.funding.outputs().iter().enumerate() {
                if i != c.vout as usize && !ring.iter().any(|k| wallet::owner_of(k) == o.pkh) {
                    return Err("Unexpected funding output outside your wallet.".into());
                }
            }
            let chosen = if let Tx::Transfer { inputs, .. } = &c.funding {
                inputs
                    .iter()
                    .zip(&c.funding_owners)
                    .map(|(i, o)| Spendable {
                        op: i.prev,
                        value: 0,
                        owner: *o,
                    })
                    .collect::<Vec<_>>()
            } else {
                vec![]
            };
            let map = ring
                .into_iter()
                .map(|k| (wallet::owner_of(&k), k))
                .collect();
            let mut t = c.funding.clone();
            wallet::sign_with(&net, &mut t, &chosen, &map)?;
            if t.txid() != c.funding.txid() {
                return Err("Funding identity changed.".into());
            }
            let mut out = signed(&t)?;
            out["review"] = review;
            Ok(out)
        }
        "channelPay" => {
            if !c.refund_accepted(&net) {
                return Err("Channel has not been accepted.".into());
            }
            if c.expiry <= num(v, "height")?.saturating_add(6) {
                return Err("Channel expires too soon to make another payment.".into());
            }
            let paid = wallet::parse_amount(field(v, "amount")?)?;
            if paid <= c.paid {
                return Err("Cumulative payment must increase.".into());
            }
            let ring = keys(v)?;
            let mut t = c.state(paid)?;
            t.sign(&net.chain_id, &[key(&ring, &c.client)?]);
            c.paid = paid;
            let mut out = result(&c);
            out["state"] = json!(hex::encode(t.encode()));
            out["stateTxid"] = json!(hex::encode(t.txid()));
            Ok(out)
        }
        "channelReceive" | "channelClose" => {
            let mut t = tx(field(v, "state")?)?;
            let paid = c.paid_by(&net, &t)?;
            if paid < c.paid {
                return Err("This state pays less than a previously accepted state.".into());
            }
            c.paid = paid;
            if op == "channelReceive" {
                let mut out = result(&c);
                out["state"] = json!(hex::encode(t.encode()));
                return Ok(out);
            }
            if c.expiry <= num(v, "height")?.saturating_add(1) {
                return Err(
                    "Channel refund has matured. Do not rely on closing this state.".into(),
                );
            }
            let ring = keys(v)?;
            t.sign_second(&net.chain_id, 0, key(&ring, &c.server)?);
            let mut out = signed(&t)?;
            out["details"] = summary(&c);
            out["review"] = settlement_review(&c, &t)?;
            Ok(out)
        }
        "channelRefund" => {
            if !c.refund_accepted(&net) {
                return Err("Channel refund lacks a valid server signature.".into());
            }
            if num(v, "height")?.saturating_add(1) < c.expiry {
                return Err(format!("Refund is valid from block {}.", c.expiry));
            }
            let mut out = signed(&c.refund)?;
            out["details"] = summary(&c);
            out["review"] = settlement_review(&c, &c.refund)?;
            Ok(out)
        }
        _ => Err("Unsupported channel operation.".into()),
    }
}
