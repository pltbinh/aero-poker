import { generateToken, hashToken, safeTokenMatch } from "../auth/tokens.js";
import { ApiError } from "../errors/api-error.js";

const STREAM_TICKET_TTL_MS = 30_000;

interface TicketRecord {
  participantId: string;
  ticketHash: Buffer;
  expiresAt: number;
}

export interface StreamTicketStoreOptions {
  now?: () => number;
}

export interface ConsumedTicket {
  participantId: string;
}

function tokenHashKey(hash: Buffer): string {
  return hash.toString("base64url");
}

function invalidStreamTicket(): ApiError {
  return new ApiError("STREAM_TICKET_INVALID", 401, "The stream ticket is invalid.");
}

function expiredStreamTicket(): ApiError {
  return new ApiError("STREAM_TICKET_EXPIRED", 401, "The stream ticket has expired.");
}

export class StreamTicketStore {
  private readonly now: () => number;
  private readonly ticketsByRoomId = new Map<string, Map<string, TicketRecord>>();

  constructor(options: StreamTicketStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  issue(roomId: string, participantId: string): string {
    const ticket = generateToken(16);
    const ticketHash = hashToken(ticket);
    const roomTickets = this.getOrCreateRoomTickets(roomId);

    roomTickets.set(tokenHashKey(ticketHash), {
      participantId,
      ticketHash,
      expiresAt: this.now() + STREAM_TICKET_TTL_MS,
    });

    return ticket;
  }

  consume(roomId: string, ticket: string): ConsumedTicket {
    const roomTickets = this.ticketsByRoomId.get(roomId);

    if (roomTickets === undefined) {
      throw invalidStreamTicket();
    }

    const ticketHash = hashToken(ticket);
    const key = tokenHashKey(ticketHash);
    const record = roomTickets.get(key);

    if (record === undefined || !safeTokenMatch(ticket, record.ticketHash)) {
      throw invalidStreamTicket();
    }

    roomTickets.delete(key);

    if (roomTickets.size === 0) {
      this.ticketsByRoomId.delete(roomId);
    }

    if (this.now() > record.expiresAt) {
      throw expiredStreamTicket();
    }

    return { participantId: record.participantId };
  }

  sweepExpired(): number {
    const now = this.now();
    let removed = 0;

    for (const [roomId, roomTickets] of this.ticketsByRoomId.entries()) {
      for (const [key, record] of roomTickets.entries()) {
        if (now <= record.expiresAt) {
          continue;
        }

        roomTickets.delete(key);
        removed += 1;
      }

      if (roomTickets.size === 0) {
        this.ticketsByRoomId.delete(roomId);
      }
    }

    return removed;
  }

  private getOrCreateRoomTickets(roomId: string): Map<string, TicketRecord> {
    const existing = this.ticketsByRoomId.get(roomId);

    if (existing !== undefined) {
      return existing;
    }

    const created = new Map<string, TicketRecord>();
    this.ticketsByRoomId.set(roomId, created);
    return created;
  }
}
