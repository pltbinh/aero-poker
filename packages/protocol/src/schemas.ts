import { z } from "zod";
import { VOTE_VALUES } from "./contracts.js";

export const displayNameSchema = z.string().trim().min(1).max(30);

export const displayNameRequestSchema = z.object({
  displayName: displayNameSchema,
});

export const createRoomRequestSchema = displayNameRequestSchema;

export const joinRoomRequestSchema = displayNameRequestSchema;

export const voteValueSchema = z.enum(VOTE_VALUES);

export const voteRequestSchema = z.object({
  value: voteValueSchema,
});
