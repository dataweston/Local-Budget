import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of a presented secret against the expected value.
 * Returns false (never throws) when either side is missing.
 */
export function secretsMatch(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extract a bearer token from an Authorization header value.
 */
export function bearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

type ServiceAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Authorize a machine caller against a server-configured secret.
 * Accepts the secret as `Authorization: Bearer <secret>`, an `x-webhook-token`
 * header, or a `?token=` query parameter (for providers that only let you
 * configure a URL). Fails closed when the env var is not configured.
 */
export function authorizeServiceRequest(
  request: Request,
  expectedSecret: string | undefined,
  envVarName: string
): ServiceAuthResult {
  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      error: `${envVarName} is not configured; rejecting request`,
    };
  }

  const url = new URL(request.url);
  const presented =
    bearerToken(request.headers.get('authorization')) ??
    request.headers.get('x-webhook-token') ??
    url.searchParams.get('token');

  if (!secretsMatch(presented, expectedSecret)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}
