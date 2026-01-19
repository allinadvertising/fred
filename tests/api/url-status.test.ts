import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { startNextServer } from '../utils/next-server';

describe('api/url-status', () => {
  let baseUrl = '';
  let closeServer: (() => Promise<void>) | null = null;
  let mockSite: Server | null = null;
  let okUrl = '';
  let redirectUrl = '';
  let notFoundUrl = '';

  beforeAll(async () => {
    process.env.META_TEST_MODE = 'true';
    const server = await startNextServer();
    baseUrl = server.url;
    closeServer = server.close;

    mockSite = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('ok');
        return;
      }

      if (req.url === '/redirect') {
        res.writeHead(301, { Location: '/ok' });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockSite?.listen(0, resolve);
    });

    const { port } = mockSite.address() as AddressInfo;
    okUrl = `http://127.0.0.1:${port}/ok`;
    redirectUrl = `http://127.0.0.1:${port}/redirect`;
    notFoundUrl = `http://127.0.0.1:${port}/missing`;
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

  it('returns a 200 status', async () => {
    const response = await request(baseUrl)
      .post('/api/url-status/')
      .set('Content-Type', 'application/json')
      .send({ url: okUrl });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(200);
  });

  it('returns a 301 status for redirects', async () => {
    const response = await request(baseUrl)
      .post('/api/url-status/')
      .set('Content-Type', 'application/json')
      .send({ url: redirectUrl });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(301);
  });

  it('returns a 404 status for missing pages', async () => {
    const response = await request(baseUrl)
      .post('/api/url-status/')
      .set('Content-Type', 'application/json')
      .send({ url: notFoundUrl });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(404);
  });
});
