/**
 * Clawd, the pixel crab from Claude Code's welcome screen, living in a strip
 * across the Claude card. His art and animations are ported from
 * clawd-usage-winwidget by Venger Sergey (MIT licence):
 * https://github.com/Enhed/clawd-usage-winwidget. Clawd and Claude are Anthropic's.
 *
 * Cards are rebuilt on every tick, so there's one Clawd per card id and the
 * renderer re-attaches the same element each time: he keeps his place and mood.
 *
 * Moods come from the current session limit: wanders (idle), dozes when the
 * card's been ignored for 10 minutes, sweats from 90%, lies belly-up at 100%,
 * burrows into the sand while the card has an error, and celebrates when the
 * session window resets. Click him for a random Claude Code animation.
 *
 * Connected to Claude Code (Settings → Connect Clawd), he also shows what it's
 * doing: hunched over and typing while it works, arms up while it waits for
 * you, and a wave when it finishes. The plan limit moods still win.
 */
(function () {
	'use strict';

	const { h } = window.BD;

	/* ------------------------------------------------------------------ The art */

	// 9 cells by 3 rows of block glyphs; each cell is 2x4 pixels, so quadrant
	// glyphs fit the grid losslessly and a pixel comes out almost square.
	const COLS = 9;
	const ROWS = 3;
	const W = 2 * COLS;
	const H = 4 * ROWS;
	const S = 1.2; // Scale against the original widget, for its distances.
	const PX = 2 * S; // Screen px per Clawd pixel, across…
	const PY = 2.2 * S; // …and down.
	const MASCOT_W = W * PX;
	const GROUND_ROW = 10; // The bottom half of the legs row is empty: that's the ground.
	const STRIP_H = 48; // Matches .clawd in app.css.
	const GROUND = STRIP_H - 4;
	const BURROW_DIG = 4; // Pixel rows sunk into the sand: only the eyes stick out.

	// Glyph quadrants as bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
	const QUAD = { ' ': 0, '█': 15, '▀': 3, '▄': 12, '▌': 5, '▐': 10, '▘': 1, '▝': 2, '▖': 4, '▗': 8, '▛': 7, '▜': 11, '▙': 13, '▟': 14 };

	// What sits left and right of the eyes (row 0) and of the chest (row 1).
	const ARMS = {
		down: { r1L: ' ▐', r1R: '', r2L: '▝▜', r2R: '█▀' },
		up: { r1L: '▗▟', r1R: '▄', r2L: ' ▜', r2R: '█▘' },
		right: { r1L: ' ▐', r1R: '▄', r2L: '▝▜', r2R: '█▘' },
		left: { r1L: '▗▟', r1R: '', r2L: ' ▜', r2R: '█▀' },
	};
	const FEET = { both: ' ▝▝   ▝▝ ', left: ' ▝▝      ', right: '      ▝▝ ' };

	// Turning in place: glyph rows, and the columns where the black face shows.
	const FACING = {
		'right-12': [[' ▐█▜██▛█ ', 2, 8], ['▝▜██████▀', 2, 7], [' ▝▝   ▝▝ ', 0, 0]],
		'right-30': [['  █▛██▛▌ ', 2, 7], [' ▝█████▛ ', 2, 7], ['  ▘▘  ▘▘ ', 0, 0]],
		'right-55': [['  ▐█▛█▜  ', 3, 7], ['  ▐████  ', 3, 7], ['  ▝▝ ▝▝  ', 0, 0]],
		'right-75': [['   ██▛▌  ', 3, 6], ['   ███▌  ', 3, 6], ['   ▘  ▘  ', 0, 0]],
		edge: [['   ▐██   ', 4, 6], ['   ▐██   ', 4, 6], ['   ▝ ▝   ', 0, 0]],
		'back-105': [['   ███▌  ', 3, 6], ['   ███▌  ', 3, 6], ['   ▘  ▘  ', 0, 0]],
		'back-125': [['  ▐████  ', 3, 7], ['  ▐████  ', 3, 7], ['  ▝▝ ▝▝  ', 0, 0]],
		'back-150': [['  █████▌ ', 2, 7], [' ▝█████▛ ', 2, 7], ['  ▘▘  ▘▘ ', 0, 0]],
		back: [[' ▐██████ ', 2, 8], ['▝▜██████▀', 2, 7], [' ▝▝   ▝▝ ', 0, 0]],
		'left-75': [['   ▛██▌  ', 3, 6], ['   ███▌  ', 3, 6], ['   ▘  ▘  ', 0, 0]],
		'left-55': [['  ▐▜▛██  ', 3, 7], ['  ▐████  ', 3, 7], ['  ▝▝ ▝▝  ', 0, 0]],
		'left-30': [['  ▛██▛█▌ ', 2, 7], [' ▝█████▛ ', 2, 7], ['  ▘▘  ▘▘ ', 0, 0]],
		'left-12': [[' ▐▛███▜█ ', 2, 8], ['▝▜██████▀', 2, 7], [' ▝▝   ▝▝ ', 0, 0]],
	};

	// Black pixels "dx,dy" from the top-left of each eye cell; ";" splits left and right eye.
	const EYES = {
		open: '1,2 1,3',
		left: '0,0 0,1',
		right: '2,0 2,1',
		closed: '0,3 1,3',
		blink: '0,3 1,3',
		wink: '1,2 1,3;0,3 1,3',
		happy: '0,3 1,2 2,3',
		focus: '1,3',
		wide: '0,1 1,1 0,2 1,2 0,3 1,3',
		x: '0,1 2,1 1,2 0,3 2,3',
		yawn: '0,3 1,3',
		gasp: '0,1 2,1 1,2 0,3 2,3',
	};

	// The ghost that floats out when you click him lying belly-up.
	const SOUL_ART = ['..########..', '..#.####.#..', '############', '..########..', '...######...', '....####....', '.....##.....'];
	const SOUL_UP = 26; // Frame the soul reaches the top…
	const SOUL_BACK = 48; // …and starts getting sucked back in.
	const SOUL_TOP = 12; // Height above the mouth (lower than the widget's, to fit the strip).
	const SOUL_PX = 1.4;

	const CONFETTI = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#a78bfa', '#d77757'];

	/* -------------------------------------------- Animations from Claude Code */

	// A frame is a pose plus an offset: off lowers him by whole rows (1 crouched,
	// 3 hidden, negative above), x shifts him by cells, and anything outside the
	// 9x3 frame is clipped, as in the terminal. They play at 60 ms a frame.
	const FRAME_MS = 60;
	const STEP_MS = 90;
	const POSES = { default: 'open/down/both', 'arms-up': 'open/up/both', 'look-left': 'left/down/both', 'look-right': 'right/down/both' };

	function F(pose, n = 1, { off = 0, x = 0, poof = '', shadow = '' } = {}) {
		const fr = { off, x, poof, shadow, facing: '' };
		if (pose.startsWith('face:')) {
			Object.assign(fr, { facing: pose.slice(5), eyes: 'open', arms: 'down', feet: 'both' });
		} else {
			[fr.eyes, fr.arms, fr.feet] = (POSES[pose] || pose).split('/');
		}
		return Array(n).fill(fr);
	}
	const turn = (list, shadow = '') => list.flatMap((p) => F(`face:${p}`, 1, { shadow }));
	const seq = (...parts) => parts.flat();

	const cr = seq(F('default', 1, { off: 1, poof: 'dot' }), F('default', 1, { off: 1, poof: 'wave' })); // Crouch before a jump.
	const bo = F('default'); // Rest.
	const ts = seq(F('closed/down/both'), bo); // Blink at the end.
	const jump = seq(cr, F('arms-up', 3), bo, cr, F('arms-up', 3), bo);
	const waddle = F('look-right', 1, { x: -9 });
	for (let u = -6; u <= -1; u++) {
		waddle.push(...F(`right/down/${0 === u % 2 ? 'left' : 'right'}`, 2, { x: u }));
	}

	const SEQS = {
		jump,
		look: seq(F('look-right', 5), F('look-left', 5), bo),
		celebrate: seq(jump, F('default', 3, { off: 1 })),
		skip: seq(F('default', 1, { off: 1, x: -9 }), F('arms-up', 2, { x: -6 }), F('default', 1, { x: -6 }),
			F('default', 1, { off: 1, x: -6 }), F('arms-up', 2, { x: -3 }), F('default', 1, { x: -3 }),
			F('default', 1, { off: 1, x: -3 }), F('arms-up', 2), cr, bo),
		spin: seq(F('look-left', 2), F('look-right', 2), F('look-left', 2), F('arms-up', 3), bo),
		peekaboo: seq(F('default', 1, { off: 3 }), F('default', 3, { off: 2 }), F('look-right', 3, { off: 2 }),
			F('look-left', 3, { off: 2 }), F('default', 2, { off: 2 }), F('default', 1, { off: 1 }),
			F('arms-up', 4), F('default', 2), ts),
		drop: seq(F('arms-up', 1, { off: -3 }), F('arms-up', 2, { off: -2 }), F('arms-up', 2, { off: -1 }),
			F('arms-up', 1), cr, F('default', 3), ts),
		waddle: seq(waddle, F('look-right', 2), F('default', 2), ts),
		peek: seq(F('look-right', 1, { x: -9 }), F('look-right', 5, { x: -6 }), F('look-right', 3, { x: -9 }),
			F('look-right', 4, { x: -5 }), F('arms-up', 2, { x: -3 }), F('arms-up', 2), cr, bo),
		wink: seq(F('wink/down/both', 5), bo),
		boop: seq(F('closed/down/both', 1, { off: 1, poof: 'dot' }), F('closed/down/both', 2, { off: 1, poof: 'wave' }),
			F('look-left', 4), F('default', 2), ts),
		tap: seq(F('open/down/left', 2), F('open/down/right', 2), F('open/down/left', 2),
			F('open/down/right', 2), F('open/down/left', 1), F('open/down/right', 1), F('arms-up', 3), bo),
		sneeze: seq(F('closed/up/both', 4), F('closed/down/both', 2, { off: 1, poof: 'wave' }),
			F('closed/down/both', 2), F('default', 2), ts),
		turn: seq(turn(['right-12', 'right-30', 'right-55', 'right-75', 'edge']),
			turn(['back-105', 'back-125', 'back-150', 'back', 'back']),
			turn(['back-150', 'back-125', 'back-105', 'edge']),
			turn(['left-75', 'left-55', 'left-30', 'left-12']), bo),
		'coin-hop': seq(F('default', 2, { off: 1 }), F('arms-up', 1, { shadow: 'wide' }),
			turn(['right-55', 'edge', 'back-125', 'back'], 'narrow'),
			turn(['back-125', 'edge', 'left-55'], 'narrow'),
			F('arms-up', 1, { shadow: 'wide' }), cr, bo),
	};

	// Our own animations (stepped in stepAct), by length in frames.
	const CUSTOM = { wave: 24, stretch: 22, yawn: 22, soul: 66, burrow: 30, unburrow: 28, stir: 22 };

	// Clicks play anything that starts in place; he enters with any of them.
	const CLICK_ACTS = Object.keys(SEQS).filter((id) => 0 === SEQS[id][0].x && 'celebrate' !== id);
	const ENTRANCE_ACTS = Object.keys(SEQS).filter((id) => 'celebrate' !== id);

	const actLength = (id) => (SEQS[id] ? SEQS[id].length : CUSTOM[id]);
	const rnd = (n) => Math.floor(Math.random() * n);
	const pick = (list) => list[rnd(list.length)];

	/* ------------------------------------------------------------- Pixel grid */

	// 0 empty, 1 body, 2 black (eyes and face). Cached per pose.
	const grids = new Map();

	function grid(f) {
		const key = `${f.eyes}|${f.arms}|${f.feet}|${f.look}|${f.facing}`;
		if (grids.has(key)) {
			return grids.get(key);
		}
		const g = new Uint8Array(W * H);
		// Mode 'eyes' paints a black background behind the glyph's body pixels.
		const paint = (glyphs, col, row, mode) => {
			const bg = 'eyes' === mode ? 2 : 0;
			[...glyphs].forEach((c, i) => {
				for (let sy = 0; sy < 4; sy++) {
					for (let sx = 0; sx < 2; sx++) {
						const bit = (sy < 2 ? 1 : 4) * (sx ? 2 : 1);
						const v = (QUAD[c] & bit) ? 1 : bg;
						if (v) {
							g[(4 * row + sy) * W + 2 * (col + i) + sx] = v;
						}
					}
				}
			});
		};

		if (f.facing) {
			FACING[f.facing].forEach(([s, from, to], r) => {
				paint(s.slice(0, from), 0, r, '');
				paint(s.slice(from, to), from, r, 'eyes');
				paint(s.slice(to), to, r, '');
			});
		} else {
			const a = ARMS[f.arms];
			paint(a.r1L, 0, 0, '');
			paint('██████', 2, 0, 'eyes');
			paint(a.r1R, 8, 0, '');
			paint(a.r2L, 0, 1, '');
			paint('█████', 2, 1, 'eyes');
			paint(a.r2R, 7, 1, '');
			paint(FEET[f.feet], 0, 2, '');

			// Looking sideways with normal eyes uses Claude Code's own poses;
			// other expressions just shift the pupils.
			let eyes = f.eyes;
			let shift = 0;
			if ('open' === eyes && f.look < 0) {
				eyes = 'left';
			} else if ('open' === eyes && f.look > 0) {
				eyes = 'right';
			} else if (!['open', 'left', 'right', 'wink'].includes(eyes)) {
				shift = f.look || 0;
			}
			const shapes = EYES[eyes].split(';');
			[4, 12].forEach((ex, k) => {
				for (const pt of shapes[Math.min(k, shapes.length - 1)].split(' ')) {
					const [dx, dy] = pt.split(',').map(Number);
					g[dy * W + ex + dx + shift] = 2;
				}
			});
			// Yawning (or gasping): an open mouth too.
			if ('yawn' === eyes || 'gasp' === eyes) {
				for (let x = 8; x <= 10; x++) {
					g[4 * W + x] = 2;
					g[5 * W + x] = 2;
				}
			}
		}
		grids.set(key, g);
		return g;
	}

	/* ----------------------------------------------------------------- Pointer */

	// Where the mouse is, so he can follow it and know when he's being ignored.
	const pointer = { x: 0, y: 0, inside: false };
	document.addEventListener('mousemove', (e) => {
		pointer.x = e.clientX;
		pointer.y = e.clientY;
		pointer.inside = true;
	}, { passive: true });
	document.documentElement.addEventListener('mouseleave', () => {
		pointer.inside = false;
	});

	const calmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

	// Claude Code states older than this are ignored (a session that crashed or was closed).
	const ACTIVITY_TTL = 15 * 60 * 1000;
	const ACTIVITY_MOOD = { working: 'work', waiting: 'wait' };

	/* ------------------------------------------------------------------- Clawd */

	class Clawd {
		constructor() {
			this.canvas = h('canvas', { class: 'clawd__canvas', 'aria-hidden': 'true' });
			this.el = h('button', { type: 'button', class: 'clawd', on: { click: () => this.click() } }, this.canvas);
			this.ctx = this.canvas.getContext('2d');
			this.timer = null;

			this.x = -1;
			this.dir = 1;
			this.target = null;
			this.look = 0;
			this.tick = 0;
			this.blinkAt = 30;
			this.mood = 'idle';
			this.cur = 'idle';
			this.crit = false;
			this.idleSince = Date.now();
			this.act = null;
			this.actT = 0;
			this.buried = false;
			this.loveT = -1;
			this.noteT = -1;
			this.confT = -1;
			this.confetti = [];
			this.lastReset = null;
			this.lastPct = null;
			this.activity = null; // { state, at } from Claude Code's hooks.

			if (!calmQuery.matches) {
				this.startAct(pick(ENTRANCE_ACTS));
			}
		}

		/** New card data: { asleep, percent, resetsAt, critical }. */
		update({ asleep, percent, resetsAt, critical }) {
			const mood = asleep ? 'sleep' : (percent >= 100 ? 'dead' : 'idle');
			if (mood !== this.mood) {
				this.idleSince = Date.now();
			}
			this.mood = mood;
			this.crit = !!critical;

			// The session window reset: its reset time moved on and the % dropped.
			const reset = resetsAt ? Date.parse(resetsAt) : null;
			if (reset && null !== percent) {
				if (this.lastReset && reset > this.lastReset && null !== this.lastPct && percent < this.lastPct && !calmQuery.matches) {
					this.startAct('celebrate');
				}
				this.lastReset = reset;
				this.lastPct = percent;
			}

			this.label();
		}

		/** What Claude Code is doing: { state, at } or null. */
		setActivity(activity) {
			const before = this.activity && this.activity.state;
			this.activity = activity || null;
			const now = this.activity && this.activity.state;
			if (now !== before) {
				this.idleSince = Date.now();
				// Finished: a little wave, if he was busy or waiting.
				if ('done' === now && ACTIVITY_MOOD[before] && !calmQuery.matches && !this.act && 'idle' === this.mood) {
					this.startAct('wave');
				}
			}
			this.label();
		}

		/** 'work' or 'wait' while Claude Code is busy or needs you, otherwise null. */
		busyMood() {
			const a = this.activity;
			return a && ACTIVITY_MOOD[a.state] && Date.now() - a.at < ACTIVITY_TTL ? ACTIVITY_MOOD[a.state] : null;
		}

		label() {
			const says = {
				sleep: 'asleep in the sand',
				dead: 'out of session limit',
				work: 'busy, Claude Code is working',
				wait: 'waving, Claude Code is waiting for you',
				idle: this.crit ? 'sweating, the session limit is nearly used' : 'pottering about',
			};
			const mood = 'idle' === this.mood ? (this.busyMood() || 'idle') : this.mood;
			this.el.setAttribute('aria-label', `Clawd, ${says[mood]}. Play an animation`);
		}

		start() {
			if (!this.timer) {
				this.timer = setTimeout(() => this.loop(), 0);
			}
		}

		// Stops once the card's gone; the next render starts him again.
		loop() {
			this.timer = null;
			if (!this.el.isConnected) {
				return;
			}
			if (!document.hidden) {
				this.step();
			}
			const busy = this.act || this.loveT >= 0 || this.confT >= 0;
			let ms = this.act && SEQS[this.act] ? FRAME_MS : STEP_MS;
			if (document.hidden) {
				ms = 1000;
			} else if (calmQuery.matches && !busy) {
				ms = 500;
			}
			this.timer = setTimeout(() => this.loop(), ms);
		}

		startAct(id) {
			this.act = id;
			this.actT = 0;
			if ('celebrate' === id) {
				this.startConfetti();
			}
		}

		// A random Claude Code animation and a heart. Lying belly-up, his soul
		// floats out instead; buried, he just peeks out of the sand.
		click() {
			if ('dead' === this.cur) {
				if (!this.act) {
					this.startAct('soul');
				}
				return;
			}
			this.loveT = 0;
			if (this.buried && 'sleep' === this.cur) {
				if (!this.act) {
					this.startAct('stir');
				}
				return;
			}
			if (!this.act) {
				this.startAct(pick(CLICK_ACTS));
			}
			this.start();
		}

		/** Whether the mouse is over this card, and which way to look at it. */
		pointerLook() {
			const card = this.el.closest('.card') || this.el;
			const r = card.getBoundingClientRect();
			if (!pointer.inside || pointer.x < r.left || pointer.x > r.right || pointer.y < r.top || pointer.y > r.bottom) {
				return null;
			}
			const cx = this.canvas.getBoundingClientRect().left + this.x + MASCOT_W / 2;
			if (pointer.x > cx + 10) {
				return 1;
			}
			return pointer.x < cx - 10 ? -1 : 0;
		}

		step() {
			const calm = calmQuery.matches;
			const width = this.el.clientWidth;
			if (!width) {
				return;
			}
			this.tick++;
			const span = Math.max(0, width - MASCOT_W);
			if (this.x < 0) {
				this.x = span / 2;
			}
			this.x = Math.min(this.x, span);
			if (null !== this.target) {
				this.target = Math.min(this.target, span);
			}

			const mouse = this.pointerLook();
			if (null !== mouse) {
				this.idleSince = Date.now();
			}
			let mood = this.mood;
			const busy = 'idle' === mood ? this.busyMood() : null;
			if (busy) {
				mood = busy;
				this.idleSince = Date.now();
			} else if ('idle' === mood && Date.now() - this.idleSince >= 10 * 60 * 1000) {
				mood = 'doze';
			}

			// Falling asleep, he burrows once the current animation ends; waking, he climbs straight out.
			if ('sleep' === mood) {
				if (!this.buried && !this.act) {
					this.buried = true;
					this.startAct('burrow');
				}
			} else if (this.buried) {
				this.buried = false;
				this.startAct('unburrow');
			}

			const f = { feet: 'both', look: this.look, eyes: 'open', arms: 'down', flip: false, lift: 0, off: 0, x: 0, facing: '', poof: '', shadow: '', soul: 0, soulT: 0, dig: 0, spray: 0 };
			this.cur = mood;
			let bubble = '';
			let zzz = false;
			let canBlink = true;

			if (this.act) {
				bubble = this.stepAct(f);
				canBlink = false;
			} else if ('sleep' === mood) {
				Object.assign(f, { dig: BURROW_DIG, eyes: 'closed', look: 0 });
				zzz = true;
			} else if ('doze' === mood) {
				// Nods off, and now and then startles awake.
				const p = this.tick % 70;
				f.look = 0;
				if (p < 6 && !calm) {
					f.eyes = 'wide';
					f.lift = p < 2 ? 1.5 : 0;
				} else {
					f.eyes = 'blink';
					zzz = true;
				}
			} else if ('work' === mood) {
				// Facing you, eyes down, tapping away.
				Object.assign(f, { look: 0, eyes: 'focus', arms: calm || Math.floor(this.tick / 3) % 2 ? 'right' : 'left' });
				bubble = '…';
			} else if ('wait' === mood) {
				// Arms up, with a little hop now and then to get your attention.
				const p = this.tick % 40;
				Object.assign(f, { arms: 'up', look: null !== mouse ? mouse : 0, lift: !calm && p < 4 ? 1.5 : 0 });
				bubble = '?';
			} else if ('dead' === mood) {
				Object.assign(f, { flip: true, eyes: 'x', look: 0 });
				const p = this.tick % 50;
				if (p < 6 && !calm) {
					f.feet = p % 2 ? 'left' : 'right'; // The odd leg twitch.
				}
			} else {
				this.wander(f, span, mouse, calm);
			}

			// Petted: pleased.
			if (this.loveT >= 0 && !this.act && 'open' === f.eyes) {
				f.eyes = 'happy';
			}
			// Whistling while he walks.
			if (this.noteT >= 0) {
				if (!bubble && 'idle' === mood) {
					bubble = '♪';
				}
				this.noteT = this.noteT + 1 >= 30 ? -1 : this.noteT + 1;
			}
			if (canBlink && !calm && 'open' === f.eyes && this.tick >= this.blinkAt) {
				f.eyes = 'blink';
				if (this.tick >= this.blinkAt + 1) {
					this.blinkAt = this.tick + 25 + rnd(45);
				}
			}

			this.draw(f, { bubble, zzz, sweat: this.crit && 'sleep' !== mood && 'dead' !== mood, calm });
		}

		/** Idle: strolls about now and then, looks around, follows the mouse. */
		wander(f, span, mouse, calm) {
			const speed = 0.6 * S;
			if (null === this.target && !calm) {
				if (0 === rnd(150)) {
					this.target = Math.random() * span;
				} else if (0 === rnd(45)) {
					this.look = rnd(3) - 1;
				} else if (0 === rnd(600)) {
					this.startAct(pick(['wave', 'stretch', 'look', 'yawn']));
				}
			}
			let walking = false;
			if (null !== this.target) {
				const d = this.target - this.x;
				if (Math.abs(d) <= speed) {
					this.x = this.target;
					this.target = null;
				} else {
					this.dir = Math.sign(d);
					this.x += speed * this.dir;
					this.look = this.dir;
					walking = true;
				}
			}
			if (walking) {
				f.feet = Math.floor(this.tick / 3) % 2 ? 'left' : 'right';
				if (this.noteT < 0 && 0 === rnd(80)) {
					this.noteT = 0;
				}
			} else if (this.crit && !calm) {
				this.look = Math.floor(this.tick / 5) % 2 ? -1 : 1; // Nervous darting eyes.
			} else if (null !== mouse) {
				this.look = mouse;
			}
			f.look = this.look;
		}

		/** One frame of the current animation; returns any bubble text. */
		stepAct(f) {
			const t = this.actT;
			let bubble = '';
			if (SEQS[this.act]) {
				const fr = SEQS[this.act][t];
				for (const k of ['eyes', 'arms', 'feet', 'off', 'x', 'facing', 'poof', 'shadow']) {
					f[k] = fr[k];
				}
				f.look = 0;
				if ('celebrate' === this.act) {
					bubble = '!';
				}
			} else {
				this.stepCustom(f, t);
			}
			this.actT++;
			if (this.actT >= actLength(this.act)) {
				this.act = null;
			}
			return bubble;
		}

		stepCustom(f, t) {
			const alt = (n) => Math.floor(t / n) % 2;
			switch (this.act) {
				case 'wave':
					Object.assign(f, { look: 0, eyes: 'happy', arms: alt(4) ? 'down' : 'right' });
					break;
				case 'stretch':
					if (t >= 4 && t < 18) {
						Object.assign(f, { arms: 'up', eyes: 'closed', lift: 1.5 });
					}
					break;
				case 'yawn':
					Object.assign(f, { look: 0, eyes: t >= 3 && t < 17 ? 'yawn' : 'closed' });
					break;
				case 'soul':
					// The soul floats out of his open mouth on a thread, hangs there,
					// then gets sucked back in and the body twitches.
					Object.assign(f, { flip: true, look: 0 });
					if (t < 6) {
						Object.assign(f, { eyes: 'x', feet: t % 2 ? 'left' : 'right' });
					} else if (t < SOUL_BACK + 6) {
						Object.assign(f, { eyes: 'gasp', soulT: t });
						if (t < SOUL_UP) {
							const k = (t - 6) / (SOUL_UP - 6);
							f.soul = SOUL_TOP * (1 - (1 - k) * (1 - k));
						} else if (t < SOUL_BACK) {
							f.soul = SOUL_TOP + 1.5 * Math.sin((t - SOUL_UP) / 2.5);
						} else {
							const k = (t - SOUL_BACK) / 6;
							f.soul = SOUL_TOP * (1 - k * k);
						}
					} else if (t < SOUL_BACK + 9) {
						Object.assign(f, { eyes: 'wide', lift: 2.5 });
					} else {
						f.eyes = 'x';
					}
					break;
				case 'burrow':
					// Looks around, digs in with his legs and shuts his eyes.
					if (t < 4) {
						f.look = t < 2 ? -1 : 1;
					} else if (t < 24) {
						Object.assign(f, {
							look: 0, eyes: 'focus', dig: Math.min(BURROW_DIG, Math.floor((t - 4) / 3.5)),
							feet: alt(2) ? 'left' : 'right', arms: alt(2) ? 'up' : 'down', spray: (t % 3) + 1,
						});
					} else {
						Object.assign(f, { look: 0, dig: BURROW_DIG, eyes: t < 27 ? 'blink' : 'closed' });
					}
					break;
				case 'unburrow':
					// Eyes wide, jumps out of the sand and shakes himself off.
					f.look = 0;
					if (t < 3) {
						Object.assign(f, { dig: BURROW_DIG, eyes: 'wide' });
					} else if (t < 9) {
						Object.assign(f, { dig: Math.max(0, BURROW_DIG - (t - 3)), eyes: 'wide', arms: 'up', spray: (t % 3) + 1, lift: 8 === t ? 2 : 0 });
					} else if (t < 21) {
						Object.assign(f, { eyes: 'closed', look: alt(2) ? -1 : 1, feet: alt(2) ? 'left' : 'right', spray: t < 15 ? (t % 3) + 1 : 0 });
					} else if (t < 23) {
						f.eyes = 'blink';
					}
					break;
				case 'stir':
					// Rises in the burrow, looks around and sinks back.
					f.dig = t < 15 ? BURROW_DIG - 1 : BURROW_DIG;
					if (t < 3) {
						Object.assign(f, { eyes: 'wide', look: 0 });
					} else if (t < 13) {
						f.look = t < 8 ? -1 : 1;
					} else {
						Object.assign(f, { eyes: t < 17 ? 'blink' : 'closed', look: 0 });
					}
					break;
			}
		}

		startConfetti() {
			this.confetti = Array.from({ length: 12 }, (_, i) => ({
				x: this.x + (-12 + Math.random() * (W * 2 + 24)) * S,
				y: GROUND - (34 + Math.random() * 12) * S,
				v: (0.9 + Math.random() * 1.2) * S,
				d: (Math.random() - 0.5) * 0.8 * S,
				colour: CONFETTI[i % CONFETTI.length],
			}));
			this.confT = 0;
		}

		/* ---------------------------------------------------------------- Drawing */

		draw(f, { bubble, zzz, sweat, calm }) {
			const width = this.el.clientWidth;
			const k = window.devicePixelRatio || 1;
			const cw = Math.round(width * k);
			const ch = Math.round(STRIP_H * k);
			if (this.canvas.width !== cw || this.canvas.height !== ch) {
				this.canvas.width = cw;
				this.canvas.height = ch;
			}
			const ctx = this.ctx;
			const css = getComputedStyle(this.el);
			const colour = (name) => css.getPropertyValue(name).trim();
			// Rectangles snap to device pixels so rows don't leave seams.
			const rect = (x, y, w, hh) => {
				const x0 = Math.round(x * k);
				const y0 = Math.round(y * k);
				ctx.fillRect(x0, y0, Math.round((x + w) * k) - x0, Math.round((y + hh) * k) - y0);
			};

			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, cw, ch);
			ctx.globalAlpha = 1;

			// The ground.
			ctx.fillStyle = colour('--clawd-ground');
			rect(0, GROUND, width, 1);

			const left = Math.round(this.x);
			const lift = f.lift * S;
			const top = GROUND - GROUND_ROW * PY - lift;

			// Body and eyes, lowered by off rows (or dug in) and shifted by x cells,
			// clipped to the frame and the ground. Flipped: lying belly-up.
			const g = grid(f);
			const oy = 4 * f.off + f.dig;
			const ox = 2 * f.x;
			const fills = ['', colour('--clawd-body'), colour('--clawd-eyes')];
			for (let y = 0; y < H; y++) {
				let sy = y;
				if (f.flip) {
					if (y >= H - 2) {
						continue;
					}
					sy = H - 3 - y;
				}
				const yy = sy + oy;
				if (yy < 0 || yy >= GROUND_ROW) {
					continue;
				}
				let x = 0;
				while (x < W) {
					const c = g[y * W + x];
					if (!c) {
						x++;
						continue;
					}
					// Runs of the same colour in one go.
					const x0 = x;
					while (x < W && g[y * W + x] === c) {
						x++;
					}
					const l = Math.max(0, x0 + ox);
					const r = Math.min(W, x + ox);
					if (r > l) {
						ctx.fillStyle = fills[c];
						rect(left + l * PX, top + yy * PY, (r - l) * PX, PY);
					}
				}
			}

			const px = (x, y, w, hh) => rect(left + x * PX, top + y * PY, w * PX, hh * PY);

			// Dust puffs at his sides while crouched, and the shadow under the coin hop.
			ctx.fillStyle = colour('--clawd-fx');
			if (f.poof && f.off > 0) {
				for (const cx of [0, W - 2]) {
					const pts = 'dot' === f.poof ? [[0.6, 9.4, 0.8, 0.9]] : [[0, 9.6, 0.7, 0.6], [0.7, 9.1, 0.6, 0.6], [1.3, 9.6, 0.7, 0.6]];
					for (const [x, y, w, hh] of pts) {
						px(cx + x, y, w, hh);
					}
				}
			}
			if (f.shadow) {
				const [sc, sw] = 'wide' === f.shadow ? [6, 6] : [8, 2];
				rect(left + sc * PX, GROUND - 0.5 * PY, sw * PX, 0.5 * PY);
			}

			// Sand over the burrow, and grains flying from his legs.
			ctx.fillStyle = colour('--clawd-sand');
			if (f.dig >= 1) {
				px(-2, GROUND_ROW - 1, W + 4, 1);
			}
			if (f.dig >= 2) {
				px(-1, GROUND_ROW - 2, W + 2, 1);
			}
			if (f.dig >= 3) {
				px(-1, GROUND_ROW - 3, 2, 1);
				px(W - 1, GROUND_ROW - 3, 2, 1);
			}
			if (f.spray > 0) {
				for (const n of [0, 1]) {
					const d = f.spray + 2 * n;
					const sx = 1.5 + 0.9 * d;
					const sy = (GROUND_ROW - 2) - 0.9 * d * (5 - d) / 2;
					px(-sx, sy, 0.8, 0.8);
					px(W - 0.8 + sx, sy, 0.8, 0.8);
				}
			}

			// Nearly out of session: a sweat drop runs down his head.
			if (sweat) {
				const p = calm ? 0.3 : (this.tick % 20) / 20;
				ctx.fillStyle = colour('--clawd-sweat');
				ctx.globalAlpha = 1 - p;
				rect(left + (f.look < 0 ? 31 : 2) * S, top + (-2 + 6 * p) * S, 2 * S, 3 * S);
				ctx.globalAlpha = 1;
			}

			if (f.soul > 0.5) {
				this.drawSoul(rect, colour('--clawd-soul'), left + 9.5 * PX, GROUND - lift - 6 * PY, f.soul, f.soulT);
			}

			// Confetti falls, drifts and shimmers as it flips.
			if (this.confT >= 0) {
				this.confetti.forEach((c, i) => {
					c.y += c.v;
					c.x += c.d;
					if (c.y < GROUND) {
						ctx.fillStyle = c.colour;
						rect(c.x, c.y, (Math.floor((this.tick + i) / 2) % 2 ? 2.5 : 1.2) * S, 2.5 * S);
					}
				});
				this.confT = this.confT + 1 >= 45 ? -1 : this.confT + 1;
			}

			// Text: bubbles, the heart and the z's.
			ctx.setTransform(k, 0, 0, k, 0, 0);
			ctx.textAlign = 'center';
			ctx.textBaseline = 'alphabetic';
			const text = (str, x, y, size, fill, alpha = 1) => {
				ctx.font = `700 ${size}px ${colour('--font-display') || 'sans-serif'}`;
				ctx.fillStyle = fill;
				ctx.globalAlpha = Math.max(0, alpha);
				ctx.fillText(str, x, y);
				ctx.globalAlpha = 1;
			};
			const mid = left + MASCOT_W / 2;
			if (bubble) {
				const fill = '!' === bubble ? colour('--ok') : colour('--clawd-note');
				text(bubble, mid, top - 2 + 1.5 * S * Math.sin(this.tick / 3), 11 * S, fill);
			}
			if (zzz) {
				const p = calm ? 0.4 : (this.tick % 30) / 30;
				const zb = f.dig > 0 ? 9 : (f.off > 0 ? 12 : 19);
				text('z', left + (28 + 3 * Math.sin(p * 2 * Math.PI)) * S, GROUND - (zb + 14 * p) * S, (7 + 4 * p) * S, colour('--clawd-fx'), 1 - p);
			}
			if (this.loveT >= 0) {
				const p = this.loveT / 20;
				text('♥', mid + 2 * Math.sin(p * 6), top - (2 + 14 * p) * S, 10 * S, colour('--clawd-heart'), 1 - p);
				this.loveT = this.loveT + 1 >= 20 ? -1 : this.loveT + 1;
			}
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		}

		/** The soul: a see-through mini Clawd on a wiggly thread from his mouth at (mx, my). */
		drawSoul(rect, fill, mx, my, soulH, t) {
			const ctx = this.ctx;
			const p = SOUL_PX;
			const sway = 2.5 * Math.sin(t / 4);
			const add = (x, y, w) => rect(mx + x * S, my + y * S, w * S, p * S);
			ctx.fillStyle = fill;
			ctx.globalAlpha = 0.7 + 0.15 * Math.sin(t / 1.7);
			const n = Math.floor(soulH / p);
			for (let i = 0; i < n; i++) {
				const k = i / Math.max(1, n);
				const dx = sway * k + 1.2 * Math.sin(t / 2 + i * 0.7) * Math.sin(k * Math.PI);
				add(Math.round(dx / p) * p - p / 2, -(i + 1) * p, p);
			}
			const top = -soulH - SOUL_ART.length * p;
			const x0 = Math.round(sway / p) * p - 6 * p;
			SOUL_ART.forEach((row, y) => {
				for (const m of row.matchAll(/#+/g)) {
					add(x0 + m.index * p, top + y * p, m[0].length * p);
				}
			});
			ctx.globalAlpha = 1;
		}
	}

	/* --------------------------------------------------------------------- API */

	const instances = new Map(); // Card id → Clawd.

	/** The card's Clawd element, updated with the latest session data. */
	function mount(id, state) {
		let clawd = instances.get(id);
		if (!clawd) {
			clawd = new Clawd();
			instances.set(id, clawd);
			clawd.setActivity(activities.get(id));
		}
		clawd.update(state);
		clawd.start();
		return clawd.el;
	}

	const activities = new Map(); // Card id → { state, at }, kept for Clawds not built yet.

	/** Claude Code's latest state for a card. */
	function activity(id, value) {
		activities.set(id, value || null);
		const clawd = instances.get(id);
		if (clawd) {
			clawd.setActivity(value);
		}
	}

	window.BD.clawd = { mount, activity };
}());
