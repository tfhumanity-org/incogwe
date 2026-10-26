/**
 * Inbound reply mailbox.
 *
 * Replies arrive out of band (IMAP poll, SES/SNS webhook, Postfix pipe -- operator's
 * choice) and are handed to `ingest()`. The only deletewe-specific requirement is
 * that the reply can be tied back to a request, which we do with a plus-addressed
 * reply-to and fall back to a reference in the subject line.
 */
import type { InboundReply } from '../types.ts';
import { newId } from '../util/ids.ts';

export class MailboxError extends Error {}

/** `deletions+thr_abc123@example.org` -> `thr_abc123` */
export function replyAddressFor(base: string, threadKey: string): string {
  const [local, domain] = base.split('@');
  if (!local || !domain) throw new MailboxError(`invalid base reply address: ${base}`);
  return `${local}+${threadKey}@${domain}`;
}

const PLUS_RE = /\+([A-Za-z0-9_]+)@/;
const REF_RE = /\b(thr_[A-Za-z0-9]{8,})\b/;

/**
 * Recover the thread key. Checks, in order: the plus-address we sent from, the
 * In-Reply-To / References headers, then the subject line. Returns null if the
 * reply cannot be attributed -- an unattributed reply is queued, never guessed at.
 */
export function resolveThreadKey(reply: Pick<InboundReply, 'toAddress' | 'subject' | 'headers'>): string | null {
  const plus = PLUS_RE.exec(reply.toAddress);
  if (plus?.[1]) return plus[1];

  for (const key of ['in-reply-to', 'references', 'x-deletewe-thread']) {
    const v = reply.headers[key] ?? reply.headers[key.toLowerCase()];
    const m = v ? REF_RE.exec(v) : null;
    if (m?.[1]) return m[1];
  }

  const subj = REF_RE.exec(reply.subject);
  return subj?.[1] ?? null;
}

export interface RawMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly receivedAt: Date;
  readonly headers?: Record<string, string>;
}

export function ingest(raw: RawMessage): InboundReply {
  const headers = Object.fromEntries(
    Object.entries(raw.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const base = {
    toAddress: raw.to,
    subject: raw.subject,
    headers,
  };
  return {
    id: newId('reply'),
    threadKey: resolveThreadKey(base),
    fromAddress: raw.from,
    toAddress: raw.to,
    subject: raw.subject,
    receivedAt: raw.receivedAt.toISOString(),
    body: raw.body,
    headers,
  };
}

/** Parse a minimal RFC822-ish .eml, enough for test fixtures and simple pipes. */
export function parseEml(text: string, receivedAt: Date): RawMessage {
  const idx = text.search(/\r?\n\r?\n/);
  const headerBlock = idx === -1 ? text : text.slice(0, idx);
  const body = idx === -1 ? '' : text.slice(idx).replace(/^\r?\n\r?\n/, '');

  const headers: Record<string, string> = {};
  let lastKey = '';
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^\s/.test(line) && lastKey) { headers[lastKey] += ' ' + line.trim(); continue; }
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    lastKey = m[1]!.toLowerCase();
    headers[lastKey] = m[2] ?? '';
  }

  const addr = (v: string | undefined) => {
    if (!v) return '';
    const m = /<([^>]+)>/.exec(v);
    return (m?.[1] ?? v).trim();
  };

  return {
    from: addr(headers['from']),
    to: addr(headers['to']),
    subject: headers['subject'] ?? '',
    body,
    receivedAt,
    headers,
  };
}
