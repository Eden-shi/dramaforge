import type { FastifyReply } from 'fastify';
import type { StreamEvent } from '@dramaforge/shared';

/** 把 SSE 写出封装为简单的 send 回调 */
export async function streamSse(
  reply: FastifyReply,
  produce: (send: (e: StreamEvent) => Promise<void>) => Promise<void>,
) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.hijack();
  const send = async (e: StreamEvent) => {
    reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  try {
    await produce(send);
  } finally {
    reply.raw.end();
  }
}
