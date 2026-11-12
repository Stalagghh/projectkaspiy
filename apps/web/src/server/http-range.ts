// Parsing of a single "Range: bytes=..." header (RFC 9110). Multi-range requests are
// answered with the first range only, which every browser media stack accepts.

export type ByteRange = { start: number; end: number };

/**
 * Returns the requested range, `null` when the whole body should be sent,
 * or `'unsatisfiable'` when the client must get 416.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)(?:,.*)?$/.exec(header.trim());
  if (!match) return 'unsatisfiable';
  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return 'unsatisfiable';
  if (size === 0) return 'unsatisfiable';

  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'unsatisfiable';
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** Response for an in-memory body (audio clips) with Range support. */
export function rangeResponse(body: Uint8Array, contentType: string, rangeHeader: string | null): Response {
  const size = body.byteLength;
  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=3600',
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${size}` } });
  }
  if (range === null) {
    return new Response(new Uint8Array(body), { status: 200, headers: { ...common, 'Content-Length': String(size) } });
  }
  const slice = body.slice(range.start, range.end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      ...common,
      'Content-Length': String(slice.byteLength),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}
