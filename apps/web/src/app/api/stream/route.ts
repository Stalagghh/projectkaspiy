// Server-Sent Events: live alerts and sensor readings (wire format in @ecoshield/contracts sse.ts).
import { SSE_PING_SECONDS } from '@ecoshield/contracts';

import { ensureListening, subscribe, type StreamEvent } from '@/server/realtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureListening();
  } catch {
    return Response.json(
      { error: 'unavailable', message: 'Нет связи с базой данных' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } },
    );
  }

  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribe({
        send: (event: StreamEvent) => write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`),
        close: () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
      });
      const ping = setInterval(() => write(': ping\n\n'), SSE_PING_SECONDS * 1000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      // Reconnect hint for EventSource, then an initial comment so proxies flush headers.
      write('retry: 3000\n: connected\n\n');
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
