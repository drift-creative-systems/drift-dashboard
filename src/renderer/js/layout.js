/**
 * Rearrangeable sections (currently "Right now"): each card sits in a slot
 * that can be dragged by its grip, moved with the arrow keys, and sized with
 * width (1–3 columns) and height (normal / tall / compact) presets.
 *
 * Slots stay put when a card refreshes (only the card inside is swapped),
 * so sizes and drag handlers survive updates. Order and sizes are saved to
 * config.json via the main process.
 */
(function () {
	'use strict';

	const { h } = window.BD;

	const HEIGHTS = ['normal', 'tall', 'compact'];
	const HEIGHT_LABEL = { normal: 'Normal height', tall: 'Tall', compact: 'Compact' };
	const HEIGHT_ICON = { normal: '↕', tall: '⇳', compact: '⇕' };

	let api = null; // { getLayout, setLayout, onResize }

	function sectionLayout(section) {
		const all = api.getLayout() || {};
		return all[section] || { order: [], sizes: {} };
	}

	/** A card's size, falling back to its default width. */
	function sizeOf(section, id, defaultW = 1) {
		const size = sectionLayout(section).sizes[id];
		return size || { w: defaultW, h: 'normal' };
	}

	function persist(section, grid) {
		const current = sectionLayout(section);
		const next = {
			order: [...grid.children].map((slot) => slot.dataset.slot).filter(Boolean),
			sizes: current.sizes,
		};
		api.setLayout(section, next);
	}

	function applySize(slot, size) {
		slot.classList.remove('w-1', 'w-2', 'w-3', 'h-normal', 'h-tall', 'h-compact');
		slot.classList.add(`w-${size.w}`, `h-${size.h}`);
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

	/* ----------------------------------------------------------- Drag + drop */

	let dragging = null;

	function onDragOver(event) {
		if (!dragging) {
			return;
		}
		const target = event.currentTarget;
		if (target === dragging || target.parentNode !== dragging.parentNode) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		// Before or after, depending on which half of the target the pointer is over.
		const rect = target.getBoundingClientRect();
		const after = event.clientX > rect.left + rect.width / 2;
		const ref = after ? target.nextSibling : target;
		if (ref !== dragging && ref !== dragging.nextSibling) {
			target.parentNode.insertBefore(dragging, ref);
		}
	}

	/* ------------------------------------------------------------------ Slots */

	/**
	 * Wrap cards in slots, in the saved order. Cards not in the saved order
	 * (new accounts) go at the end in their default order.
	 *
	 * @param {string} section
	 * @param {{id: string, node: Element, title: string, defaultW?: number}[]} entries
	 * @returns {Element[]} slots
	 */
	function slots(section, entries) {
		const saved = sectionLayout(section).order;
		const rank = (id) => {
			const i = saved.indexOf(id);
			return -1 === i ? saved.length + entries.findIndex((e) => e.id === id) : i;
		};
		return [...entries]
			.sort((a, b) => rank(a.id) - rank(b.id))
			.map((entry) => slot(section, entry));
	}

	function slot(section, { id, node, title, defaultW = 1 }) {
		let size = sizeOf(section, id, defaultW);

		const el = h('div', { class: 'slot', data: { slot: id } }, node);
		applySize(el, size);

		const setSize = (next, message) => {
			size = next;
			applySize(el, size);
			const current = sectionLayout(section);
			api.setLayout(section, { order: current.order, sizes: { ...current.sizes, [id]: size } });
			widthBtn.setAttribute('aria-label', `Width: ${size.w} column${1 === size.w ? '' : 's'}. Change width of ${title}`);
			widthBtn.lastChild.textContent = String(size.w);
			heightBtn.setAttribute('aria-label', `${HEIGHT_LABEL[size.h]}. Change height of ${title}`);
			heightBtn.firstChild.textContent = HEIGHT_ICON[size.h];
			announce(message);
			api.onResize(id, size);
		};

		const grip = h('button', {
			type: 'button',
			class: 'slot__btn slot__grip',
			title: 'Drag to move (or use the arrow keys)',
			'aria-label': `Move ${title}. Use the arrow keys to move it earlier or later.`,
		}, '⠿');

		const widthBtn = h('button', {
			type: 'button',
			class: 'slot__btn',
			title: 'Width',
			'aria-label': `Width: ${size.w} column${1 === size.w ? '' : 's'}. Change width of ${title}`,
			on: { click: () => setSize({ ...size, w: (size.w % 3) + 1 }, `${title}: ${(size.w % 3) + 1} columns wide`) },
		}, h('span', { 'aria-hidden': 'true' }, '⇔ '), String(size.w));

		const heightBtn = h('button', {
			type: 'button',
			class: 'slot__btn',
			title: 'Height',
			'aria-label': `${HEIGHT_LABEL[size.h]}. Change height of ${title}`,
			on: {
				click: () => {
					const next = HEIGHTS[(HEIGHTS.indexOf(size.h) + 1) % HEIGHTS.length];
					setSize({ ...size, h: next }, `${title}: ${HEIGHT_LABEL[next].toLowerCase()}`);
				},
			},
		}, HEIGHT_ICON[size.h]);

		el.append(h('div', { class: 'slot__tools' }, grip, widthBtn, heightBtn));

		// Only draggable while the grip is held, so text in cards stays selectable.
		grip.addEventListener('pointerdown', () => {
			el.draggable = true;
		});
		el.addEventListener('dragstart', (event) => {
			dragging = el;
			el.classList.add('is-dragging');
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		});
		el.addEventListener('dragend', () => {
			el.classList.remove('is-dragging');
			el.draggable = false;
			dragging = null;
			persist(section, el.parentNode);
		});
		el.addEventListener('dragover', onDragOver);
		el.addEventListener('drop', (event) => event.preventDefault());

		// Keyboard: arrows move the card one place.
		grip.addEventListener('keydown', (event) => {
			const earlier = ['ArrowLeft', 'ArrowUp'].includes(event.key);
			const later = ['ArrowRight', 'ArrowDown'].includes(event.key);
			if (!earlier && !later) {
				return;
			}
			event.preventDefault();
			const sibling = earlier ? el.previousElementSibling : el.nextElementSibling;
			if (!sibling) {
				return;
			}
			el.parentNode.insertBefore(el, earlier ? sibling : sibling.nextSibling);
			grip.focus();
			persist(section, el.parentNode);
			const position = [...el.parentNode.children].indexOf(el) + 1;
			announce(`${title} moved to position ${position} of ${el.parentNode.children.length}`);
		});

		return el;
	}

	function init(options) {
		api = options;
	}

	window.BD.layout = { init, slots, sizeOf };
}());
