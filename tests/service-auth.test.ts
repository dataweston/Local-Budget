import { describe, it, expect } from 'vitest';
import { secretsMatch, bearerToken, authorizeServiceRequest } from '@/lib/service-auth';

describe('secretsMatch', () => {
  it('matches identical secrets', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects different secrets and different lengths', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
    expect(secretsMatch('abc', 'abc123')).toBe(false);
  });

  it('rejects missing values without throwing', () => {
    expect(secretsMatch(null, 'x')).toBe(false);
    expect(secretsMatch('x', undefined)).toBe(false);
    expect(secretsMatch('', '')).toBe(false);
  });
});

describe('bearerToken', () => {
  it('extracts the token case-insensitively', () => {
    expect(bearerToken('Bearer my-token')).toBe('my-token');
    expect(bearerToken('bearer my-token')).toBe('my-token');
  });

  it('returns null for other schemes or missing header', () => {
    expect(bearerToken('Basic dXNlcg==')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe('authorizeServiceRequest', () => {
  const makeRequest = (init: { url?: string; headers?: Record<string, string> } = {}) =>
    new Request(init.url ?? 'https://app.test/api/integration/v1/pnl', {
      headers: init.headers,
    });

  it('fails closed with 503 when the secret is unconfigured', () => {
    const result = authorizeServiceRequest(makeRequest(), undefined, 'MY_SECRET');
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it('accepts a valid bearer token', () => {
    const result = authorizeServiceRequest(
      makeRequest({ headers: { authorization: 'Bearer s3cret' } }),
      's3cret',
      'MY_SECRET'
    );
    expect(result.ok).toBe(true);
  });

  it('accepts the x-webhook-token header and ?token= param', () => {
    expect(
      authorizeServiceRequest(
        makeRequest({ headers: { 'x-webhook-token': 's3cret' } }),
        's3cret',
        'MY_SECRET'
      ).ok
    ).toBe(true);
    expect(
      authorizeServiceRequest(
        makeRequest({ url: 'https://app.test/api/email/inbound?token=s3cret' }),
        's3cret',
        'MY_SECRET'
      ).ok
    ).toBe(true);
  });

  it('rejects wrong tokens with 401', () => {
    const result = authorizeServiceRequest(
      makeRequest({ headers: { authorization: 'Bearer wrong' } }),
      's3cret',
      'MY_SECRET'
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});
