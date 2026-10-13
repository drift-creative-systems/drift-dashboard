/**
 * IMAP mailboxes: latest messages and unread count, read-only.
 *
 * Two presets share this code:
 *  - gmail:  imap.gmail.com:993 with a Google app password.
 *  - proton: Proton Mail Bridge on 127.0.0.1:1143 (STARTTLS, self-signed
 *            certificate, so certificate checks are relaxed for localhost only).
 */
const { ImapFlow } = require('imapflow');

const LATEST = 3;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

function isLocal(host) {
	return LOCAL_HOSTS.includes(String(host).toLowerCase());
}

/**
 * Turn connection errors into something you can act on.
 */
function explain(err, preset) {
	const msg = String((err && (err.responseText || err.message)) || err);
	if (err && (err.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(msg))) {
		return 'gmail' === preset.id
			? 'Gmail rejected the login. Use an app password (not your normal password) and check IMAP is allowed.'
			: 'Login rejected. Use the password Proton Bridge shows you, not your Proton password.';
	}
	if (err && 'ECONNREFUSED' === err.code) {
		return 'proton' === preset.id
			? 'Proton Mail Bridge isn’t running. Start Bridge and it will reconnect.'
			: 'Connection refused by the mail server.';
	}
	if (err && ('ETIMEDOUT' === err.code || 'ENOTFOUND' === err.code)) {
		return 'Couldn’t reach the mail server. Check your connection.';
	}
	return msg;
}

function webUrl(preset, account, messageId) {
	const email = account.config.email || '';
	if ('gmail' === preset.id) {
		const base = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}`;
		return messageId ? `${base}#search/rfc822msgid:${encodeURIComponent(messageId)}` : base;
	}
	return account.config.web_url || preset.webUrl;
}

function make(preset) {
	return {
		id: preset.id,
		name: preset.name,
		section: 'email',
		interval: 2 * 60 * 1000,
		oauth: false,
		help: preset.help,
		fields: [
			{ key: 'email', label: 'Email address', type: 'text', required: true },
			{ key: 'password', label: preset.passwordLabel, type: 'password', secret: true, required: true },
			{ key: 'host', label: 'IMAP server', type: 'text', placeholder: preset.host, advanced: true },
			{ key: 'port', label: 'Port', type: 'text', placeholder: String(preset.port), advanced: true },
			{ key: 'unread_only', label: 'Only show unread emails', type: 'checkbox', default: true },
		],

		async fetch(account, ctx) {
			const secrets = ctx.secrets();
			if (!account.config.email || !secrets.password) {
				throw new Error('Add the email address and password in Settings.');
			}
			const host = account.config.host || preset.host;
			const port = Number(account.config.port) || preset.port;

			const client = new ImapFlow({
				host,
				port,
				secure: 993 === port,
				auth: { user: account.config.email, pass: secrets.password },
				logger: false,
				emitLogs: false,
				connectionTimeout: 20000,
				greetingTimeout: 15000,
				socketTimeout: 60000,
				// Bridge uses a self-signed certificate. Only ever relaxed on loopback.
				tls: { rejectUnauthorized: !isLocal(host) },
			});
			// Stop late socket errors from crashing the app; they're logged instead.
			client.on('error', (err) => console.error(`[imap:${preset.id}]`, err.message));

			try {
				await client.connect();
				const status = await client.status('INBOX', { messages: true, unseen: true });
				const messages = [];
				// Unset on cards saved before this option existed, which means on.
				const unreadOnly = account.config.unread_only !== false;

				if (unreadOnly ? status.unseen > 0 : status.messages > 0) {
					const lock = await client.getMailboxLock('INBOX', { readOnly: true });
					try {
						// Newest last in both cases, so take the end of the list.
						const range = unreadOnly
							? ((await client.search({ seen: false })) || []).slice(-LATEST)
							: `${Math.max(1, status.messages - LATEST + 1)}:*`;
						const fetchable = Array.isArray(range) ? range.length > 0 : true;
						for await (const msg of (fetchable ? client.fetch(range, { envelope: true, flags: true, internalDate: true }) : [])) {
							const sender = (msg.envelope.from && msg.envelope.from[0]) || {};
							messages.push({
								from: sender.name || sender.address || 'Unknown sender',
								subject: msg.envelope.subject || '(no subject)',
								date: (msg.internalDate || msg.envelope.date || new Date()).toISOString(),
								unread: !(msg.flags && msg.flags.has('\\Seen')),
								url: webUrl(preset, account, msg.envelope.messageId),
							});
						}
					} finally {
						lock.release();
					}
				}

				messages.sort((a, b) => b.date.localeCompare(a.date));
				return {
					email: account.config.email,
					unread: status.unseen || 0,
					unreadOnly,
					messages,
					url: webUrl(preset, account),
				};
			} catch (err) {
				throw new Error(explain(err, preset));
			} finally {
				try {
					await client.logout();
				} catch {
					client.close();
				}
			}
		},
	};
}

module.exports = {
	gmail: make({
		id: 'gmail',
		name: 'Gmail',
		host: 'imap.gmail.com',
		port: 993,
		passwordLabel: 'App password (16 letters)',
		webUrl: 'https://mail.google.com/',
		help: 'Needs 2-Step Verification and an app password: myaccount.google.com/apppasswords',
	}),
	proton: make({
		id: 'proton',
		name: 'Proton Mail',
		host: '127.0.0.1',
		port: 1143,
		passwordLabel: 'Bridge password',
		webUrl: 'https://mail.proton.me/',
		help: 'Needs Proton Mail Bridge running (paid Proton plan). Use the username and password Bridge shows.',
	}),
};
