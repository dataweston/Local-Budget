import { describe, expect, it } from 'vitest';
import { oauthStatesMatch } from '@/lib/oauth-state';

describe('OAuth state verification', () => {
  it('accepts only the exact server-issued state', () => {
    const state = 'a'.repeat(64);
    expect(oauthStatesMatch(state, state)).toBe(true);
    expect(oauthStatesMatch(state, `${state.slice(0, -1)}b`)).toBe(false);
    expect(oauthStatesMatch(state, `${state}a`)).toBe(false);
    expect(oauthStatesMatch(null, state)).toBe(false);
    expect(oauthStatesMatch(state, null)).toBe(false);
  });
});
