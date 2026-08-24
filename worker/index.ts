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
function buildPlainBody(fields: JoinFields, attachments: JoinAttachment[]): string {
	const attachmentLines =
		attachments.length > 0
			? ['', 'Attachments:', ...attachments.map((file) => `- ${file.filename}`)]
			: [];
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
		...attachmentLines,
	].join('\n');
}

/**
 * Wraps base64 at 76 characters per RFC 2045.
 * @param value - Unwrapped base64
 */
function wrapBase64(value: string): string {
	return value.replace(/(.{76})/g, '$1\r\n').trim();
}

/**
 * Builds a raw MIME message. Only a single text/plain body is included so
 * clients do not render the same inquiry twice (plain + HTML).
 * @param fields - Validated form fields
 * @param attachments - Files that fit the size and type limits
 */
function buildRawMime(fields: JoinFields, attachments: JoinAttachment[]): string {
	const subject = `Work With Us — ${fields.programLabel}`;
	const body = wrapBase64(utf8ToBase64(buildPlainBody(fields, attachments)));
	const sharedHeaders = [
		`From: ${encodeHeaderValue(site.labName)} <${site.joinFromEmail}>`,
		`To: ${site.joinInbox}`,
		`Reply-To: ${fields.email}`,
		`Subject: ${encodeHeaderValue(subject)}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@mckenzian.com>`,
		'MIME-Version: 1.0',
	];

	if (attachments.length === 0) {
		return [
			...sharedHeaders,
			'Content-Type: text/plain; charset="UTF-8"',
			'Content-Transfer-Encoding: base64',
			'',
			body,
			'',
		].join('\r\n');
	}

	const mixedBoundary = `milad-mixed-${crypto.randomUUID()}`;
	const lines = [
		...sharedHeaders,
		`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
		'',
		`--${mixedBoundary}`,
		'Content-Type: text/plain; charset="UTF-8"',
		'Content-Transfer-Encoding: base64',
		'',
		body,
	];

	for (const attachment of attachments) {
		const safeName = attachment.filename.replace(/["\r\n]/g, '_');
		const encodedName = encodeURIComponent(attachment.filename).replace(/['()]/g, '');
		lines.push(
			`--${mixedBoundary}`,
			`Content-Type: ${attachment.type || 'application/octet-stream'}; name="${safeName}"`,
			'Content-Transfer-Encoding: base64',
			`Content-Disposition: attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
			'',
			arrayBufferToBase64(attachment.content),
		);
	}

	lines.push(`--${mixedBoundary}--`, '');
	return lines.join('\r\n');
}

/**
 * Returns whether a form entry is an uploaded file with content.
 * Avoids `instanceof File`, which can fail across Worker/runtime realms.
 * @param value - FormData entry
 */
function isUploadedFile(value: FormDataEntryValue): value is File {
	return (
		typeof value === 'object' &&
		value !== null &&
		'arrayBuffer' in value &&
		'name' in value &&
		'size' in value &&
		typeof (value as File).size === 'number' &&
		(value as File).size > 0
	);
}

async function readAttachments(
	formData: FormData,
): Promise<{ attachments: JoinAttachment[]; omitted: boolean }> {
	const files = [
		...formData.getAll('attachments'),
		...formData.getAll('attachment'),
	].filter(isUploadedFile);

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
 * Sends the inquiry with a raw MIME EmailMessage (Email Routing send_email
 * binding). The object-style send() can resolve without delivering on that
 * binding, which is why the form previously showed success with no inbox mail.
 * @param env - Worker bindings
 * @param fields - Validated form fields
 * @param attachments - Files to include when the binding accepts them
 */
async function sendJoinEmail(
	env: Env,
	fields: JoinFields,
	attachments: JoinAttachment[],
): Promise<void> {
	const raw = buildRawMime(fields, attachments);
	const result = await env.EMAIL.send(
		new EmailMessage(site.joinFromEmail, site.joinInbox, raw),
	);
	if (result && typeof result === 'object' && 'messageId' in result && !result.messageId) {
		throw new Error('Email binding returned an empty message id.');
	}
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
