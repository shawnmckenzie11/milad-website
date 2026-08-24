import { EmailMessage } from 'cloudflare:email';
import { site } from '../src/lib/site';

const ALLOWED_PROGRAMS = new Set([
	'coop',
	'undergrad',
	'masters',
	'phd',
	'postdoc',
	'staff',
	'collaboration',
]);

const ALLOWED_ELIGIBILITY = new Set([
	'permanent-resident',
	'canadian-citizen',
	'international',
]);

const PROGRAM_LABELS: Record<string, string> = {
	coop: 'Co-op',
	undergrad: 'Undergraduate',
	masters: "Master's",
	phd: 'Doctoral',
	postdoc: 'Postdoctoral',
	staff: 'Staff',
	collaboration: 'Collaboration',
};

const ELIGIBILITY_LABELS: Record<string, string> = {
	'permanent-resident': 'Permanent Resident',
	'canadian-citizen': 'Canadian Citizen',
	international: 'International',
};

const ALLOWED_ATTACHMENT_TYPES = new Set([
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'text/plain',
	'application/rtf',
	'text/rtf',
]);

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;

interface JoinFields {
	name: string;
	email: string;
	program: string;
	programLabel: string;
	eligibility: string;
	eligibilityLabel: string;
	comments: string;
}

interface JoinAttachment {
	filename: string;
	type: string;
	content: ArrayBuffer;
}

/**
 * Returns whether a string looks like a usable email address.
 * @param value - Raw email field value
 */
function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Reads and trims a single text field from multipart form data.
 * @param formData - Incoming form body
 * @param key - Field name
 */
function readField(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * Escapes text for inclusion in an HTML email body.
 * @param value - Plain-text value
 */
function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * Encodes a UTF-8 string as base64 for MIME bodies and headers.
 * @param value - UTF-8 text
 */
function utf8ToBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * Encodes binary content as base64 with MIME line wrapping.
 * @param buffer - File bytes
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const encoded = btoa(binary);
	return encoded.replace(/(.{76})/g, '$1\r\n').trim();
}

/**
 * Encodes an unstructured header value, using RFC 2047 when non-ASCII.
 * @param value - Header text
 */
