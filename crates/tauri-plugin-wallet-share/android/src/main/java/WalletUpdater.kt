package network.requant.wallet.share

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.plugin.JSObject
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// The package signer is the root of trust; a hash in an HTTPS feed alone is insufficient.
class WalletUpdater(private val activity: Activity) {
    private val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    private val installed: PackageInfo get() = activity.packageManager.getPackageInfo(activity.packageName, flags)
    private fun code(p: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong()
    private val directory = File(activity.cacheDir, "wallet-updates")
    private val apk = File(directory, "wallet.apk")
    @Volatile private var offer: JSONObject? = null

    private fun connection(address: String): HttpURLConnection {
        val url = URL(address)
        require(url.protocol == "https" && url.host == "requant.network" && url.port == -1 && url.userInfo == null) { "Untrusted update URL." }
        return (url.openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false; connectTimeout = 15_000; readTimeout = 30_000
            setRequestProperty("Cache-Control", "no-cache")
        }
    }
    @Synchronized fun check(): JSObject {
        val http = connection("https://requant.network/updates/wallet/android.json")
        val row = try {
            require(http.responseCode == 200) { "Cannot check wallet updates." }
            val bytes = http.inputStream.use { input ->
                val output = ByteArrayOutputStream(); val buffer = ByteArray(4096)
                while (output.size() <= 65_536) {
                    val n = input.read(buffer); if (n < 0) break
                    output.write(buffer, 0, n)
                }
                output.toByteArray()
            }
            require(bytes.size <= 65_536) { "Invalid update feed." }
            JSONObject(String(bytes, Charsets.UTF_8))
        } finally { http.disconnect() }
        if (row.getLong("versionCode") <= code(installed)) {
            offer = null; apk.delete()
            return JSObject().put("version", installed.versionName).put("available", false) as JSObject
        }
        val version = row.getString("version")
        require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(version)) { "Invalid update version." }
        val address = row.getString("url")
        require(URL(address).path == "/downloads/wallet/v$version-testnet/Requant-Wallet_${version}_android-arm64.apk") { "Unexpected update package." }
        require(Regex("[a-f0-9]{64}").matches(row.getString("sha256"))) { "Invalid update digest." }
        val expected = row.getLong("bytes")
        require(expected in 1..200_000_000) { "Invalid update size." }
        directory.mkdirs()
        if (!apk.exists() || apk.length() != expected || digest(apk) != row.getString("sha256")) {
            val temp = File(directory, "wallet.part")
            val download = connection(address)
            try {
                require(download.responseCode == 200) { "Cannot download wallet update." }
                download.inputStream.use { input -> temp.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024); var total = 0L
                    val started = System.nanoTime()
                    while (true) {
                        val n = input.read(buffer); if (n < 0) break
                        total += n
                        require(total <= expected && System.nanoTime() - started < 300_000_000_000L) { "Invalid or incomplete update download." }
                        output.write(buffer, 0, n)
                    }
                    require(total == expected) { "Incomplete update download." }
                } }
                require(digest(temp) == row.getString("sha256")) { "Update checksum mismatch." }
                verifyPackage(temp, row)
                require(temp.renameTo(apk)) { "Cannot save wallet update." }
            } finally { download.disconnect(); temp.delete() }
        }
        verifyPackage(apk, row)
        offer = row
        return JSObject().put("available", true).put("ready", true).put("version", version) as JSObject
    }
    private fun digest(file: File): String {
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buffer = ByteArray(64 * 1024)
            while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) } }
        return hash.digest().joinToString("") { "%02x".format(it) }
    }
    private fun signers(p: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else p.signatures
        return signatures?.map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet() ?: emptySet()
    }
    private fun verifyPackage(file: File, row: JSONObject) {
        val candidate = activity.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
            ?: error("Invalid update package.")
        require(candidate.packageName == activity.packageName && candidate.versionName == row.getString("version") &&
            code(candidate) == row.getLong("versionCode") && code(candidate) > code(installed)) { "Wrong package or outdated update." }
        val trusted = signers(installed)
        require(trusted.isNotEmpty() && signers(candidate) == trusted) { "Update signing certificate does not match this wallet." }
    }
    @Synchronized fun verifyReady() {
        val row = offer ?: error("Check for updates first.")
        require(apk.isFile && apk.length() == row.getLong("bytes") && digest(apk) == row.getString("sha256")) { "Update file changed. Check for updates again." }
        verifyPackage(apk, row)
    }
    fun install(): JSObject {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return JSObject().put("permissionRequired", true) as JSObject
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.walletupdates", apk)
        activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        })
        return JSObject().put("permissionRequired", false) as JSObject
    }
}
