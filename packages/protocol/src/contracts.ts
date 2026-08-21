export const VOTE_VALUES = ["☕", "1", "2", "3", "5", "8", "13"] as const;

export type VoteValue = (typeof VOTE_VALUES)[number];

export type RoomPhase = "voting" | "revealed";

export interface ParticipantView {
  id: string;
  displayName: string;
  hasVoted: boolean;
  vote?: VoteValue;
}

export interface RoomSnapshot {
  roomId: string;
  revision: number;
  phase: RoomPhase;
  selfParticipantId: string;
  participants: ParticipantView[];
}

export interface CreatedRoomResponse {
  roomId: string;
  participantToken: string;
  facilitatorToken: string;
}

export interface JoinedRoomResponse {
  participantToken: string;
}

export interface StreamTicketResponse {
  ticket: string;
  expiresInSeconds: 30;
}

export type WireParticipant = [id: string, name: string, voted: 0 | 1, vote?: VoteValue];

export interface WireSnapshot {
  v: 1;
  r: string;
  q: number;
  s: string;
  p: 0 | 1;
  u: WireParticipant[];
}

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NAME_TAKEN"
  | "INVALID_TOKEN"
  | "FORBIDDEN"
  | "INVALID_VOTE"
  | "VOTING_REVEALED"
  | "ALREADY_REVEALED"
  | "STREAM_TICKET_INVALID"
  | "STREAM_TICKET_EXPIRED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE";
