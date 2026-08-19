import { VOTE_VALUES, type RoomPhase, type RoomSnapshot, type VoteValue } from "@scrum-poker/protocol";
import { generateToken, hashToken, safeTokenMatch } from "../auth/tokens.js";
import { ApiError } from "../errors/api-error.js";

const DEFAULT_MAX_ROOMS = 250;
const DEFAULT_ROOM_TTL_MS = 60 * 60 * 1000;
const MAX_PARTICIPANTS = 20;
const MAX_NAME_LENGTH = 30;
const VOTE_SET = new Set<string>(VOTE_VALUES);

interface ParticipantRecord {
  id: string;
  displayName: string;
  normalizedName: string;
  participantTokenHash: Buffer;
  vote?: VoteValue;
  joinedAt: number;
}

interface RoomRecord {
  id: string;
  revision: number;
  phase: RoomPhase;
  createdAt: number;
  lastActivityAt: number;
  creatorParticipantId: string;
  facilitatorTokenHash: Buffer;
  participants: Map<string, ParticipantRecord>;
  participantIdsByTokenHash: Map<string, string>;
  participantIdsByNormalizedName: Map<string, string>;
}

export interface RoomStoreOptions {
  now?: () => number;
  maxRooms?: number;
  roomTtlMs?: number;
}

export interface CreatedRoom {
  roomId: string;
  participantId: string;
  participantToken: string;
  facilitatorToken: string;
}

export interface JoinedRoom {
  participantId: string;
  participantToken: string;
}

function normalizeDisplayName(displayName: string): string {
  return displayName.normalize("NFC").trim();
}

function normalizedNameKey(displayName: string): string {
  return normalizeDisplayName(displayName).toLocaleLowerCase("en-US");
}

function tokenHashKey(hash: Buffer): string {
  return hash.toString("base64url");
}

function invalidRequest(message: string): ApiError {
  return new ApiError("INVALID_REQUEST", 400, message);
}

function roomNotFound(roomId: string): ApiError {
  return new ApiError("ROOM_NOT_FOUND", 404, `Room ${roomId} was not found.`);
}

function invalidParticipantToken(): ApiError {
  return new ApiError("INVALID_TOKEN", 401, "Participant credentials are invalid.");
}

function invalidFacilitatorToken(): ApiError {
  return new ApiError("INVALID_TOKEN", 401, "Facilitator credentials are invalid.");
}

export class RoomStore {
  private readonly now: () => number;
  private readonly maxRooms: number;
  private readonly roomTtlMs: number;
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(options: RoomStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.roomTtlMs = options.roomTtlMs ?? DEFAULT_ROOM_TTL_MS;
  }

  createRoom(displayName: string): CreatedRoom {
    if (this.rooms.size >= this.maxRooms) {
      throw new ApiError("SERVICE_UNAVAILABLE", 503, "The room service is at capacity.");
    }

    const sanitizedName = this.validateDisplayName(displayName);
    const now = this.now();
    const roomId = this.generateUniqueRoomId();
    const participantId = this.generateUniqueParticipantId();
    const participantToken = generateToken(32);
    const facilitatorToken = generateToken(32);
    const participantTokenHash = hashToken(participantToken);
    const room: RoomRecord = {
      id: roomId,
      revision: 0,
      phase: "voting",
      createdAt: now,
      lastActivityAt: now,
      creatorParticipantId: participantId,
      facilitatorTokenHash: hashToken(facilitatorToken),
      participants: new Map(),
      participantIdsByTokenHash: new Map(),
      participantIdsByNormalizedName: new Map(),
    };

    const participant = this.createParticipantRecord(participantId, sanitizedName, participantTokenHash, now);

    room.participants.set(participant.id, participant);
    room.participantIdsByTokenHash.set(tokenHashKey(participantTokenHash), participant.id);
    room.participantIdsByNormalizedName.set(participant.normalizedName, participant.id);
    this.rooms.set(roomId, room);

    return {
      roomId,
      participantId,
      participantToken,
      facilitatorToken,
    };
  }

  joinRoom(roomId: string, displayName: string): JoinedRoom {
    const room = this.getRoomOrThrow(roomId);
    const sanitizedName = this.validateDisplayName(displayName);
    const normalizedName = normalizedNameKey(sanitizedName);

    if (room.participants.size >= MAX_PARTICIPANTS) {
      throw new ApiError("ROOM_FULL", 409, "This room already has 20 participants.");
    }

    if (room.participantIdsByNormalizedName.has(normalizedName)) {
      throw new ApiError("NAME_TAKEN", 409, "That display name is already in use.");
    }

    const now = this.now();
    const participantId = this.generateUniqueParticipantId(room);
    const participantToken = generateToken(32);
    const participantTokenHash = hashToken(participantToken);
    const participant = this.createParticipantRecord(participantId, sanitizedName, participantTokenHash, now);

    room.participants.set(participant.id, participant);
    room.participantIdsByTokenHash.set(tokenHashKey(participantTokenHash), participant.id);
    room.participantIdsByNormalizedName.set(participant.normalizedName, participant.id);
    this.touchRoom(room, now);

    return {
      participantId,
      participantToken,
    };
  }

  authenticate(roomId: string, participantToken: string): string {
    const room = this.getRoomOrThrow(roomId);
    const participant = this.getParticipantByTokenOrThrow(room, participantToken);

    return participant.id;
  }

