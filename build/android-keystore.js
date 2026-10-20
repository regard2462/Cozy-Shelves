// Makes the release key of the Android app ONCE, outside the repository, with a password of its own that is written
// only into the keystore.properties next to it (android/app/build.gradle.kts reads that file). Every later release
// must be signed with this same key: keep the folder safe and never commit it (.android-signing/ is ignored).
//   node build/android-keystore.js [--dir <folder>]     default <repository>/.android-signing
// Needs keytool of a JDK (JAVA_HOME or the PATH). Prints nothing secret.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir') >= 0 ? args[args.indexOf('--dir') + 1] : null;
const dir = path.resolve(dirArg || path.join(root, '.android-signing'));
// the file, the alias and the certificate keep the app's former name (Cozystacks): the key made then signs every
// release, and android/app/build.gradle.kts falls back to that alias
const storeFile = path.join(dir, 'cozystacks-release.jks');
const propsFile = path.join(dir, 'keystore.properties');
const alias = 'cozystacks';

if (fs.existsSync(storeFile)) { console.log('the keystore exists already: ' + storeFile + ' (nothing done)'); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
const password = crypto.randomBytes(24).toString('base64url');
const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
// the password goes in through the environment, not the command line, so that no process list shows it
const r = spawnSync(keytool, ['-genkeypair', '-keystore', storeFile, '-alias', alias, '-keyalg', 'RSA', '-keysize', '4096', '-validity', '36500',
  '-storepass:env', 'COZYSHELVES_KEYSTORE_PASSWORD', '-keypass:env', 'COZYSHELVES_KEYSTORE_PASSWORD', '-dname', 'CN=Cozystacks, O=Cozystacks contributors'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COZYSHELVES_KEYSTORE_PASSWORD: password } });
if (r.status !== 0) { console.error('keytool failed:', String(r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' ')); process.exit(1); }
fs.writeFileSync(propsFile, `# the release key of the Cozy Shelves Android app (android/app/build.gradle.kts). Keep this folder out of every repository.\nstoreFile=cozystacks-release.jks\nstorePassword=${password}\nkeyAlias=${alias}\nkeyPassword=${password}\n`, { mode: 0o600 });
console.log('keystore written: ' + storeFile);
console.log('properties:       ' + propsFile);
console.log('Gradle finds it through COZYSHELVES_SIGNING=<that properties file>, -Pcozyshelves.signing=<file>, or at <repository>/.android-signing/keystore.properties.');
