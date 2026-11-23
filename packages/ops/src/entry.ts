// The deployed entry point. Where the page is uploaded as a static asset
// (`wrangler deploy`), Cloudflare serves it and this worker sees only
// /api/usage. Where it isn't, the worker hands out the same page, which the
// browser then keeps for an hour.

import page from '../dist/index.html';
import worker, { type Env } from './worker.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/' && request.method === 'GET') {
      return new Response(page, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'private, max-age=3600',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
          'x-robots-tag': 'noindex',
        },
      });
    }
    return worker.fetch(request, env);
  },
};
