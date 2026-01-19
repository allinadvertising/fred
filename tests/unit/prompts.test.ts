import { describe, expect, it } from 'vitest';
import { buildPromptOutputs, type FormValues } from '@/lib/prompts';

describe('prompts', () => {
  it('includes CSV continuity instruction in CSV outputs', () => {
    const values: FormValues = {
      clientName: 'Acme',
      clientUrl: 'https://example.com',
      businessType: '',
      knownProducts: '',
      focus: '',
      targetMarket: 'USA',
      keywordUrls: 'https://example.com/page'
    };

    const outputs = buildPromptOutputs(values);
    const prompt2 = outputs.find((item) => item.id === 'prompt2');
    const prompt3 = outputs.find((item) => item.id === 'prompt3');

    expect(prompt2?.content).toContain('keep generating until the full CSV is complete');
    expect(prompt3?.content).toContain('keep generating until the full CSV is complete');
  });

  it('requires Keyword Difficulty from Ahrefs or 0', () => {
    const values: FormValues = {
      clientName: 'Acme',
      clientUrl: 'https://example.com',
      businessType: '',
      knownProducts: '',
      focus: '',
      targetMarket: 'USA',
      keywordUrls: 'https://example.com/page'
    };

    const outputs = buildPromptOutputs(values);
    const prompt2 = outputs.find((item) => item.id === 'prompt2');

    expect(prompt2?.content).toContain('Keyword Difficulty (from Ahrefs; if missing, output 0)');
    expect(prompt2?.content).toContain('Keyword Difficulty must be the exact Ahrefs value; if unavailable, output 0.');
  });
});
