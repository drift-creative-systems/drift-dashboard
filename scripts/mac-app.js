/**
 * Builds Drift Dashboard as a Mac app and installs it in /Applications
 * (npm run mac). For your own Mac: it isn't signed with an Apple Developer
 * ID or notarised, so it isn't for sending to other people.
 *
 *   1. electron-builder makes "Drift Dashboard.app" in dist/ for this
 *      Mac's chip (Apple silicon or Intel), without signing.
 *   2. It's signed "ad hoc" (codesign -s -), which Apple silicon needs
 *      before it will run anything.
 *   3. It's copied to /Applications, replacing the old copy. Quit the app
 *      first; this stops if it's running.
 *
 * Your accounts aren't in the app: they stay in
 * ~/Library/Application Support/Drift Dashboard, shared with `npm start`.
 *
 * Options: --no-install  build and sign only (the app stays in dist/).
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NAME = 'Drift Dashboard';
const OLD_NAME = 'Bonsai Dashboard'; // Before 1.11.0; removed from Applications on install.
const INSTALL = !process.argv.includes('--no-install');

if ('darwin' !== process.platform) {
	console.error('npm run mac only works on a Mac. On Windows, use npm run dist.');
	process.exit(1);
}

function run(cmd, args) {
	console.log(`\n› ${cmd} ${args.join(' ')}`);
	execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
}

const arch = 'arm64' === process.arch ? 'arm64' : 'x64';
const builder = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
if (!fs.existsSync(builder)) {
	console.error('electron-builder isn’t installed. Run npm install first.');
	process.exit(1);
}

// 1. Build (unsigned: identity null in package.json → build.mac).
run(builder, ['--mac', 'dir', `--${arch}`, '--publish', 'never']);

const out = path.join(ROOT, 'dist', 'arm64' === arch ? 'mac-arm64' : 'mac', `${NAME}.app`);
if (!fs.existsSync(out)) {
	console.error(`Build finished but ${out} wasn't found.`);
	process.exit(1);
}

// 2. Ad hoc signature, so macOS will run it.
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', out]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', out]);

if (!INSTALL) {
	console.log(`\nBuilt: ${out}`);
	process.exit(0);
}

// 3. Install, but not over a running copy (or the pre-1.11 Bonsai one).
for (const name of [NAME, OLD_NAME]) {
	if (spawnSync('/usr/bin/pgrep', ['-x', name]).status === 0) {
		console.error(`\n${name} is running. Quit it (menu bar icon → Quit), then run npm run mac again.`);
		console.error(`The new build is ready in ${out} if you'd rather drag it to Applications yourself.`);
		process.exit(1);
	}
}
const target = path.join('/Applications', `${NAME}.app`);
for (const app of [target, path.join('/Applications', `${OLD_NAME}.app`)]) {
	if (fs.existsSync(app)) {
		run('/bin/rm', ['-rf', app]);
	}
}
run('/usr/bin/ditto', [out, target]);
// Built here, so it shouldn't be quarantined, but make sure Gatekeeper won't block it.
spawnSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', target]);

console.log(`\nInstalled ${target}. Open it from Applications or Spotlight.`);
console.log('The first time, macOS may ask to let it use "Drift Dashboard Safe Storage" in your keychain: enter your password and click Always Allow.');
