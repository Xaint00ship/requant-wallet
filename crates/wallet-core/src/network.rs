use crate::{
    crypto::Result,
    transfer::{validate_coins, Coin},
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
pub fn validate_endpoint(endpoint: &str) -> Result<()> {
    let url = url::Url::parse(endpoint).map_err(|_| "Enter a valid HTTPS wallet API URL.")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err("The endpoint cannot contain credentials, a query or a fragment.".into());
    }
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Use HTTPS. HTTP is allowed only for a node on this device.".into());
    }
    Ok(())
}
#[derive(Clone)]
pub struct Node {
    client: Client,
    endpoint: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Info {
    pub network: String,
    pub height: u64,
    pub tip: String,
    pub peers: u64,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Event {
    pub txid: String,
    pub height: Option<u64>,
    pub confirmations: u64,
    pub time: Option<u64>,
    #[serde(serialize_with = "string_u64")]
    pub received: u64,
    #[serde(serialize_with = "string_u64")]
    pub sent: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub info: Info,
    pub confirmed: String,
    pub pending: String,
    pub maturing: String,
    pub spendable: String,
    pub events: Vec<Event>,
    pub observed_at: u64,
}
fn string_u64<S: serde::Serializer>(
    value: &u64,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}
impl Node {
    pub fn new(endpoint: &str) -> Result<Self> {
        validate_endpoint(endpoint)?;
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "Cannot initialize the node connection.")?,
            endpoint: endpoint.into(),
        })
    }
    pub async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        let mut response = self
            .client
            .post(&self.endpoint)
            .json(&json!({"method":method,"params":params}))
            .send()
            .await
            .map_err(|_| "Node connection is unavailable.")?;
        if !response.status().is_success() {
            return Err("Node connection is unavailable.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Node connection interrupted.")?
        {
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err("Node response is too large.".into());
            }
            bytes.extend_from_slice(&chunk)
        }
        let reply: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid node response.")?;
        if !reply["error"].is_null() {
            return Err("The node rejected this request.".into());
        }
        reply
            .get("result")
            .cloned()
            .ok_or("Invalid node response.".into())
    }
    pub async fn info(&self) -> Result<Info> {
        let info: Info = serde_json::from_value(self.rpc("getinfo", json!([])).await?)
            .map_err(|_| "Invalid node status.")?;
        if info.network != "test" || info.tip.len() != 64 || hex::decode(&info.tip).is_err() {
            return Err("This wallet requires the Requant testnet.".into());
        }
        let genesis = self.rpc("getblock", json!([0])).await?;
        let net = requant_consensus::params::Network::test();
        let expected = hex::encode(requant_consensus::block::genesis(&net).id(&net));
        if genesis["id"].as_str() != Some(expected.as_str()) {
            return Err("The node genesis block does not match Requant testnet.".into());
        }
        Ok(info)
    }
    pub async fn coins(&self, owner: &str) -> Result<Vec<Coin>> {
        let coins: Vec<Coin> = serde_json::from_value(self.rpc("utxos", json!([owner])).await?)
            .map_err(|_| "Invalid node output list.")?;
        validate_coins(&coins)?;
        Ok(coins)
    }
    pub async fn verify_outputs(&self, coins: &[Coin], owner: &str) -> Result<()> {
        if coins.len() > 64 {
            return Err("This transfer requires more than 64 inputs. Use a smaller amount.".into());
        }
        for coin in coins {
            let previous = self.rpc("gettx", json!([coin.txid])).await?;
            let raw = hex::decode(
                previous["hex"]
                    .as_str()
                    .ok_or("Missing source transaction.")?,
            )
            .map_err(|_| "Invalid source transaction.")?;
            let tx = requant_consensus::tx::Tx::decode_exact(&raw)
                .map_err(|_| "Invalid source transaction.")?;
            if hex::encode(tx.txid()) != coin.txid {
                return Err("Source transaction hash mismatch.".into());
            }
            let output = tx
                .outputs()
                .get(coin.vout as usize)
                .ok_or("Missing source output.")?;
            if output.value != coin.value || hex::encode(output.pkh) != owner {
                return Err("The node returned an incorrect output value or owner.".into());
            }
        }
        Ok(())
    }
    pub async fn snapshot(&self, owner: &str) -> Result<Snapshot> {
        for _ in 0..2 {
            let info = self.info().await?;
            let coins = self.coins(owner).await?;
            let events: Vec<Event> =
                serde_json::from_value(self.rpc("history", json!([owner, 100])).await?)
                    .map_err(|_| "Invalid activity response.")?;
            if self.info().await?.tip != info.tip {
                continue;
            }
            let mut confirmed = 0;
            let mut pending = 0;
            let mut maturing = 0;
            let mut spendable = 0;
            for coin in coins {
                if coin.confirmed && coin.spendable {
                    confirmed += coin.value;
                } else if !coin.confirmed {
                    pending += coin.value
                }
                if !coin.spendable {
                    maturing += coin.value
                } else if coin.confirmed {
                    spendable += coin.value
                }
            }
            return Ok(Snapshot {
                info,
                confirmed: crate::transfer::amount(confirmed),
                pending: crate::transfer::amount(pending),
                maturing: crate::transfer::amount(maturing),
                spendable: crate::transfer::amount(spendable),
                events,
                observed_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            });
        }
        Err("The chain changed while updating. Refresh the wallet.".into())
    }
}
