/**
 * Generates the app and tray icons without any image libraries: the Drift D
 * monogram in the master brand's monochrome. Run with `npm run icons`.
 *
 *   assets/icon.png                 512px: app, installer, notifications.
 *                                   The brand pack's square-dark: white D
 *                                   on a near-black rounded square.
 *   assets/tray.png, tray@2x.png    16/32px: Windows tray, the same mark.
 *   assets/trayTemplate.png, @2x    18/36pt: macOS menu bar. A "template"
 *                                   image: the D alone, black + transparent,
 *                                   which macOS tints to suit light and dark
 *                                   menu bars.
 *
 * Electron picks the @2x file by itself on high-resolution screens.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DARK = [0x09, 0x0a, 0x0b];
const WHITE = [0xff, 0xff, 0xff];
const BLACK = [0, 0, 0];
const SAMPLES = 8; // Per axis, so 64 samples a pixel: smooth edges at 16px.

// The D, from the brand pack's square-transparent.svg (a 100 × 100 box).
// Each shape is filled on its own; together they make the mark.
const D_SHAPES = [
	[['M', 17, 12], ['H', 54], ['C', 77, 12, 91, 29, 91, 50], ['C', 91, 72, 76, 88, 54, 88], ['H', 45], ['L', 55, 76], ['H', 54], ['C', 70, 76, 79, 64, 79, 50], ['C', 79, 35, 69, 24, 54, 24], ['H', 29], ['V', 44], ['H', 17]],
	[['M', 17, 55], ['H', 29], ['L', 17, 67]],
	[['M', 41, 55], ['H', 54], ['L', 25, 88], ['H', 12]],
	[['M', 55, 76], ['H', 70], ['L', 59, 88], ['H', 43]],
];
const D_WIDTH = 79; // The D's own width in that box (x 12–91).

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

/** An SVG-style path (M, H, V, L, C) as a list of points, curves flattened. */
function polygon(commands) {
	const points = [];
	let x = 0;
	let y = 0;
	for (const [cmd, ...a] of commands) {
		if ('C' === cmd) {
			const [x1, y1, x2, y2, x3, y3] = a;
			for (let i = 1; i <= 24; i++) {
				const t = i / 24;
				const u = 1 - t;
				points.push([
					u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
					u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
				]);
			}
			[x, y] = [x3, y3];
			continue;
		}
		if ('H' === cmd) {
			x = a[0];
		} else if ('V' === cmd) {
			y = a[0];
		} else {
			[x, y] = a;
		}
		points.push([x, y]);
	}
	return points;
}

const D_POLYGONS = D_SHAPES.map(polygon);

/** Even-odd ray cast. */
function inPolygon(px, py, points) {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const [xi, yi] = points[i];
		const [xj, yj] = points[j];
		if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Hit test for the D on a `size` canvas, its 100-unit box `box` px wide and
 * centred, as in the brand pack.
 */
function dMark(size, box) {
	const scale = box / 100;
	const offset = (size - box) / 2;
	return (x, y) => {
		const u = (x - offset) / scale;
		const v = (y - offset) / scale;
		return D_POLYGONS.some((points) => inPolygon(u, v, points));
	};
}

/** Hit test for a rounded square filling a `size` canvas (the brand's 200/1024 corner). */
function roundedSquare(size) {
	const r = size * (200 / 1024);
	const lo = r;
	const hi = size - r;
	return (x, y) => {
		const dx = Math.max(lo - x, x - hi, 0);
		const dy = Math.max(lo - y, y - hi, 0);
		return dx * dx + dy * dy <= r * r;
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

/**
 * White D on a near-black rounded square (app icon, Windows tray).
 * `box` is the D's 100-unit box as a share of the square: the brand pack's
 * 760/1024 for the app icon, larger for the tray so it reads at 16px.
 */
function square(size, box = 760 / 1024) {
	const inSquare = roundedSquare(size);
	const inD = dMark(size, size * box);
	return png(size, (x, y) => {
		const d = coverage(x, y, inD);
		const rgb = DARK.map((c, i) => Math.round(c * (1 - d) + WHITE[i] * d));
		return [...rgb, coverage(x, y, inSquare)];
	});
}

/** Black D on transparent (macOS template), filling the canvas less `pad`. */
function template(size, pad) {
	const inD = dMark(size, ((size - pad * 2) * 100) / D_WIDTH);
	return png(size, (x, y) => [...BLACK, coverage(x, y, inD)]);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const files = {
	'icon.png': square(512),
	'tray.png': square(16, 0.86),
	'tray@2x.png': square(32, 0.86),
	// 18pt canvas with 1pt clear space: the same visual weight as macOS's own icons.
	'trayTemplate.png': template(18, 1),
	'trayTemplate@2x.png': template(36, 2),
};
for (const [name, data] of Object.entries(files)) {
	fs.writeFileSync(path.join(out, name), data);
}
console.log(`Wrote ${Object.keys(files).map((f) => `assets/${f}`).join(', ')}`);
