import { describe, expect, it, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import {
  computeBrandPolicy,
  enrichMetadataContext,
  resolveTitleCandidate,
  finalizeTitleDeterministic,
  validateDescriptionCandidate,
  clampDescription,
  validateTitleCandidate
} from '../../scripts/metadata-creation/lib/generate.mjs';

const SCRIPTS_DIR = resolve(__dirname, '../../scripts/metadata-creation');
const DEFAULT_OPTIONS = { gen_title: true, gen_desc: false, gen_h1: false, clamp_desc: true, bypass_brand_suffix: false };

const titleContext = (url: string, keyword: string, currentH1: string, options = DEFAULT_OPTIONS) =>
  enrichMetadataContext(
    { Address: url, Keyword: keyword, 'Title 1': '', 'Meta Description 1': '', 'H1-1': currentH1 },
    ['title'],
    'Acme',
    options
  );

describe('metadata-creation: brand policy', () => {
  it('never applies brand on the homepage', () => {
    expect(computeBrandPolicy({ url: 'https://example.com/', keyword: 'anything', brandName: 'Acme' })).toBe('never');
  });

  it('always applies brand on commercial paths', () => {
    expect(
      computeBrandPolicy({ url: 'https://example.com/products/widget', keyword: 'buy widgets', brandName: 'Acme' })
    ).toBe('always');
  });

  it('is conditional on blog/informational paths', () => {
    expect(
      computeBrandPolicy({ url: 'https://example.com/blog/how-to', keyword: 'how to do it', brandName: 'Acme' })
    ).toBe('conditional');
  });
});

describe('metadata-creation: title QA (validateTitleCandidate)', () => {
  it('rejects a title stapled on as a disconnected clause after a colon', () => {
    const context = titleContext('https://example.com/products/mendocino-n-cal-mag', 'liquid cal mag', 'Grow More Mendocino N-Cal-Mag');
    const result = validateTitleCandidate('Grow More Mendocino N-Cal-Mag: liquid cal mag', context);
    expect(result.codes).toContain('disconnected_keyword_clause');
  });

  it('rejects a dangling trailing separator', () => {
    const context = titleContext('https://example.com/x', 'widgets', '');
    const result = validateTitleCandidate('Best Widgets For Sale -', context);
    expect(result.codes).toContain('dangling_separator');
  });

  it('accepts a well-formed title in the preferred band with correct brand suffix', () => {
    const context = titleContext('https://example.com/products/widget', 'custom widgets', 'Custom Widgets for Retail Shops');
    const result = validateTitleCandidate('Custom Widgets Built Fast for Retail Shops Nationwide | Acme', context);
    expect(result.accepted).toBe(true);
    expect(result.band).toBe('preferred');
  });
});

describe('metadata-creation: deterministic title fallback (finalizeTitleDeterministic)', () => {
  it('lands a complete keyword-focused title in the preferred 55-65 range when the keyword alone is too short', () => {
    const context = titleContext(
      'https://example.com/blog/compressor-maintenance',
      'Industrial Air Compressor Maintenance Checklist',
      'Food Plants'
    );
    const seed = resolveTitleCandidate(context.keyword, context);
    const result = finalizeTitleDeterministic(seed, context);

    expect(result.title).toContain('Industrial Air Compressor Maintenance Checklist');
    expect(result.accepted).toBe(true);
    expect(result.title.length).toBeGreaterThanOrEqual(55);
    expect(result.title.length).toBeLessThanOrEqual(65);
  });

  it('allows the 66-70 fallback band when a required brand suffix preserves a long complete keyword phrase', () => {
    const keyword = 'Industrial Air Compressor Checklist for Food Processing Plants';
    const context = titleContext('https://example.com/services/food-processing-plants', keyword, '');
    const seed = resolveTitleCandidate(keyword, context);
    const result = finalizeTitleDeterministic(seed, context);

    expect(result.title).toContain(keyword);
    expect(result.title).toContain(' | Acme');
    expect(result.title.length).toBeGreaterThan(65);
    expect(result.title.length).toBeLessThanOrEqual(70);
  });

  it('expands a short thin title with a real differentiator from the H1', () => {
    const context = titleContext(
      'https://example.com/services/medical-clinics-surgery-centers',
      'Emergency HVAC Repair',
      'Medical Clinics and'
    );
    const seed = resolveTitleCandidate(context.keyword, context);
    const result = finalizeTitleDeterministic(seed, context);

    expect(result.title).toContain('Emergency HVAC Repair');
    expect(result.accepted).toBe(true);
    expect(result.title.length).toBeGreaterThanOrEqual(55);
    expect(result.title.length).toBeLessThanOrEqual(65);
  });

  it('repairs an incomplete-ending H1 differentiator instead of leaving a dangling word', () => {
    const context = titleContext(
      'https://example.com/blog/after-storm-damage',
      'Commercial Roof Repair for Houston Warehouses',
      'After'
    );
    const seed = resolveTitleCandidate(context.keyword, context);
    const result = finalizeTitleDeterministic(seed, context);

    expect(result.title).toContain('Commercial Roof Repair for Houston Warehouses');
    expect(result.title).toContain('After Storm Damage');
    expect(result.title.toLowerCase()).not.toMatch(/\bafter\s*$/);
  });
});

describe('metadata-creation: description QA', () => {
  it('flags a description that stops mid-sentence', () => {
    const result = validateDescriptionCandidate(
      'Enhance your plants with Grow More Sea Grow a balanced seaweed fertilizer blend featuring essential nutrients for robust growth. Perfect for all gardening',
      true
    );
    expect(result.accepted).toBe(false);
    expect(result.codes).toContain('missing_terminal_punctuation');
  });

  it('clamp fallback repairs a mid-sentence cut into a complete, bounded sentence', () => {
    const clamped = clampDescription(
      'Enhance your plants with Grow More Sea Grow a balanced seaweed fertilizer blend featuring essential nutrients for robust growth. Perfect for all gardening',
      160
    );
    expect(clamped.length).toBeLessThanOrEqual(160);
    expect(/[.!?]$/.test(clamped)).toBe(true);
    expect(clamped.toLowerCase()).not.toMatch(/\b(to|for|and|with|of|in|on|at|from|by|after|before)\s*$/);
  });
});

describe('metadata-creation: CLI pipeline', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'metadata-creation-test-'));
  });

  const run = (script: string, args: string[]) =>
    execFileSync(process.execPath, [join(SCRIPTS_DIR, script), ...args], { encoding: 'utf8' });

  it('accepts a first draft that already passes QA with no rewrite round needed', () => {
    const kwCsv = join(dir, 'kw.csv');
    const sfCsv = join(dir, 'sf.csv');
    writeFileSync(kwCsv, 'URL,Keyword\nhttps://example.com/blog/compressor-maintenance,Industrial Air Compressor Maintenance Checklist\n');
    writeFileSync(
      sfCsv,
      'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/blog/compressor-maintenance,Old Title,Old Desc,Food Plants\n'
    );

    const contextsPath = join(dir, 'contexts.json');
    run('build-contexts.mjs', ['--kw-csv', kwCsv, '--sf-csv', sfCsv, '--brand', 'Acme', '--no-gen-desc', '--out', contextsPath]);

    const contexts = JSON.parse(readFileSync(contextsPath, 'utf8'));
    expect(contexts.rows).toHaveLength(1);
    const context = contexts.rows[0].context;

    const draftsPath = join(dir, 'drafts.json');
    writeFileSync(
      draftsPath,
      JSON.stringify({ rows: [{ index: 0, title: `${context.keyword} ${context.currentH1}` }] })
    );

    const statePath = join(dir, 'state.json');
    const pendingPath = join(dir, 'pending.json');
    run('validate.mjs', ['--contexts', contextsPath, '--drafts', draftsPath, '--out-state', statePath, '--out-pending', pendingPath]);

    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(pending.rows).toHaveLength(0);

    const outCsv = join(dir, 'out.csv');
    const finalizeOut = JSON.parse(run('finalize.mjs', ['--contexts', contextsPath, '--state', statePath, '--out', outCsv]));
    expect(finalizeOut.titleFellBackToDeterministic).toBe(0);

    const rows = parse(readFileSync(outCsv, 'utf8'), { columns: true, skip_empty_lines: true });
    expect(rows[0]['New Title']).toContain('Industrial Air Compressor Maintenance Checklist');
  });

  it('runs a rewrite round for a rejected title and accepts the fixed version', () => {
    const kwCsv = join(dir, 'kw.csv');
    const sfCsv = join(dir, 'sf.csv');
    writeFileSync(kwCsv, 'URL,Keyword\nhttps://example.com/products/widget,custom widgets\n');
    writeFileSync(
      sfCsv,
      'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/products/widget,Old Title,Old Desc,Custom Widgets for Retail Shops\n'
    );

    const contextsPath = join(dir, 'contexts.json');
    run('build-contexts.mjs', ['--kw-csv', kwCsv, '--sf-csv', sfCsv, '--brand', 'Acme', '--no-gen-desc', '--out', contextsPath]);

    const statePath = join(dir, 'state.json');
    const pendingPath = join(dir, 'pending.json');

    // Round 1: deliberately bad draft (too short, no differentiator).
    const drafts1 = join(dir, 'drafts1.json');
    writeFileSync(drafts1, JSON.stringify({ rows: [{ index: 0, title: 'Widgets' }] }));
    run('validate.mjs', ['--contexts', contextsPath, '--drafts', drafts1, '--out-state', statePath, '--out-pending', pendingPath]);

    let pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].field).toBe('title');

    // Round 2: fixed rewrite.
    const drafts2 = join(dir, 'drafts2.json');
    writeFileSync(drafts2, JSON.stringify({ rows: [{ index: 0, title: 'Custom Widgets Built Fast for Retail Shops Nationwide' }] }));
    run('validate.mjs', [
      '--contexts', contextsPath,
      '--drafts', drafts2,
      '--state', statePath,
      '--out-state', statePath,
      '--out-pending', pendingPath
    ]);

    pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(pending.rows).toHaveLength(0);

    const outCsv = join(dir, 'out.csv');
    run('finalize.mjs', ['--contexts', contextsPath, '--state', statePath, '--out', outCsv]);
    const rows = parse(readFileSync(outCsv, 'utf8'), { columns: true, skip_empty_lines: true });
    expect(rows[0]['New Title']).toContain('Custom Widgets');
    expect(rows[0]['New Title']).toContain('| Acme');
  });

  it('falls back to the deterministic repair once the rewrite budget is exhausted', () => {
    const kwCsv = join(dir, 'kw.csv');
    const sfCsv = join(dir, 'sf.csv');
    writeFileSync(kwCsv, 'URL,Keyword\nhttps://example.com/services/medical-clinics-surgery-centers,Emergency HVAC Repair\n');
    writeFileSync(
      sfCsv,
      'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/services/medical-clinics-surgery-centers,Old Title,Old Desc,Medical Clinics and\n'
    );

    const contextsPath = join(dir, 'contexts.json');
    run('build-contexts.mjs', ['--kw-csv', kwCsv, '--sf-csv', sfCsv, '--brand', 'Acme', '--no-gen-desc', '--out', contextsPath]);

    const statePath = join(dir, 'state.json');
    const pendingPath = join(dir, 'pending.json');

    // Every round submits a deliberately unfixable (too-short, no
    // differentiator) draft, so the row should exhaust its 3-evaluation
    // budget (1 initial + 2 rewrites) and never get accepted.
    let stateArg: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const draftsPath = join(dir, `drafts-${round}.json`);
      writeFileSync(draftsPath, JSON.stringify({ rows: [{ index: 0, title: 'HVAC' }] }));
      run('validate.mjs', ['--contexts', contextsPath, '--drafts', draftsPath, ...stateArg, '--out-state', statePath, '--out-pending', pendingPath]);
      stateArg = ['--state', statePath];
    }

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.rows[0].title.status).toBe('exhausted');

    const outCsv = join(dir, 'out.csv');
    const finalizeOut = JSON.parse(run('finalize.mjs', ['--contexts', contextsPath, '--state', statePath, '--out', outCsv]));
    expect(finalizeOut.titleFellBackToDeterministic).toBe(1);

    const rows = parse(readFileSync(outCsv, 'utf8'), { columns: true, skip_empty_lines: true });
    expect(rows[0]['New Title']).toContain('Emergency HVAC Repair');
    expect(rows[0]['New Title'].length).toBeLessThanOrEqual(70);
  });

  it('scrape.mjs --skip writes blank current-value rows with no network calls', () => {
    const kwCsv = join(dir, 'kw.csv');
    writeFileSync(kwCsv, 'URL,Keyword\nhttps://example.com/a,keyword a\nhttps://example.com/b,keyword b\n');
    const sfCsv = join(dir, 'sf.csv');

    const result = JSON.parse(run('scrape.mjs', ['--kw-csv', kwCsv, '--out', sfCsv, '--skip']));
    expect(result.rows).toBe(2);
    expect(result.scraped).toBe(0);

    const rows = parse(readFileSync(sfCsv, 'utf8'), { columns: true, skip_empty_lines: true });
    expect(rows).toHaveLength(2);
    expect(rows[0]['Title 1']).toBe('');
  });

  it('build-contexts.mjs fails clearly when the brand is missing', () => {
    const kwCsv = join(dir, 'kw.csv');
    const sfCsv = join(dir, 'sf.csv');
    writeFileSync(kwCsv, 'URL,Keyword\nhttps://example.com/a,keyword\n');
    writeFileSync(sfCsv, 'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/a,,,\n');

    expect(() =>
      run('build-contexts.mjs', ['--kw-csv', kwCsv, '--sf-csv', sfCsv, '--out', join(dir, 'contexts.json')])
    ).toThrow();
  });
});
