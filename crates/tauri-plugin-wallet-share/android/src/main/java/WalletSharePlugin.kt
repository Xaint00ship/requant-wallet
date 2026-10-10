package network.requant.wallet.share
import android.app.Activity
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
@InvokeArg
class AddressArgs { lateinit var address: String }
@TauriPlugin
class WalletSharePlugin(private val activity: Activity): Plugin(activity) {
    private val updates = WalletUpdater(activity)
    @Command
    fun checkUpdate(invoke: Invoke) {
        Thread {
            try { invoke.resolve(updates.check()) }
            catch (error: Exception) { invoke.reject(error.message ?: "Cannot check wallet updates.") }
        }.start()
    }
    @Command
    fun installUpdate(invoke: Invoke) {
        Thread {
            try {
                updates.verifyReady()
                activity.runOnUiThread {
                    try { invoke.resolve(updates.install()) }
                    catch (error: Exception) { invoke.reject("Cannot open the Android update installer.") }
                }
            } catch (error: Exception) { invoke.reject(error.message ?: "Update verification failed.") }
        }.start()
    }
    @Command
    fun shareAddress(invoke: Invoke) {
        val address = invoke.parseArgs(AddressArgs::class.java).address
        if (address.length > 120 || !address.startsWith("trq1")) {
            invoke.reject("Invalid testnet address.")
            return
        }
        try {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, address)
            }
            activity.startActivity(Intent.createChooser(send, "Share Requant testnet address"))
            invoke.resolve(JSObject())
        } catch (error: Exception) {
            invoke.reject("Cannot open the Android share sheet.")
        }
    }
}
