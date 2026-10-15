function stripControlCharacters(input: string): string {
  let output = '';
  for (const char of input) {
    const code = char.charCodeAt(0);
    const isControl =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127;
    output += isControl ? ' ' : char;
  }
  return output;
}

export function sanitizeExcerpt(input: string, max = 1500): string {
  const withoutTags = input.replace(/<[^>]*>/g, ' ');
  const collapsed = stripControlCharacters(withoutTags).replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(gclid|fbclid|mc_cid|mc_eid|ref)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    const query = parsed.searchParams.toString();
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.host.toLowerCase()}${path}${query ? `?${query}` : ''}`;
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
