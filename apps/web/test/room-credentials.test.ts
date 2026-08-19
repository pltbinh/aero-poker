import { describe, expect, it } from "vitest";
import { createRoomCredentialStore } from "../src/auth/room-credentials.js";

describe("createRoomCredentialStore", () => {
  it("stores facilitator credentials under one room only", () => {
    const storage = new Map<string, string>();
    const credentials = createRoomCredentialStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    });

    credentials.save("room-a", {
      participantToken: "participant",
      facilitatorToken: "facilitator",
    });

    expect(credentials.load("room-a")).toEqual({
      participantToken: "participant",
      facilitatorToken: "facilitator",
    });
    expect(credentials.load("room-b")).toBeNull();
    expect(storage.get("scrum-poker:v1:room:room-a")).toBe(
      JSON.stringify({
        participantToken: "participant",
        facilitatorToken: "facilitator",
      }),
    );
  });

  it("returns null for malformed stored JSON instead of throwing", () => {
    const credentials = createRoomCredentialStore({
      getItem: () => "{not-json",
      setItem: () => {
        throw new Error("save should not be called");
      },
      removeItem: () => {
        throw new Error("remove should not be called");
      },
    });

    expect(credentials.load("room-a")).toBeNull();
  });
});
