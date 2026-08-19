import { z } from "zod";
import type { ParticipantView, RoomSnapshot, VoteValue, WireParticipant, WireSnapshot } from "./contracts.js";
import { VOTE_VALUES } from "./contracts.js";

const wireParticipantBaseSchema = z.tuple([
  z.string(),
  z.string(),
  z.union([z.literal(0), z.literal(1)]),
]);

const wireParticipantRevealedSchema = z.tuple([
  z.string(),
  z.string(),
  z.union([z.literal(0), z.literal(1)]),
  z.enum(VOTE_VALUES),
]);

const wireParticipantSchema = z.union([wireParticipantBaseSchema, wireParticipantRevealedSchema]);

const wireSnapshotSchema = z.object({
  v: z.literal(1),
  r: z.string(),
  q: z.number().int().nonnegative(),
  s: z.string(),
  p: z.union([z.literal(0), z.literal(1)]),
  u: z.array(wireParticipantSchema),
});

function encodeParticipant(participant: ParticipantView, phase: RoomSnapshot["phase"]): WireParticipant {
  const voted = participant.hasVoted ? 1 : 0;
  if (phase === "revealed") {
    if (voted === 1) {
      if (participant.vote === undefined) {
        throw new Error(`Cannot encode revealed participant ${participant.id} without vote`);
      }

      return [participant.id, participant.displayName, voted, participant.vote];
    }

    return [participant.id, participant.displayName, voted];
  }

  return [participant.id, participant.displayName, voted];
}

export function encodeSnapshot(snapshot: RoomSnapshot): WireSnapshot {
  return {
    v: 1,
    r: snapshot.roomId,
    q: snapshot.revision,
    s: snapshot.selfParticipantId,
    p: snapshot.phase === "revealed" ? 1 : 0,
    u: snapshot.participants.map((participant) => encodeParticipant(participant, snapshot.phase)),
  };
}

function decodeParticipant(tuple: WireParticipant, phase: 0 | 1): ParticipantView {
  const [id, displayName, voted, vote] = tuple;

  if (phase === 0) {
    if (vote !== undefined) {
      throw new Error("Hidden vote values are not allowed during voting");
    }

    return {
      id,
      displayName,
      hasVoted: voted === 1,
    };
  }

  if (voted === 0) {
    if (vote !== undefined) {
      throw new Error(`Malformed wire participant tuple for ${id}`);
    }

    return {
      id,
      displayName,
      hasVoted: false,
    };
  }

  if (vote === undefined) {
    throw new Error(`Malformed wire participant tuple for ${id}`);
  }

  if (!VOTE_VALUES.includes(vote as VoteValue)) {
    throw new Error(`Invalid deck value: ${vote}`);
  }

  return {
    id,
    displayName,
    hasVoted: true,
    vote,
  };
}

export function decodeSnapshot(input: unknown): RoomSnapshot {
  const parsed = wireSnapshotSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("Malformed wire snapshot");
  }

  const snapshot = parsed.data;
  const participants = snapshot.u.map((tuple) => decodeParticipant(tuple as WireParticipant, snapshot.p));

  return {
    roomId: snapshot.r,
    revision: snapshot.q,
    phase: snapshot.p === 1 ? "revealed" : "voting",
    selfParticipantId: snapshot.s,
    participants,
  };
}