function encodeHeaderValue(value: string): string {
	if (/^[\x20-\x7E]*$/.test(value)) {
		return value;
	}
	return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

/**
 * Builds the plain-text body for a join inquiry.
 * @param fields - Validated form fields
 */
function buildPlainBody(fields: JoinFields): string {
	return [
		'Work With Us inquiry',
		'',
		`Name: ${fields.name}`,
		`Email: ${fields.email}`,
		`Program of interest: ${fields.programLabel}`,
		`Work eligibility: ${fields.eligibilityLabel || 'Not specified'}`,
		'',
		'Comments:',
		fields.comments || '(none)',
	].join('\n');
}

/**
 * Builds a simple HTML body for a join inquiry.
 * @param fields - Validated form fields
 */
function buildHtmlBody(fields: JoinFields): string {
	const comments = fields.comments
		? escapeHtml(fields.comments).replaceAll('\n', '<br />')
		: '(none)';
	return [
		'<h1>Work With Us inquiry</h1>',
		`<p><strong>Name:</strong> ${escapeHtml(fields.name)}</p>`,
		`<p><strong>Email:</strong> ${escapeHtml(fields.email)}</p>`,
		`<p><strong>Program of interest:</strong> ${escapeHtml(fields.programLabel)}</p>`,
		`<p><strong>Work eligibility:</strong> ${escapeHtml(fields.eligibilityLabel || 'Not specified')}</p>`,
		`<p><strong>Comments:</strong><br />${comments}</p>`,
	].join('');
}

/**
 * Builds a raw MIME message so the EmailMessage binding can send attachments.
 * @param fields - Validated form fields
 * @param attachments - Files that fit the size and type limits
 */
function buildRawMime(fields: JoinFields, attachments: JoinAttachment[]): string {
	const subject = `Work With Us — ${fields.programLabel}`;
	const boundary = `milad-join-${crypto.randomUUID()}`;
	const lines = [
		`From: ${encodeHeaderValue(site.labName)} <${site.joinFromEmail}>`,
		`To: ${site.joinInbox}`,
		`Reply-To: ${fields.email}`,
		`Subject: ${encodeHeaderValue(subject)}`,
		'MIME-Version: 1.0',
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/plain; charset="UTF-8"',
		'Content-Transfer-Encoding: base64',
		'',
		utf8ToBase64(buildPlainBody(fields)),
		`--${boundary}`,
		'Content-Type: text/html; charset="UTF-8"',
		'Content-Transfer-Encoding: base64',
		'',
		utf8ToBase64(buildHtmlBody(fields)),
	];

	for (const attachment of attachments) {
		const safeName = attachment.filename.replace(/["\r\n]/g, '_');
		lines.push(
			`--${boundary}`,
			`Content-Type: ${attachment.type || 'application/octet-stream'}; name="${safeName}"`,
			'Content-Transfer-Encoding: base64',
			`Content-Disposition: attachment; filename="${safeName}"`,
			'',
			arrayBufferToBase64(attachment.content),
		);
	}

	lines.push(`--${boundary}--`, '');
	return lines.join('\r\n');
}

/**
 * Reads uploaded files, skipping any that exceed type or size limits.
 * @param formData - Incoming form body
 */
async function readAttachments(
	formData: FormData,
): Promise<{ attachments: JoinAttachment[]; omitted: boolean }> {
	const files = formData
		.getAll('attachments')
		.filter((value): value is File => value instanceof File && value.size > 0);

	const attachments: JoinAttachment[] = [];
	let omitted = files.length > MAX_ATTACHMENT_COUNT;
	let total = 0;

	for (const file of files.slice(0, MAX_ATTACHMENT_COUNT)) {
		const type = file.type || 'application/octet-stream';
		const tooLarge = file.size > MAX_ATTACHMENT_BYTES;
		const typeOk = ALLOWED_ATTACHMENT_TYPES.has(type) || /\.(pdf|docx?|txt|rtf)$/i.test(file.name);
		if (tooLarge || !typeOk || total + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
			omitted = true;
			continue;
		}
		total += file.size;
		attachments.push({
			filename: file.name || 'attachment',
			type,
			content: await file.arrayBuffer(),
		});
	}

	return { attachments, omitted };
}

/**
 * Validates required join-form fields and known select values.
 * @param formData - Incoming form body
 */
function parseJoinFields(formData: FormData): JoinFields | null {
	const name = readField(formData, 'name');
	const email = readField(formData, 'email');
	const program = readField(formData, 'program');
	const eligibility = readField(formData, 'eligibility');
	const comments = readField(formData, 'comments');

	if (!name || !isValidEmail(email) || !ALLOWED_PROGRAMS.has(program)) {
		return null;
	}
	if (eligibility && !ALLOWED_ELIGIBILITY.has(eligibility)) {
		return null;
	}

	return {
		name,
		email,
		program,
		programLabel: PROGRAM_LABELS[program] ?? program,
		eligibility,
		eligibilityLabel: eligibility ? ELIGIBILITY_LABELS[eligibility] ?? eligibility : '',
		comments,
	};
}

/**
 * Returns a JSON response for the join API.
 * @param status - HTTP status
 * @param body - JSON-serializable payload
 */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
}

/**
 * Sends the inquiry through the Email binding, preferring the object API
 * and falling back to a raw MIME EmailMessage when the binding requires it.
 * @param env - Worker bindings
 * @param fields - Validated form fields
 * @param attachments - Files to include when the binding accepts them
 */
async function sendJoinEmail(
	env: Env,
	fields: JoinFields,
	attachments: JoinAttachment[],
): Promise<void> {
	const subject = `Work With Us — ${fields.programLabel}`;
	const text = buildPlainBody(fields);
	const html = buildHtmlBody(fields);

	try {
		await env.EMAIL.send({
			to: site.joinInbox,
			from: { email: site.joinFromEmail, name: site.labName },
			replyTo: fields.email,
			subject,
			text,
			html,
			attachments: attachments.map((attachment) => ({
				filename: attachment.filename,
				type: attachment.type,
				content: attachment.content,
				disposition: 'attachment',
			})),
		});
		return;
	} catch (error) {
		console.warn('Email object send failed; trying MIME EmailMessage.', error);
	}

	const raw = buildRawMime(fields, attachments);
	await env.EMAIL.send(new EmailMessage(site.joinFromEmail, site.joinInbox, raw));
}

/**
 * Handles POST /api/join from the Work With Us form.
 * @param request - Incoming request
 * @param env - Worker bindings
 */
async function handleJoinRequest(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
	}

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
		return jsonResponse(400, { ok: false, error: 'invalid' });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return jsonResponse(400, { ok: false, error: 'invalid' });
	}

	const fields = parseJoinFields(formData);
	if (!fields) {
		return jsonResponse(400, { ok: false, error: 'invalid' });
	}

	const { attachments, omitted } = await readAttachments(formData);

	try {
		await sendJoinEmail(env, fields, attachments);
	} catch (error) {
		console.error('Join form email send failed.', error);
		return jsonResponse(502, { ok: false, error: 'send_failed' });
	}

	return jsonResponse(200, { ok: true, attachmentsOmitted: omitted });
}

export default {
	/**
	 * Routes join-form POSTs to email and lets static assets handle the site.
	 * @param request - Incoming request
	 * @param env - Worker bindings
	 */
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === site.joinApiPath) {
			return handleJoinRequest(request, env);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
