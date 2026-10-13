/**
 * Generates assets/icon.png (256px, app + installer) and assets/tray.png
 * (32px) without any image libraries: a pink rounded square with a light
 * blue ring, in the Bonsai colours. Run with `npm run icons`.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PINK = [0xee, 0x43, 0x67];
const BLUE = [0xe2, 0xec, 0xf3];

function crc32(buf) {
	let c;
	let crc = 0xffffffff;
	for (let n = 0; n < buf.length; n++) {
		c = (crc ^ buf[n]) & 0xff;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		crc = (crc >>> 8) ^ c;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

/** Coverage (0–1) of a pixel by a shape, 4x4 supersampled for smooth edges. */
function coverage(x, y, inside) {
	let hits = 0;
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) {
				hits++;
			}
		}
	}
	return hits / 16;
}

function draw(size) {
	const r = size * 0.22; // Corner radius.
	const c = size / 2;
	const ringOuter = size * 0.3;
	const ringInner = size * 0.18;

	const inSquare = (x, y) => {
		const dx = Math.max(r - x, x - (size - r), 0);
		const dy = Math.max(r - y, y - (size - r), 0);
		return dx * dx + dy * dy <= r * r;
	};
	const inRing = (x, y) => {
		const d = Math.hypot(x - c, y - c);
		return d <= ringOuter && d >= ringInner;
	};

	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // Filter: none.
		for (let x = 0; x < size; x++) {
			const sq = coverage(x, y, inSquare);
			const ring = coverage(x, y, inRing);
			const rgb = PINK.map((p, i) => Math.round(p * (1 - ring) + BLUE[i] * ring));
			const o = y * (size * 4 + 1) + 1 + x * 4;
			raw[o] = rgb[0];
			raw[o + 1] = rgb[1];
			raw[o + 2] = rgb[2];
			raw[o + 3] = Math.round(255 * sq);
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // Bit depth.
	ihdr[9] = 6; // RGBA.
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), draw(256));
fs.writeFileSync(path.join(out, 'tray.png'), draw(32));
console.log('Wrote assets/icon.png and assets/tray.png');
