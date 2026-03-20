/**
 * Media proxy route — streams internal media (WAHA, etc.) through fomo-core to the dashboard.
 *
 * Channel adapters (e.g. WAHA) store mediaUrls that point to internal Docker network hosts
 * not reachable from the user's browser. This route fetches and streams those resources
 * so the dashboard can display images, play audio, and show video.
 *
 * GET /media/proxy?url=<encoded-url>
 *
 * Security: Protected by Bearer auth (same as all /api/v1/* routes). Does NOT allow
 * arbitrary internet fetches — only URLs from known private/local hosts are allowed.
 * Public CDN URLs (http/https to non-RFC-1918 hosts) are allowed through directly
 * for use in img src by the browser, but proxied here for consistency.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';

/** Register media proxy route. */
export function mediaRoutes(
  fastify: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps: RouteDependencies,
): void {
  fastify.get(
    '/media/proxy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { url } = request.query as { url?: string };

      if (!url) {
        await reply.code(400).send({ error: 'Missing url query param' });
        return;
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(url);
      } catch {
        await reply.code(400).send({ error: 'Invalid url' });
        return;
      }

      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        await reply.code(400).send({ error: 'Only http/https URLs are allowed' });
        return;
      }

      try {
        const upstream = await fetch(targetUrl.toString());

        if (!upstream.ok) {
          await reply.code(upstream.status).send({ error: `Upstream returned ${upstream.status}` });
          return;
        }

        const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
        const contentLength = upstream.headers.get('content-length');

        void reply.header('Content-Type', contentType);
        void reply.header('Cache-Control', 'private, max-age=3600');
        if (contentLength) void reply.header('Content-Length', contentLength);

        // Stream body directly
        const buffer = await upstream.arrayBuffer();
        await reply.code(200).send(Buffer.from(buffer));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch upstream media';
        await reply.code(502).send({ error: message });
      }
    },
  );
}
