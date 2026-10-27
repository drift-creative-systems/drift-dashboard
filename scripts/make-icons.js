/**
 * Generates the app and tray icons without any image libraries: a pink
 * rounded square with a light blue ring, in the Bonsai colours. Run with
 * `npm run icons`.
 *
 *   assets/icon.png                 512px: app, installer, notifications
 *   assets/tray.png, tray@2x.png    16/32px: Windows tray (pink mark)
 *   assets/trayTemplate.png, @2x    18/36pt: macOS menu bar. A "template"
 *                                   image: black + transparent only, which
 *                                   macOS tints to suit light and dark
 *                                   menu bars. The ring is cut out.
 *
 * Electron picks the @2x file by itself on high-resolution screens.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PINK = [0xee, 0x43, 0x67];
const BLUE = [0xe2, 0xec, 0xf3];
const BLACK = [0, 0, 0];
const SAMPLES = 8; // Per axis, so 64 samples a pixel: smooth edges at 16px.

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

/** Coverage (0–1) of a pixel by a shape, supersampled. */
function coverage(x, y, inside) {
	let hits = 0;
	for (let i = 0; i < SAMPLES; i++) {
		for (let j = 0; j < SAMPLES; j++) {
			if (inside(x + (i + 0.5) / SAMPLES, y + (j + 0.5) / SAMPLES)) {
				hits++;
			}
		}
	}
	return hits / (SAMPLES * SAMPLES);
}

/**
 * The Bonsai mark on a `size` canvas, with `pad` px of clear space round it.
 * Returns { inSquare, inRing } hit tests.
 */
function mark(size, pad, { ringOuter = 0.3, ringInner = 0.18 } = {}) {
	const side = size - pad * 2;
	const r = side * 0.22; // Corner radius.
	const c = size / 2;
	const lo = pad + r;
	const hi = size - pad - r;
	return {
		inSquare: (x, y) => {
			const dx = Math.max(lo - x, x - hi, 0);
			const dy = Math.max(lo - y, y - hi, 0);
			return dx * dx + dy * dy <= r * r;
		},
		inRing: (x, y) => {
			const d = Math.hypot(x - c, y - c);
			return d <= side * ringOuter && d >= side * ringInner;
		},
	};
}

function png(size, pixel) {
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // Filter: none.
		for (let x = 0; x < size; x++) {
			const [r, g, b, a] = pixel(x, y);
			const o = y * (size * 4 + 1) + 1 + x * 4;
			raw[o] = r;
			raw[o + 1] = g;
			raw[o + 2] = b;
			raw[o + 3] = Math.round(255 * a);
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
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

/** Pink square, blue ring (app icon, Windows tray). */
function colour(size, pad = 0) {
	const { inSquare, inRing } = mark(size, pad);
	return png(size, (x, y) => {
		const ring = coverage(x, y, inRing);
		const rgb = PINK.map((p, i) => Math.round(p * (1 - ring) + BLUE[i] * ring));
		return [...rgb, coverage(x, y, inSquare)];
	});
}

/**
 * Black square with the ring cut out (macOS template). The ring is a touch
 * bolder than on the colour icon so it stays open at menu bar size.
 */
function template(size, pad) {
	const { inSquare, inRing } = mark(size, pad, { ringOuter: 0.32, ringInner: 0.17 });
	return png(size, (x, y) => [...BLACK, coverage(x, y, (px, py) => inSquare(px, py) && !inRing(px, py))]);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const files = {
	'icon.png': colour(512),
	'tray.png': colour(16),
	'tray@2x.png': colour(32),
	// 18pt canvas with 1pt clear space: the same visual weight as macOS's own icons.
	'trayTemplate.png': template(18, 1),
	'trayTemplate@2x.png': template(36, 2),
};
for (const [name, data] of Object.entries(files)) {
	fs.writeFileSync(path.join(out, name), data);
}
console.log(`Wrote ${Object.keys(files).map((f) => `assets/${f}`).join(', ')}`);
