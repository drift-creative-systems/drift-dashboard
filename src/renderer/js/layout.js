/**
 * Rearrangeable sections (currently "Right now"): a board of columns, each a
 * stack of cards. Cards are dragged by their grip into any column (or moved
 * with the arrow keys) and have height presets (normal / tall / compact).
 * The number of columns (2–5) is picked next to the section heading.
 *
 * Slots stay put when a card refreshes (only the card inside is swapped),
 * so sizes and drag handlers survive updates. Columns and sizes are saved
 * to config.json via the main process.
 */
(function () {
	'use strict';

	const { h } = window.BD;

	const COUNTS = [2, 3, 4, 5];
	const DEFAULT_COUNT = 4;
	const HEIGHTS = ['normal', 'tall', 'compact'];
	const HEIGHT_LABEL = { normal: 'Normal height', tall: 'Tall', compact: 'Compact' };
	const HEIGHT_ICON = { normal: '↕', tall: '⇳', compact: '⇕' };

	let api = null; // { getLayout, setLayout, onResize, onColumns }

	function sectionLayout(section) {
		const all = api.getLayout() || {};
		const saved = all[section] || {};
		return {
			count: COUNTS.includes(saved.count) ? saved.count : DEFAULT_COUNT,
			columns: Array.isArray(saved.columns) ? saved.columns : null,
			order: Array.isArray(saved.order) ? saved.order : [], // Layout saved by 1.1.0.
			sizes: saved.sizes || {},
		};
	}

	/** A card's size (`{ h }`), falling back to normal height. */
	function sizeOf(section, id) {
		const size = sectionLayout(section).sizes[id];
		return { h: size && HEIGHTS.includes(size.h) ? size.h : 'normal' };
	}

	/** Card IDs per column, read from the board as it is now. */
	function readColumns(board) {
		return [...board.children].map((col) => [...col.children].map((slot) => slot.dataset.slot));
	}

	function persist(section, board) {
		const current = sectionLayout(section);
		api.setLayout(section, { count: current.count, columns: readColumns(board), sizes: current.sizes });
	}

	function applySize(slot, size) {
		slot.classList.remove('h-normal', 'h-tall', 'h-compact');
		slot.classList.add(`h-${size.h}`);
	}

	/** Polite announcement for screen readers after a move or resize. */
	function announce(text) {
		const live = document.getElementById('layout-live');
		if (live) {
			live.textContent = '';
			window.setTimeout(() => {
				live.textContent = text;
			}, 50);
		}
	}

	function where(slot) {
		const col = slot.parentNode;
		const board = col.parentNode;
		const colIndex = [...board.children].indexOf(col) + 1;
		const position = [...col.children].indexOf(slot) + 1;
		return `column ${colIndex} of ${board.children.length}, position ${position} of ${col.children.length}`;
	}

	/* ----------------------------------------------------------- Drag + drop */

	let dragging = null;

	/**
	 * Dragging over a column: put the card above the first card whose middle
	 * is below the pointer, or at the bottom. Works for empty columns too.
	 */
	function onColumnDragOver(event) {
		const col = event.currentTarget;
		if (!dragging || dragging.parentNode.parentNode !== col.parentNode) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const before = [...col.children].find((slot) => {
			if (slot === dragging) {
				return false;
			}
			const rect = slot.getBoundingClientRect();
			return event.clientY < rect.top + rect.height / 2;
		}) || null;
		if (dragging.parentNode !== col || dragging.nextElementSibling !== before) {
			col.insertBefore(dragging, before);
		}
	}

	/* ------------------------------------------------------------------ Board */

	/**
	 * Build the board: saved columns first, then any cards not yet placed
	 * (new accounts) into whichever column has the fewest cards.
	 *
	 * @param {string} section
	 * @param {{id: string, node: Element, title: string}[]} entries
	 * @returns {Element}
	 */
	function board(section, entries) {
		const saved = sectionLayout(section);
		const byId = new Map(entries.map((e) => [e.id, e]));
		const columns = Array.from({ length: saved.count }, () => []);
		const place = (id, index) => {
			if (byId.has(id)) {
				columns[index].push(id);
				byId.delete(id);
			}
		};

		if (saved.columns) {
			// Fewer columns than saved: extra columns join the last one.
			saved.columns.forEach((ids, i) => ids.forEach((id) => place(id, Math.min(i, saved.count - 1))));
		} else {
			// 1.1.0 saved a single order: deal it out left to right.
			saved.order.forEach((id, i) => place(id, i % saved.count));
		}
		for (const id of [...byId.keys()]) {
			const shortest = columns.reduce((best, col, i) => (col.length < columns[best].length ? i : best), 0);
			place(id, shortest);
		}

		const lookup = new Map(entries.map((e) => [e.id, e]));
		const el = h('div', { class: 'board', style: { '--cols': String(saved.count) } },
			columns.map((ids) => {
				const col = h('div', { class: 'board__col' }, ids.map((id) => slot(section, lookup.get(id))));
				col.addEventListener('dragover', onColumnDragOver);
				col.addEventListener('drop', (event) => event.preventDefault());
				return col;
			})
		);
		return el;
	}

	/** "Columns 2 3 4 5" buttons for the section heading. */
	function columnPicker(section) {
		const count = sectionLayout(section).count;
		return h('div', { class: 'cols-picker', role: 'group', 'aria-label': 'Number of columns' },
			h('span', { class: 'cols-picker__label', 'aria-hidden': 'true' }, 'Columns'),
			COUNTS.map((n) => h('button', {
				type: 'button',
				class: 'cols-picker__btn',
				'aria-pressed': String(n === count),
				'aria-label': `${n} columns`,
				data: { cols: String(n) },
				on: {
					click: () => {
						if (n === count) {
							return;
						}
						// Keep the saved columns (which still hold any columns merged
						// away by a smaller count), so going back restores them.
						const current = sectionLayout(section);
						const live = document.querySelector('.board');
						api.setLayout(section, {
							count: n,
							columns: current.columns || (live ? readColumns(live) : []),
							sizes: current.sizes,
						});
						api.onColumns();
						const again = document.querySelector(`.cols-picker__btn[data-cols="${n}"]`);
						if (again) {
							again.focus();
						}
						announce(`${n} columns`);
					},
				},
			}, String(n)))
		);
	}

	function slot(section, { id, node, title }) {
		let size = sizeOf(section, id);

		const el = h('div', { class: 'slot', data: { slot: id } }, node);
		applySize(el, size);

		const heightBtn = h('button', {
			type: 'button',
			class: 'slot__btn',
			title: 'Height',
			'aria-label': `${HEIGHT_LABEL[size.h]}. Change height of ${title}`,
			on: {
				click: () => {
					size = { h: HEIGHTS[(HEIGHTS.indexOf(size.h) + 1) % HEIGHTS.length] };
					applySize(el, size);
					const current = sectionLayout(section);
					api.setLayout(section, {
						count: current.count,
						columns: readColumns(el.parentNode.parentNode),
						sizes: { ...current.sizes, [id]: size },
					});
					heightBtn.setAttribute('aria-label', `${HEIGHT_LABEL[size.h]}. Change height of ${title}`);
					heightBtn.textContent = HEIGHT_ICON[size.h];
					announce(`${title}: ${HEIGHT_LABEL[size.h].toLowerCase()}`);
					api.onResize(id, size);
				},
			},
		}, HEIGHT_ICON[size.h]);

		const grip = h('button', {
			type: 'button',
			class: 'slot__btn slot__grip',
			title: 'Drag to move (or use the arrow keys)',
			'aria-label': `Move ${title}. Up and down arrows move it within its column, left and right move it to another column.`,
		}, '⠿');

		el.append(h('div', { class: 'slot__tools' }, grip, heightBtn));

		// Only draggable while the grip is held, so text in cards stays selectable.
		grip.addEventListener('pointerdown', () => {
			el.draggable = true;
		});
		el.addEventListener('dragstart', (event) => {
			dragging = el;
			el.classList.add('is-dragging');
			el.parentNode.parentNode.classList.add('is-dragging');
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		});
		el.addEventListener('dragend', () => {
			const boardEl = el.parentNode.parentNode;
			el.classList.remove('is-dragging');
			boardEl.classList.remove('is-dragging');
			el.draggable = false;
			dragging = null;
			persist(section, boardEl);
		});

		// Keyboard: up/down within the column, left/right to the next column
		// (at the same position, or the bottom if that column is shorter).
		grip.addEventListener('keydown', (event) => {
			const col = el.parentNode;
			const boardEl = col.parentNode;
			let moved = false;
			if ('ArrowUp' === event.key && el.previousElementSibling) {
				col.insertBefore(el, el.previousElementSibling);
				moved = true;
			} else if ('ArrowDown' === event.key && el.nextElementSibling) {
				col.insertBefore(el, el.nextElementSibling.nextElementSibling);
				moved = true;
			} else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
				const target = 'ArrowLeft' === event.key ? col.previousElementSibling : col.nextElementSibling;
				if (target) {
					const index = [...col.children].indexOf(el);
					target.insertBefore(el, target.children[index] || null);
					moved = true;
				}
			} else {
				return;
			}
			event.preventDefault();
			if (moved) {
				grip.focus();
				persist(section, boardEl);
				announce(`${title} moved to ${where(el)}`);
			}
		});

		return el;
	}

	function init(options) {
		api = options;
	}

	window.BD.layout = { init, board, columnPicker, sizeOf };
}());
