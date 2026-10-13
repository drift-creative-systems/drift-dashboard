/**
 * Syntax-checks every JS file in src/ and scripts/ (npm run check).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function walk(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
	});
}

const root = path.join(__dirname, '..');
const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))];
let failed = 0;
for (const file of files) {
	try {
		execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
	} catch (err) {
		failed++;
		console.error(String(err.stderr));
	}
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
