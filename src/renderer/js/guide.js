/**
 * Setup guides in Settings: a README section (Markdown) turned into DOM.
 *
 * Handles what the README uses: paragraphs, numbered and bullet lists
 * (nested by indentation), code blocks, "> " notes, **bold**, *italic*,
 * `code` and [links](https://…). Everything is inserted as text through
 * h(), never as HTML. Links open through the main process like any other
 * dashboard link, and only https ones are clickable.
 */
(function () {
	'use strict';

	const { h } = window.BD;

	const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/g;

	/** One line of Markdown → text nodes and elements. */
	function inline(text) {
		const out = [];
		let last = 0;
		for (const m of text.matchAll(INLINE)) {
			if (m.index > last) {
				out.push(text.slice(last, m.index));
			}
			const t = m[0];
			if (t.startsWith('**')) {
				out.push(h('strong', null, inline(t.slice(2, -2))));
			} else if (t.startsWith('`')) {
				out.push(h('code', null, t.slice(1, -1)));
			} else if (t.startsWith('[')) {
				const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
				out.push(/^https:\/\//i.test(url)
					? h('a', {
						href: url,
						class: 'guide__link',
						on: {
							click: (event) => {
								event.preventDefault();
								window.dashboard.openLink(url);
							},
						},
					}, inline(label))
					: h('span', null, inline(label)));
			} else {
				out.push(h('em', null, inline(t.slice(1, -1))));
			}
			last = m.index + t.length;
		}
		if (last < text.length) {
			out.push(text.slice(last));
		}
		return out;
	}

	function indentOf(line) {
		return /^\s*/.exec(line)[0].replace(/\t/g, '    ').length;
	}

	function codeBlock(lines) {
		const code = lines.join('\n');
		const status = h('span', { class: 'guide__copied', role: 'status' });
		return h('div', { class: 'guide__code' },
			h('pre', null, h('code', null, code)),
			h('button', {
				type: 'button',
				class: 'btn btn--small guide__copy',
				on: {
					click: async () => {
						try {
							await navigator.clipboard.writeText(code);
							status.textContent = 'Copied';
						} catch {
							status.textContent = 'Couldn’t copy. Select the text instead.';
						}
						setTimeout(() => {
							status.textContent = '';
						}, 2000);
					},
				},
			}, 'Copy'),
			status
		);
	}

	/**
	 * Markdown text → a <div class="guide"> element.
	 */
	function render(markdown) {
		const root = h('div', { class: 'guide' });
		const lines = String(markdown || '').split(/\r?\n/);
		const lists = []; // Open lists, outermost first: { indent, el, ordered }
		let para = null; // Lines of the paragraph being collected: { lines, into }

		const target = () => {
			const top = lists[lists.length - 1];
			return top && top.el.lastElementChild ? top.el.lastElementChild : root;
		};
		const flushPara = () => {
			if (para) {
				para.into.append(h('p', null, inline(para.lines.join(' '))));
				para = null;
			}
		};
		const closeListsDeeperThan = (indent) => {
			while (lists.length && lists[lists.length - 1].indent > indent) {
				lists.pop();
			}
		};

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const indent = indentOf(line);
			const trimmed = line.trim();

			if (!trimmed) {
				flushPara();
				continue;
			}

			// Code block: dedent by the fence's own indent.
			if (trimmed.startsWith('```')) {
				flushPara();
				if (!indent) {
					lists.length = 0;
				}
				const body = [];
				for (i += 1; i < lines.length && !lines[i].trim().startsWith('```'); i++) {
					body.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))));
				}
				target().append(codeBlock(body));
				continue;
			}

			const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
			if (item) {
				flushPara();
				const ordered = /\d/.test(item[2]);
				closeListsDeeperThan(indent);
				let top = lists[lists.length - 1];
				if (top && top.indent === indent && top.ordered !== ordered) {
					lists.pop();
					top = lists[lists.length - 1];
				}
				if (!top || top.indent < indent) {
					const el = h(ordered ? 'ol' : 'ul', { class: 'guide__list' });
					(top && top.el.lastElementChild ? top.el.lastElementChild : root).append(el);
					top = { indent, el, ordered };
					lists.push(top);
				}
				top.el.append(h('li', null, inline(item[3])));
				continue;
			}

			// Unindented text ends any list.
			if (!indent) {
				lists.length = 0;
			} else {
				closeListsDeeperThan(indent - 1);
			}

			if (trimmed.startsWith('>')) {
				flushPara();
				target().append(h('p', { class: 'guide__note' }, inline(trimmed.replace(/^>\s?/, ''))));
				continue;
			}
			if (trimmed.startsWith('|')) {
				// Tables aren't used in setup steps; show the row as text.
				flushPara();
				target().append(h('p', { class: 'guide__table-row' }, inline(trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' · '))));
				continue;
			}

			// Plain text: joins the paragraph, or continues the list item above it.
			if (para && para.into === target()) {
				para.lines.push(trimmed);
			} else {
				flushPara();
				const into = target();
				if (into !== root && into.tagName === 'LI' && !into.querySelector('p, ul, ol, div') && lines[i - 1] && lines[i - 1].trim()) {
					// A wrapped list item: keep it on the same line.
					into.append(' ', ...inline(trimmed));
				} else {
					para = { lines: [trimmed], into };
				}
			}
		}
		flushPara();
		return root;
	}

	window.BD.guide = { render };
}());
