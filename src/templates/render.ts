/**
 * A deliberately tiny template renderer. No dependency, no arbitrary expressions,
 * no partials loaded from disk -- the attack surface of a templating language is
 * not worth it for a system whose templates render personal data into letters.
 *
 * Supported syntax:
 *   {{ key }}            -- interpolate, throws if missing (never silently blank)
 *   {{ key? }}           -- interpolate, empty string if missing
 *   {{#key}}...{{/key}}  -- render block if key is truthy / repeat for arrays
 *   {{^key}}...{{/key}}  -- render block if key is falsy or an empty array
 *   {{ . }}              -- the current item inside an array block
 */

export class TemplateError extends Error {}

export type Scope = Record<string, unknown>;

const BLOCK = /\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
const VAR = /\{\{\s*([\w.]+)(\?)?\s*\}\}/g;

function lookup(scope: Scope, path: string): unknown {
  if (path === '.') return scope['.'];
  let cur: unknown = scope;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

export function render(template: string, scope: Scope): string {
  // Blocks first, innermost-last; repeat until stable so nesting works.
  let out = template;
  for (let pass = 0; pass < 10; pass++) {
    const before = out;
    out = out.replace(BLOCK, (_m, kind: string, key: string, body: string) => {
      const v = lookup(scope, key);
      if (kind === '^') return truthy(v) ? '' : render(body, scope);
      if (!truthy(v)) return '';
      if (Array.isArray(v)) {
        return v.map((item) => render(body, { ...scope, '.': item, ...(isScope(item) ? item : {}) })).join('');
      }
      return render(body, { ...scope, ...(isScope(v) ? v : {}) });
    });
    if (out === before) break;
  }

  out = out.replace(VAR, (_m, key: string, optional?: string) => {
    const v = lookup(scope, key);
    if (v === undefined || v === null) {
      if (optional) return '';
      throw new TemplateError(`template variable "${key}" is missing and not marked optional ({{ ${key}? }})`);
    }
    return String(v);
  });

  return out;
}

function isScope(v: unknown): v is Scope {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Normalise whitespace produced by block removal, so letters read cleanly. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}
