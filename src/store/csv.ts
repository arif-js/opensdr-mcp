const FORMULA_PREFIX = /^[ ]*[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const guarded = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  if (
    guarded.includes('"') ||
    guarded.includes(',') ||
    guarded.includes('\n') ||
    guarded.includes('\r')
  ) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function toCsv(rows: unknown[][], options: { bom?: boolean } = {}): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  const prefix = options.bom === false ? '' : '\uFEFF';
  return rows.length > 0 ? `${prefix}${body}\r\n` : prefix;
}
