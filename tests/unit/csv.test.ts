import { describe, expect, it } from 'vitest';
import { buildSfCsv, findColumn, normalizeUrlForFetch, parseCsvText } from '@/lib/csv';

describe('csv helpers', () => {
  it('parses keyword mapping CSV rows and fields', () => {
    const text = 'URL,Keyword\nhttps://example.com,widgets\n';
    const result = parseCsvText(text);
    expect(result.errors).toEqual([]);
    expect(result.fields).toEqual(['URL', 'Keyword']);
    expect(result.rows).toEqual([{ URL: 'https://example.com', Keyword: 'widgets' }]);
  });

  it('finds columns case-insensitively', () => {
    const fields = ['Url', 'Primary Keyword'];
    expect(findColumn(fields, ['URL', 'Address'])).toBe('Url');
    expect(findColumn(fields, ['Primary Keyword', 'Keyword'])).toBe('Primary Keyword');
  });

  it('normalizes URLs with missing scheme', () => {
    expect(normalizeUrlForFetch('example.com/page')).toBe('http://example.com/page');
  });

  it('builds a Screaming Frog-compatible CSV', () => {
    const csv = buildSfCsv([
      { Address: 'https://example.com', 'Title 1': 'Title', 'Meta Description 1': 'Desc', 'H1-1': 'H1' }
    ]);
    expect(csv.split('\n')[0]).toBe('Address,Title 1,Meta Description 1,H1-1');
    expect(csv).toContain('https://example.com,Title,Desc,H1');
  });
});
