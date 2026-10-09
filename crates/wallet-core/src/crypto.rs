use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use zeroize::Zeroizing;
pub type Result<T> = std::result::Result<T, String>;
pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::getrandom(&mut bytes).map_err(|_| "Secure randomness is unavailable")?;
    Ok(bytes)
}
pub fn new_password(password: &str) -> Result<()> {
    if password.chars().count() < 10 || password.len() > 1024 {
        return Err(
            "Use a wallet password with 10 or more characters (maximum 1024 bytes).".into(),
        );
    }
    Ok(())
}
fn derive(password: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<Zeroizing<[u8; 32]>> {
    if password.is_empty()
        || password.len() > 1024
        || !(8192..=131072).contains(&m)
        || !(1..=6).contains(&t)
        || !(1..=4).contains(&p)
        || !(8..=32).contains(&salt.len())
    {
        return Err("Unsupported wallet encryption parameters.".into());
    }
    let params =
        Params::new(m, t, p, Some(32)).map_err(|_| "Unsupported wallet encryption parameters.")?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut *key)
        .map_err(|_| "Wallet encryption failed.")?;
    Ok(key)
}
pub fn encrypt(secret: &[u8; 32], password: &str) -> Result<String> {
    let salt = random::<16>()?;
    let nonce = random::<24>()?;
    let header = "requant-key:1:argon2id:65536:3:1";
    let key = derive(password, &salt, 65536, 3, 1)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(&*key).map_err(|_| "Wallet encryption failed.")?;
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: secret,
                aad: header.as_bytes(),
            },
        )
        .map_err(|_| "Wallet encryption failed.")?;
    Ok(format!(
        "{header}:{}:{}:{}",
        hex::encode(salt),
        hex::encode(nonce),
        hex::encode(ct)
    ))
}
pub fn decrypt(text: &str, password: &str, allow_plain: bool) -> Result<Zeroizing<[u8; 32]>> {
    if text.len() > 4096 {
        return Err("The backup file is too large.".into());
    }
    let text = text.trim();
    if !text.starts_with("requant-key:") {
        if !allow_plain {
            return Err(
                "Select an encrypted Requant backup. Legacy key import must be enabled explicitly."
                    .into(),
            );
        }
        let bytes = Zeroizing::new(hex::decode(text).map_err(|_| "Invalid legacy key file.")?);
        let secret: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid legacy key file.")?;
        return Ok(Zeroizing::new(secret));
    }
    let parts: Vec<_> = text.split(':').collect();
    if parts.len() != 9 || parts[0] != "requant-key" || parts[1] != "1" || parts[2] != "argon2id" {
        return Err("Unsupported or damaged Requant backup.".into());
    }
    let number = |i: usize| {
        parts[i]
            .parse::<u32>()
            .map_err(|_| "Invalid backup encryption parameters.")
    };
    let (m, t, p) = (number(3)?, number(4)?, number(5)?);
    let salt = hex::decode(parts[6]).map_err(|_| "Damaged backup.")?;
    let nonce = hex::decode(parts[7]).map_err(|_| "Damaged backup.")?;
    let ct = hex::decode(parts[8]).map_err(|_| "Damaged backup.")?;
    if nonce.len() != 24 || ct.len() != 48 {
        return Err("Damaged backup.".into());
    }
    let key = derive(password, &salt, m, t, p)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(&*key).map_err(|_| "Wallet decryption failed.")?;
    let header = format!("requant-key:1:argon2id:{m}:{t}:{p}");
    let secret = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &ct,
                    aad: header.as_bytes(),
                },
            )
            .map_err(|_| "Wrong wallet password or damaged backup.")?,
    );
    Ok(Zeroizing::new(
        secret
            .as_slice()
            .try_into()
            .map_err(|_| "Damaged backup.")?,
    ))
}
