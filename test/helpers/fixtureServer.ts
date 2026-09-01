import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureServer {
  url: string;
  requests: { method: string; url: string }[];
  close(): Promise<void>;
}

export async function startFixtureServer(opts: {
  html: string;
  status?: number;
  redirectTo?: string;
}): Promise<FixtureServer> {
  const requests: { method: string; url: string }[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/' });
    // Drain any body but never act on it.
    req.resume();
    if (opts.redirectTo) {
      res.writeHead(302, { location: opts.redirectTo });
      res.end();
      return;
    }
    res.writeHead(opts.status ?? 200, { 'content-type': 'text/html' });
    res.end(opts.html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
