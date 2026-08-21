export interface RoomCredentials {
  participantToken: string;
  facilitatorToken?: string;
}

export interface RoomCredentialStore {
  load(roomId: string): RoomCredentials | null;
  loadDisplayName(): string | null;
  save(roomId: string, credentials: RoomCredentials): void;
  saveDisplayName(displayName: string): void;
  remove(roomId: string): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = "scrum-poker:v1:room:";
const DISPLAY_NAME_KEY = "aero-poker:v1:display-name";

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function isRoomCredentials(value: unknown): value is RoomCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RoomCredentials).participantToken === "string" &&
    ((value as RoomCredentials).facilitatorToken === undefined ||
      typeof (value as RoomCredentials).facilitatorToken === "string")
  );
}

function readDefaultStorage(): StorageLike {
  if (typeof window === "undefined" || window.localStorage === undefined) {
    throw new Error("Local storage is unavailable.");
  }

  return window.localStorage;
}

export function createRoomCredentialStore(storage: StorageLike = readDefaultStorage()): RoomCredentialStore {
  return {
    load(roomId) {
      const stored = storage.getItem(storageKey(roomId));

      if (stored === null) {
        return null;
      }

      try {
        const parsed = JSON.parse(stored) as unknown;
        return isRoomCredentials(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    loadDisplayName() {
      const displayName = storage.getItem(DISPLAY_NAME_KEY)?.trim() ?? "";
      return displayName.length > 0 ? displayName : null;
    },
    save(roomId, credentials) {
      storage.setItem(storageKey(roomId), JSON.stringify(credentials));
    },
    saveDisplayName(displayName) {
      storage.setItem(DISPLAY_NAME_KEY, displayName);
    },
    remove(roomId) {
      storage.removeItem(storageKey(roomId));
    },
  };
}
