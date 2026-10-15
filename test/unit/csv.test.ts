import { describe, expect, it } from 'vitest';
import { escapeCsvCell, toCsv } from '../../src/store/csv.js';

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('escapeCsvCell', () => {
  it("prefixes a formula with a quote so it can't execute", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
  });

  it('guards +, -, @ and tab leading characters', () => {
    expect(escapeCsvCell('+1')).toContain("'+1");
    expect(escapeCsvCell('-1')).toContain("'-1");
    expect(escapeCsvCell('@cmd')).toContain("'@cmd");
    expect(escapeCsvCell('\tcmd')).toContain("'\tcmd");
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });

  it('quotes commas and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });
});

describe('toCsv', () => {
  it('writes a UTF-8 BOM and CRLF endings', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('round-trips commas, quotes and newlines through a standard parser', () => {
    const rows = [
      ['name', 'note'],
      ['Jane, Doe', 'He said "hi"'],
      ['Multi', 'line\nbreak'],
    ];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed[1]).toEqual(['Jane, Doe', 'He said "hi"']);
    expect(parsed[2]).toEqual(['Multi', 'line\nbreak']);
  });

  it('keeps the formula guard after a parser round-trip', () => {
    const parsed = parseCsv(toCsv([['=1+1']]));
    expect(parsed[0][0]).toBe("'=1+1");
  });
});
