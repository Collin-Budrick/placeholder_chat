import { promises as fs } from 'fs';
import { join } from 'path';

const LOG_PATH = join(process.cwd(), 'logs', 'frontend-api.log');

/**
 * POST /_frontend-logs
 *  - Accepts JSON log entries from the browser and appends them as NDJSON to logs/frontend-api.log
 * GET /_frontend-logs
 *  - Returns the current log file (for download / inspection)
 *
 * Notes:
 *  - This route intentionally avoids the /api/* dev proxy so the web server itself handles logs.
 *  - Be careful with log file growth in production; rotate/prune as needed.
 */
export const onRequest = async (ev: any) => {
  const method = ev.request.method.toUpperCase();

  if (method === 'POST') {
    try {
      const entry = await ev.request.json().catch(() => null);
      if (!entry) {
        return new Response('missing entry', { status: 400 });
      }

      // Ensure logs directory exists
      try {
        await fs.mkdir(join(process.cwd(), 'logs'), { recursive: true });
      } catch {
        // ignore
      }

      // Append NDJSON (one JSON object per line)
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      }) + '\n';
      await fs.appendFile(LOG_PATH, line, { encoding: 'utf8' });

      return new Response(null, { status: 204 });
    } catch (err: any) {
      console.error('frontend-logs POST failed', err);
      return new Response(String(err?.message ?? 'write-failed'), { status: 500 });
    }
  }

  if (method === 'GET') {
    try {
      const exists = await fs.stat(LOG_PATH).then(() => true).catch(() => false);
      if (!exists) {
        return new Response('', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const body = await fs.readFile(LOG_PATH, { encoding: 'utf8' });
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="frontend-api.log"',
        },
      });
    } catch (err: any) {
      console.error('frontend-logs GET failed', err);
      return new Response(String(err?.message ?? 'read-failed'), { status: 500 });
    }
  }

  return new Response(null, { status: 405 });
};
