/**
 * Shared helpers. All DOM is built with h(), which only ever sets text,
 * never HTML, so nothing from an email subject or Slack message can inject
 * markup into the window.
 */
(function () {
	'use strict';

	/**
	 * Create an element.
	 *
	 * h('div', { class: 'x', on: { click: fn }, data: { id: 1 }, style: { '--v': '10%' } }, 'text', child)
	 */
	function h(tag, attrs, ...children) {
		const el = document.createElement(tag);
		for (const [key, value] of Object.entries(attrs || {})) {
			if (value === null || value === undefined || value === false) {
				continue;
			}
			if ('class' === key) {
				el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
			} else if ('on' === key) {
				for (const [event, fn] of Object.entries(value)) {
					el.addEventListener(event, fn);
				}
			} else if ('data' === key) {
				Object.assign(el.dataset, value);
			} else if ('style' === key) {
				// CSSOM, not a style attribute, so the CSP stays strict.
				for (const [prop, v] of Object.entries(value)) {
					el.style.setProperty(prop, v);
				}
			} else if ('text' === key) {
				el.textContent = value;
			} else if (true === value) {
				el.setAttribute(key, '');
			} else {
				el.setAttribute(key, String(value));
			}
		}
		for (const child of children.flat(Infinity)) {
			if (child === null || child === undefined || child === false) {
				continue;
			}
			el.append(child instanceof Node ? child : document.createTextNode(String(child)));
		}
		return el;
	}

	const MINUTE = 60000;
	const HOUR = 60 * MINUTE;
	const DAY = 24 * HOUR;

	/**
	 * "just now", "5 min ago", "3 h ago", "Mon 13 Oct".
	 */
	function ago(iso) {
		if (!iso) {
			return '';
		}
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < MINUTE) {
			return 'just now';
		}
		if (diff < HOUR) {
			return `${Math.floor(diff / MINUTE)} min ago`;
		}
		if (diff < DAY) {
			return `${Math.floor(diff / HOUR)} h ago`;
		}
		if (diff < 7 * DAY) {
			return `${Math.floor(diff / DAY)} d ago`;
		}
		return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	/**
	 * Short time for list rows: 14:05 today, "Mon" this week, "13 Oct" older.
	 */
	function shortTime(iso) {
		if (!iso) {
			return '';
		}
		const d = new Date(iso);
		const now = new Date();
		if (d.toDateString() === now.toDateString()) {
			return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
		}
		if (now - d < 6 * DAY) {
			return d.toLocaleDateString('en-GB', { weekday: 'short' });
		}
		return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	function sameDay(a, b) {
		return a.toDateString() === b.toDateString();
	}

	/**
	 * "Today", "Tomorrow", "Wed 15 Oct".
	 */
	function dayLabel(date) {
		const today = new Date();
		const tomorrow = new Date(today.getTime() + DAY);
		if (sameDay(date, today)) {
			return 'Today';
		}
		if (sameDay(date, tomorrow)) {
			return 'Tomorrow';
		}
		return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
	}

	function clockTime(date) {
		return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	}

	/**
	 * When an event is, relative to now: "Now", "in 25 min", "Today 14:00".
	 */
	function eventWhen(ev) {
		const start = new Date(ev.start);
		const end = new Date(ev.end || ev.start);
		const now = new Date();
		if (start <= now && end > now) {
			return ev.allDay ? 'Today · all day' : `Now · until ${clockTime(end)}`;
		}
		const diff = start - now;
		if (!ev.allDay && diff < HOUR) {
			return `In ${Math.max(1, Math.round(diff / MINUTE))} min`;
		}
		if (!ev.allDay && diff < 6 * HOUR && sameDay(start, now)) {
			// Round once, so 1 h 59.6 min shows as 2 h 0 min, not 1 h 60 min.
			const total = Math.round(diff / MINUTE);
			const hours = Math.floor(total / 60);
			const mins = total % 60;
			return `In ${hours} h ${mins} min · ${clockTime(start)}`;
		}
		return `${dayLabel(start)} · ${ev.allDay ? 'all day' : clockTime(start)}`;
	}

	/**
	 * Seconds → "3h 20m" / "45m".
	 */
	function duration(seconds) {
		const total = Math.round((seconds || 0) / 60);
		const hrs = Math.floor(total / 60);
		const mins = total % 60;
		return hrs ? `${hrs}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
	}

	function km(metres) {
		return `${((metres || 0) / 1000).toFixed(1)} km`;
	}

	function plural(n, one, many) {
		return `${n} ${1 === n ? one : many || `${one}s`}`;
	}

	/**
	 * Strip Electron's "Error invoking remote method 'x': Error: " prefix.
	 */
	function errorMessage(err) {
		return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
	}

	window.BD = { h, ago, shortTime, dayLabel, eventWhen, duration, km, plural, errorMessage, clockTime };
}());
