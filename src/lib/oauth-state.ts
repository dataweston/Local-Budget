import { timingSafeEqual } from 'crypto';

export function oauthStatesMatch(expected: string | null | undefined, received: string | null | undefined): boolean {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
