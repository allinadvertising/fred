import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
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

  it('returns a CSV with brand suffix applied', async () => {
    const kwCsv = 'URL,Keyword\nhttps://example.com,widgets\n';
    const sfCsv = 'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com,Old Title,Old Desc,Old H1\n';

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
    expect(response.text).toContain('New Title');
    expect(response.text).toContain(' | Acme');
  });
});