  castVote(roomId: string, participantToken: string, value: VoteValue): void {
    const room = this.getRoomOrThrow(roomId);
    const participant = this.getParticipantByTokenOrThrow(room, participantToken);

    if (!VOTE_SET.has(value)) {
      throw new ApiError("INVALID_VOTE", 400, "Vote value is not in the shared deck.");
    }

    if (room.phase !== "voting") {
      throw new ApiError("VOTING_REVEALED", 409, "Votes cannot change after reveal.");
    }

    participant.vote = value;
    this.touchRoom(room, this.now());
  }

  reveal(roomId: string, participantToken: string, facilitatorToken: string): void {
    const room = this.getRoomOrThrow(roomId);
    const participant = this.getParticipantByTokenOrThrow(room, participantToken);

    if (participant.id !== room.creatorParticipantId) {
      throw new ApiError("FORBIDDEN", 403, "Only the room creator can reveal votes.");
    }

    if (!safeTokenMatch(facilitatorToken, room.facilitatorTokenHash)) {
      throw invalidFacilitatorToken();
    }

    if (room.phase === "revealed") {
      throw new ApiError("ALREADY_REVEALED", 409, "Votes are already revealed.");
    }

    room.phase = "revealed";
    this.touchRoom(room, this.now());
  }

  reset(roomId: string, participantToken: string, facilitatorToken: string): void {
    const room = this.getRoomOrThrow(roomId);
    const participant = this.getParticipantByTokenOrThrow(room, participantToken);

    if (participant.id !== room.creatorParticipantId) {
      throw new ApiError("FORBIDDEN", 403, "Only the room creator can reset votes.");
    }

    if (!safeTokenMatch(facilitatorToken, room.facilitatorTokenHash)) {
      throw invalidFacilitatorToken();
    }

    for (const member of room.participants.values()) {
      delete member.vote;
    }

    room.phase = "voting";
    this.touchRoom(room, this.now());
  }

  snapshotFor(roomId: string, participantToken: string): RoomSnapshot {
    const room = this.getRoomOrThrow(roomId);
    const participant = this.getParticipantByTokenOrThrow(room, participantToken);

    return this.buildSnapshot(room, participant.id);
  }

  snapshotForParticipant(roomId: string, participantId: string): RoomSnapshot {
    const room = this.getRoomOrThrow(roomId);

    if (!room.participants.has(participantId)) {
      throw new ApiError("FORBIDDEN", 403, "The participant is not part of this room.");
    }

    return this.buildSnapshot(room, participantId);
  }

  sweepExpired(): string[] {
    const expiredRoomIds: string[] = [];
    const now = this.now();

    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.lastActivityAt < this.roomTtlMs) {
        continue;
      }

      expiredRoomIds.push(roomId);
      this.rooms.delete(roomId);
    }

    return expiredRoomIds;
  }

  private buildSnapshot(room: RoomRecord, selfParticipantId: string): RoomSnapshot {
    return {
      roomId: room.id,
      revision: room.revision,
      phase: room.phase,
      selfParticipantId,
      participants: Array.from(room.participants.values(), (participant) => {
        if (room.phase === "revealed" && participant.vote !== undefined) {
          return {
            id: participant.id,
            displayName: participant.displayName,
            hasVoted: true,
            vote: participant.vote,
          };
        }

        return {
          id: participant.id,
          displayName: participant.displayName,
          hasVoted: participant.vote !== undefined,
        };
      }),
    };
  }

  private createParticipantRecord(
    id: string,
    displayName: string,
    participantTokenHash: Buffer,
    now: number,
  ): ParticipantRecord {
    return {
      id,
      displayName,
      normalizedName: normalizedNameKey(displayName),
      participantTokenHash,
      joinedAt: now,
    };
  }

  private generateUniqueRoomId(): string {
    let roomId = generateToken(16);

    while (this.rooms.has(roomId)) {
      roomId = generateToken(16);
    }

    return roomId;
  }

  private generateUniqueParticipantId(room?: RoomRecord): string {
    let participantId = generateToken(16);

    while (room?.participants.has(participantId)) {
      participantId = generateToken(16);
    }

    return participantId;
  }

  private getParticipantByTokenOrThrow(room: RoomRecord, participantToken: string): ParticipantRecord {
    const hashedToken = hashToken(participantToken);
    const participantId = room.participantIdsByTokenHash.get(tokenHashKey(hashedToken));

    if (participantId === undefined) {
      throw invalidParticipantToken();
    }

    const participant = room.participants.get(participantId);

    if (participant === undefined || !safeTokenMatch(participantToken, participant.participantTokenHash)) {
      throw invalidParticipantToken();
    }

    return participant;
  }

  private getRoomOrThrow(roomId: string): RoomRecord {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      throw roomNotFound(roomId);
    }

    return room;
  }

  private touchRoom(room: RoomRecord, activityAt: number): void {
    room.lastActivityAt = activityAt;
    room.revision += 1;
  }

  private validateDisplayName(displayName: string): string {
    if (typeof displayName !== "string") {
      throw invalidRequest("Display name must be a string.");
    }

    const sanitizedName = normalizeDisplayName(displayName);

    if (sanitizedName.length === 0 || sanitizedName.length > MAX_NAME_LENGTH) {
      throw invalidRequest("Display name must be between 1 and 30 characters.");
    }

    return sanitizedName;
  }
}
