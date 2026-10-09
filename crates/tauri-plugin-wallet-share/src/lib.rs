use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};
#[cfg(target_os = "android")]
pub struct WalletShare<R: Runtime>(tauri::plugin::PluginHandle<R>);
#[cfg(not(target_os = "android"))]
pub struct WalletShare<R: Runtime>(std::marker::PhantomData<fn() -> R>);
pub trait WalletShareExt<R: Runtime> {
    fn wallet_share(&self) -> &WalletShare<R>;
}
impl<R: Runtime, T: Manager<R>> WalletShareExt<R> for T {
    fn wallet_share(&self) -> &WalletShare<R> {
        self.state::<WalletShare<R>>().inner()
    }
}
impl<R: Runtime> WalletShare<R> {
    pub fn address(&self, address: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            self.0
                .run_mobile_plugin::<serde_json::Value>(
                    "shareAddress",
                    serde_json::json!({"address": address}),
                )
                .map(|_| ())
                .map_err(|_| "Cannot open the Android share sheet.".into())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = address;
            Err("Use Copy address on this platform.".into())
        }
    }
}
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("wallet-share")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let share = WalletShare(
                api.register_android_plugin("network.requant.wallet.share", "WalletSharePlugin")?,
            );
            #[cfg(not(target_os = "android"))]
            let share = {
                let _ = api;
                WalletShare::<R>(std::marker::PhantomData)
            };
            app.manage(share);
            Ok(())
        })
        .build()
}
