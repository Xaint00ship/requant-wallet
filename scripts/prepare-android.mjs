import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
const base = "src-tauri/gen/android";
const gradle = join(base, "app/build.gradle.kts");
let source = readFileSync(gradle, "utf8");
source = source
  .replace(/compileSdk\s*=\s*\d+/, "compileSdk = 36")
  .replace(/targetSdk\s*=\s*\d+/, "targetSdk = 36");
if (!process.env.ANDROID_KEY_BASE64 || !process.env.ANDROID_KEY_PASSWORD)
  throw new Error("Android signing secrets are required.");
const key = join(
  process.env.RUNNER_TEMP || process.env.TMPDIR || "/tmp",
  "requant-wallet-android.jks",
);
writeFileSync(key, Buffer.from(process.env.ANDROID_KEY_BASE64, "base64"), {
  mode: 0o600,
});
writeFileSync(
  join(base, "keystore.properties"),
  `keyAlias=requant-wallet\npassword=${process.env.ANDROID_KEY_PASSWORD}\nstoreFile=${key}\n`,
  { mode: 0o600 },
);
if (!source.includes("buildTypes {"))
  throw new Error("Unexpected Android Gradle template.");
source = "import java.io.FileInputStream\nimport java.util.Properties\n" + source;
source = source.replace(
  "buildTypes {",
  `signingConfigs {
        create("release") {
            val props = Properties()
            props.load(FileInputStream(rootProject.file("keystore.properties")))
            keyAlias = props["keyAlias"] as String
            keyPassword = props["password"] as String
            storeFile = file(props["storeFile"] as String)
            storePassword = props["password"] as String
        }
    }
    buildTypes {`,
);
source = source.replace(
  'getByName("release") {',
  'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")',
);
if (!source.includes('signingConfig = signingConfigs.getByName("release")'))
  throw new Error("Unexpected release build template.");
writeFileSync(gradle, source);
const manifest = join(base, "app/src/main/AndroidManifest.xml");
let xml = readFileSync(manifest, "utf8").replace(
  /android:allowBackup="[^"]*"/,
  'android:allowBackup="false"',
);
if (!xml.includes("android:allowBackup="))
  xml = xml.replace("<application", '<application android:allowBackup="false"');
xml = xml.replace(
  /android:usesCleartextTraffic="[^"]*"/,
  'android:usesCleartextTraffic="false"',
);
if (!xml.includes("android:usesCleartextTraffic="))
  xml = xml.replace(
    "<application",
    '<application android:usesCleartextTraffic="false"',
  );
writeFileSync(manifest, xml);
// The CLI's Android init creates generic icons. Replace every generated density.
import { readdirSync, existsSync } from "node:fs";
const from = "src-tauri/icons/android";
const to = join(base, "app/src/main/res");
for (const dir of readdirSync(from)) {
  if (!dir.startsWith("mipmap-")) continue;
  for (const file of readdirSync(join(from, dir))) {
    const dest = join(to, dir, file);
    if (existsSync(dest)) copyFileSync(join(from, dir, file), dest);
  }
}
console.log(
  "Android release signing, local-storage policy and Requant icons configured.",
);
