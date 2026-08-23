import { Prisma, PrismaClient } from '@prisma/client';

export type SourceEventIdentity = {
  userId: string;
  sourceSystem: string;
  sourceNamespace: string;
  externalId: string;
};

export type SourceEventInput = SourceEventIdentity & {
  eventType: string;
  eventVersion?: string;
  occurredAt?: Date;
  settledAt?: Date;
  payloadHash: string;
  payload?: Prisma.InputJsonValue;
  payloadUri?: string;
  signatureStatus?: string;
  parserVersion?: string;
};

export class SourceEventIdentityError extends Error {}

function requiredPart(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new SourceEventIdentityError(`${name} is required`);
  return normalized;
}

/**
 * The provider/account namespace is part of identity. The same provider ID
 * may legitimately occur in two merchant accounts or import scopes.
 */
export function normalizeSourceEventIdentity(
  identity: SourceEventIdentity
): SourceEventIdentity {
  return {
    userId: requiredPart('userId', identity.userId),
    sourceSystem: requiredPart('sourceSystem', identity.sourceSystem).toUpperCase(),
    sourceNamespace: requiredPart('sourceNamespace', identity.sourceNamespace),
    externalId: requiredPart('externalId', identity.externalId),
  };
}

export function sourceEventIdempotencyKey(identity: SourceEventIdentity): string {
  const normalized = normalizeSourceEventIdentity(identity);
  return [
    normalized.userId,
    normalized.sourceSystem,
    normalized.sourceNamespace,
    normalized.externalId,
  ].join(':');
}

/**
 * Insert-only ingestion. A replay with the same identity is returned as an
 * existing event; a same-identity/different-payload replay is rejected as a
 * collision rather than silently replacing source evidence.
 */
export async function ingestSourceEvent(
  db: PrismaClient,
  input: SourceEventInput
) {
  const identity = normalizeSourceEventIdentity(input);
  if (!input.payloadHash.trim()) {
    throw new SourceEventIdentityError('payloadHash is required');
  }

  const where = {
    userId_sourceSystem_sourceNamespace_externalId: identity,
  } as const;
  const existing = await db.sourceEvent.findUnique({ where });
  if (existing) {
    if (existing.payloadHash !== input.payloadHash) {
      throw new SourceEventIdentityError(
        `source event identity collision: ${sourceEventIdempotencyKey(identity)}`
      );
    }
    return { event: existing, created: false };
  }

  try {
    const event = await db.sourceEvent.create({
      data: {
        ...identity,
        eventType: requiredPart('eventType', input.eventType),
        eventVersion: input.eventVersion?.trim() || '1',
        occurredAt: input.occurredAt,
        settledAt: input.settledAt,
        payloadHash: input.payloadHash,
        payload: input.payload,
        payloadUri: input.payloadUri,
        signatureStatus: input.signatureStatus,
        parserVersion: input.parserVersion,
      },
    });
    return { event, created: true };
  } catch (error) {
    // Another worker may have won the insert race. Re-read and apply the same
    // collision rule, preserving idempotency without an update/upsert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.sourceEvent.findUnique({ where });
      if (raced && raced.payloadHash === input.payloadHash) {
        return { event: raced, created: false };
      }
      throw new SourceEventIdentityError(
        `source event identity collision: ${sourceEventIdempotencyKey(identity)}`
      );
    }
    throw error;
  }
}
