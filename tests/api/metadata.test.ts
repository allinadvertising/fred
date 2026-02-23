import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { parse } from 'csv-parse/sync';
import { startNextServer } from '../utils/next-server';

describe('api/metadata', () => {
  let baseUrl = '';
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.META_TEST_MODE = 'true';
    const server = await startNextServer();
    baseUrl = server.url;
    closeServer = server.close;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('applies brand suffix once on commercial pages', async () => {
    const kwCsv = 'URL,Keyword\nhttps://example.com/products/widgets,Acme widgets\n';
    const sfCsv =
      'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/products/widgets,Old Acme Title,Old Desc,Old H1\n';

    const response = await request(baseUrl)
      .post('/api/metadata/?format=csv')
      .set('Content-Type', 'application/json')
      .send({
        kw_csv: kwCsv,
        sf_csv: sfCsv,
        brand: 'Acme',
        gen_title: true,
        gen_desc: true,
        gen_h1: false,
        clamp_title: true,
        clamp_desc: true
      });

    expect(response.status).toBe(200);
    const rows = parse(response.text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    const title = rows[0]?.['New Title'] ?? '';
    const brandMatches = title.match(/Acme/g) ?? [];

    expect(title).toContain(' | Acme');
    expect(brandMatches).toHaveLength(1);
    expect(title.length).toBeLessThanOrEqual(70);
  });

  it('omits brand on homepage titles and removes bad trailing stop words', async () => {
    const kwCsv = 'URL,Keyword\nhttps://example.com/,widgets for\n';
    const sfCsv = 'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/,Old Title,Old Desc,\n';

    const response = await request(baseUrl)
      .post('/api/metadata/?format=csv')
      .set('Content-Type', 'application/json')
      .send({
        kw_csv: kwCsv,
        sf_csv: sfCsv,
        brand: 'Acme',
        gen_title: true,
        gen_desc: false,
        gen_h1: false,
        clamp_title: true,
        clamp_desc: true
      });

    expect(response.status).toBe(200);
    const rows = parse(response.text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    const title = rows[0]?.['New Title'] ?? '';

    expect(title).not.toContain(' | Acme');
    expect(title.toLowerCase()).not.toMatch(/\b(to|for|and|with|of|in)\s*$/);
  });

  it('bypasses pipe-brand suffix when requested', async () => {
    const kwCsv = 'URL,Keyword\nhttps://example.com/products/widgets,Acme widgets\n';
    const sfCsv =
      'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/products/widgets,Old Title,Old Desc,Widget Catalog and Specs\n';

    const response = await request(baseUrl)
      .post('/api/metadata/?format=csv')
      .set('Content-Type', 'application/json')
      .send({
        kw_csv: kwCsv,
        sf_csv: sfCsv,
        brand: 'Acme',
        gen_title: true,
        gen_desc: false,
        gen_h1: false,
        clamp_title: true,
        clamp_desc: true,
        bypass_brand_suffix: true
      });

    expect(response.status).toBe(200);
    const rows = parse(response.text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    const title = rows[0]?.['New Title'] ?? '';

    expect(title).not.toContain(' | Acme');
    expect(title).toContain('Acme widgets');
    expect(title.length).toBeLessThanOrEqual(70);
  });

  it('allows complete titles above 60 chars when needed for keyword coverage', async () => {
    const kwCsv =
      'URL,Keyword\nhttps://example.com/services/compressor-maintenance,industrial air compressor maintenance checklist\n';
    const sfCsv =
      'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/services/compressor-maintenance,Old Title,Old Desc,2026 playbook\n';

    const response = await request(baseUrl)
      .post('/api/metadata/?format=csv')
      .set('Content-Type', 'application/json')
      .send({
        kw_csv: kwCsv,
        sf_csv: sfCsv,
        brand: 'Acme',
        gen_title: true,
        gen_desc: false,
        gen_h1: false,
        clamp_title: true,
        clamp_desc: true,
        bypass_brand_suffix: true
      });

    expect(response.status).toBe(200);
    const rows = parse(response.text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    const title = rows[0]?.['New Title'] ?? '';

    expect(title).toContain('industrial air compressor maintenance checklist');
    expect(title.length).toBeGreaterThan(60);
    expect(title.length).toBeLessThanOrEqual(70);
  });
});
