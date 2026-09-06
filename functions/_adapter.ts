/**
 * Run a Netlify-style handler on Cloudflare Workers.
 *
 * The handlers in netlify/functions are deliberately NOT rewritten. They hold
 * every security decision the audit produced — the OAuth state/nonce pairing,
 * the appsecret_proof, the fail-closed secret reads, the deletion callbacks —
 * and porting twenty of them by hand is twenty chances to drop one of those
 * quietly. So the runtime is adapted to the handlers instead of the reverse.
 *
 * The surface is small enough to make that honest. Across all twenty functions
 * only four request fields are ever read — headers, httpMethod, body and
 * queryStringParameters — and the return is always { statusCode, headers, body }.
 * Everything below is that translation and nothing else.
 *
 * process.env needs no shim: with a compatibility date on or after 2025-04-01,
 * Workers populates it from vars and secrets, so _lib.ts, _instagram.ts and
 * _sync.ts run unchanged.
 */

export interface NetlifyEvent {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string>;
  rawUrl: string;
}

export interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

export type NetlifyHandler = (event: NetlifyEvent) => Promise<NetlifyResponse> | NetlifyResponse;

/** Request -> the event shape the handlers expect. */
export async function toEvent(request: Request): Promise<NetlifyEvent> {
  const url = new URL(request.url);

  // Netlify lower-cases header names and collapses duplicates; Headers already
  // normalises case, so this only flattens the iterator.
  const headers: Record<string, string> = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

  const queryStringParameters: Record<string, string> = {};
  for (const [k, v] of url.searchParams) queryStringParameters[k] = v;

  // GET/HEAD cannot have a body; reading one throws rather than returning "".
  const body =
    request.method === "GET" || request.method === "HEAD" ? null : await request.text();

  return { httpMethod: request.method, headers, body, queryStringParameters, rawUrl: request.url };
}

/** The handler's plain object -> a real Response. */
export function toResponse(result: NetlifyResponse): Response {
  const status = result.statusCode ?? 200;
  const headers = new Headers(result.headers ?? {});

  // A 3xx carries its destination in `location`, and several handlers also set
  // a Set-Cookie beside it (the OAuth state nonce). Headers preserves both, so
  // redirects need no special casing beyond having a body of null.
  const bodyless = status === 204 || status === 304 || (status >= 300 && status < 400);
  return new Response(bodyless ? null : (result.body ?? ""), { status, headers });
}

/**
 * Wrap a handler so an unexpected throw becomes a 500 rather than a Worker
 * exception, which would surface to the caller as an opaque 1101 with nothing
 * in the logs. The detail is logged, never returned: these handlers talk to
 * Meta and to Supabase, and their error text can carry tokens.
 */
export async function runHandler(handler: NetlifyHandler, request: Request): Promise<Response> {
  try {
    return toResponse(await handler(await toEvent(request)));
  } catch (e) {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      event: "handler.unhandled",
      detail: e instanceof Error ? e.message : String(e),
    }));
    return new Response(JSON.stringify({ message: "Server error." }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
}
