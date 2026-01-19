import next from 'next';
import { createServer } from 'http';
import type { AddressInfo } from 'net';

type NextTestServer = {
  url: string;
  close: () => Promise<void>;
};

export const startNextServer = async (): Promise<NextTestServer> => {
  const app = next({ dev: true, dir: process.cwd() });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => handle(req, res));

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  };
};
