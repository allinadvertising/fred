import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPromptOutputs } from '../../scripts/kwr-process/lib/prompts.mjs';
import { isValidUrl, normalizeInput, validate } from '../../scripts/kwr-process/build-prompts.mjs';
import { describeStatus, normalizeUrlForCheck } from '../../scripts/kwr-process/check-urls.mjs';

const BUILD_PROMPTS_CLI = resolve(__dirname, '../../scripts/kwr-process/build-prompts.mjs');

const writeTempJson = (data: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'kwr-process-test-'));
  const file = join(dir, 'input.json');
  writeFileSync(file, JSON.stringify(data), 'utf8');
  return file;
};

describe('kwr-process prompts', () => {
  const baseValues = {
    clientName: 'Acme',
    clientUrl: 'https://example.com',
    businessType: '',
    knownProducts: '',
    focus: '',
    targetMarket: 'USA',
    keywordUrls: 'https://example.com/page'
  };

  it('includes CSV continuity instruction in CSV outputs', () => {
    const outputs = buildPromptOutputs(baseValues);
    const prompt2 = outputs.find((item) => item.id === 'prompt2');
    const prompt3 = outputs.find((item) => item.id === 'prompt3');

    expect(prompt2?.content).toContain('keep generating until the full CSV is complete');
    expect(prompt3?.content).toContain('keep generating until the full CSV is complete');
  });

  it('requires Keyword Difficulty from Ahrefs or 0', () => {
    const outputs = buildPromptOutputs(baseValues);
    const prompt2 = outputs.find((item) => item.id === 'prompt2');

    expect(prompt2?.content).toContain('Keyword Difficulty (from Ahrefs; if missing, output 0)');
    expect(prompt2?.content).toContain('Keyword Difficulty must be the exact Ahrefs value; if unavailable, output 0.');
  });

  it('renders empty optional fields as "Not provided"', () => {
    const outputs = buildPromptOutputs(baseValues);
    const prompt1 = outputs.find((item) => item.id === 'prompt1');
    expect(prompt1?.content).toContain('**BUSINESS_TYPE (optional):** Not provided');
  });
});

describe('kwr-process build-prompts CLI helpers', () => {
  it('validates required fields', () => {
    const errors = validate({
      clientName: '',
      clientUrl: '',
      businessType: '',
      knownProducts: '',
      focus: '',
      targetMarket: '',
      keywordUrls: ''
    });
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(['clientName', 'clientUrl', 'targetMarket', 'keywordUrls'])
    );
  });

  it('rejects a malformed clientUrl', () => {
    const errors = validate({
      clientName: 'Acme',
      clientUrl: 'not-a-url',
      businessType: '',
      knownProducts: '',
      focus: '',
      targetMarket: 'USA',
      keywordUrls: 'https://example.com'
    });
    expect(errors.clientUrl).toBe('Enter a valid http(s) URL.');
  });

  it('accepts a valid http(s) URL', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('normalizes an array keywordUrls into a newline-joined string', () => {
    const values = normalizeInput({
      clientName: 'Acme',
      clientUrl: 'https://example.com',
      targetMarket: 'USA',
      keywordUrls: ['https://example.com/a', ' https://example.com/b ', '']
    });
    expect(values.keywordUrls).toBe('https://example.com/a\nhttps://example.com/b');
  });

  it('runs end-to-end via the CLI and prints the three prompts as JSON', () => {
    const inputFile = writeTempJson({
      clientName: 'Acme',
      clientUrl: 'https://example.com',
      targetMarket: 'USA',
      keywordUrls: ['https://example.com/a']
    });

    const stdout = execFileSync(process.execPath, [BUILD_PROMPTS_CLI, '--input', inputFile], {
      encoding: 'utf8'
    });
    const outputs = JSON.parse(stdout);
    expect(outputs).toHaveLength(3);
    expect(outputs.map((item: { id: string }) => item.id)).toEqual(['prompt1', 'prompt2', 'prompt3']);
  });

  it('exits non-zero with a validation error when required fields are missing', () => {
    const inputFile = writeTempJson({ clientName: 'Acme' });
    expect(() =>
      execFileSync(process.execPath, [BUILD_PROMPTS_CLI, '--input', inputFile], { encoding: 'utf8' })
    ).toThrow();
  });
});

describe('kwr-process check-urls CLI helpers', () => {
  it('normalizes a bare domain to https', () => {
    expect(normalizeUrlForCheck('example.com/page')).toBe('https://example.com/page');
  });

  it('keeps an explicit http scheme', () => {
    expect(normalizeUrlForCheck('http://example.com')).toBe('http://example.com/');
  });

  it('rejects an unparseable value', () => {
    expect(normalizeUrlForCheck('::::')).toBe('');
  });

  it('returns an empty string for a blank value', () => {
    expect(normalizeUrlForCheck('   ')).toBe('');
  });

  it('describes common status codes', () => {
    expect(describeStatus('404')).toContain('Not found');
    expect(describeStatus('301')).toContain('Moved permanently');
    expect(describeStatus('invalid')).toContain('Invalid URL');
    expect(describeStatus('200')).toBe('Non-200 response.');
  });
});
