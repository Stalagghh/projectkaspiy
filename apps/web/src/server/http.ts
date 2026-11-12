// Small helpers shared by the route handlers.
import { z } from 'zod';

export const uuidParam = z.uuid();

export function jsonError(status: number, error: string, message?: string): Response {
  return Response.json(message ? { error, message } : { error }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function jsonOk(data: unknown): Response {
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
