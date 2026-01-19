import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { startNextServer } from '../utils/next-server';

describe('api/scrape', () => {
  let baseUrl = '';
  let closeServer: (() => Promise<void>) | null = null;
  let mockSite: Server | null = null;
  let mockUrl = '';

  beforeAll(async () => {
    process.env.META_TEST_MODE = 'true';
    const server = await startNextServer();
    baseUrl = server.url;
    closeServer = server.close;

    mockSite = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><head><title>Test Title</title><meta name="description" content="Test desc"></head><body><h1>Hero</h1></body></html>'
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockSite?.listen(0, resolve);
    });

    const { port } = mockSite.address() as AddressInfo;
    mockUrl = `http://127.0.0.1:${port}/page`;
  });

  afterAll(async () => {
    if (mockSite) {
      await new Promise<void>((resolve, reject) =>
        mockSite?.close((err) => (err ? reject(err) : resolve()))
      );
    }
    if (closeServer) {
      await closeServer();
    }
  });

  it('extracts title, description, and h1', async () => {
    const response = await request(baseUrl)
      .post('/api/scrape/')
      .set('Content-Type', 'application/json')
      .send({ url: mockUrl });

    expect(response.status).toBe(200);
    expect(response.body.metaTitle).toBe('Test Title');
    expect(response.body.metaDescription).toBe('Test desc');
    expect(response.body.metaH1).toBe('Hero');
  });
});
