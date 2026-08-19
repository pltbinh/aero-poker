import { encodeSnapshot, type RoomSnapshot } from "@scrum-poker/protocol";
import { ApiError } from "../errors/api-error.js";

const MAX_OPEN_STREAMS = 100;
const HEARTBEAT_FRAME = ": ping\n\n";
const ROOM_EXPIRED_FRAME = "event: room-expired\n\n";

interface ClientConnection {
  participantId: string;
  sink: SseSink;
}

export interface SseSink {
  write(chunk: string): boolean;
  end(): void;
  on(event: "close", listener: () => void): void;
}

function formatSnapshot(snapshot: RoomSnapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(encodeSnapshot(snapshot))}\n\n`;
}

export class SseHub {
  private readonly clientsByRoomId = new Map<string, Set<ClientConnection>>();
  private openStreams = 0;

  connect(roomId: string, participantId: string, sink: SseSink, initial: RoomSnapshot): () => void {
    if (this.openStreams >= MAX_OPEN_STREAMS) {
      throw new ApiError("SERVICE_UNAVAILABLE", 503, "The stream service is at capacity.");
    }

    const roomClients = this.getOrCreateRoomClients(roomId);
    const connection: ClientConnection = { participantId, sink };
    const cleanup = () => {
      this.removeConnection(roomId, connection);
    };

    roomClients.add(connection);
    this.openStreams += 1;
    sink.on("close", cleanup);
    sink.write(formatSnapshot(initial));

    return cleanup;
  }

  publishRoom(roomId: string, snapshotFor: (participantId: string) => RoomSnapshot): void {
    const roomClients = this.clientsByRoomId.get(roomId);

    if (roomClients === undefined) {
      return;
    }

    for (const connection of roomClients) {
      connection.sink.write(formatSnapshot(snapshotFor(connection.participantId)));
    }
  }

  closeRoom(roomId: string): void {
    const roomClients = this.clientsByRoomId.get(roomId);

    if (roomClients === undefined) {
      return;
    }

    for (const connection of Array.from(roomClients)) {
      this.removeConnection(roomId, connection);
      connection.sink.write(ROOM_EXPIRED_FRAME);
      connection.sink.end();
    }
  }

  closeAll(): void {
    for (const [roomId, roomClients] of Array.from(this.clientsByRoomId.entries())) {
      for (const connection of Array.from(roomClients)) {
        this.removeConnection(roomId, connection);
        connection.sink.end();
      }
    }
  }

  heartbeat(): void {
    for (const roomClients of this.clientsByRoomId.values()) {
      for (const connection of roomClients) {
        connection.sink.write(HEARTBEAT_FRAME);
      }
    }
  }

  private getOrCreateRoomClients(roomId: string): Set<ClientConnection> {
    const existing = this.clientsByRoomId.get(roomId);

    if (existing !== undefined) {
      return existing;
    }

    const created = new Set<ClientConnection>();
    this.clientsByRoomId.set(roomId, created);
    return created;
  }

  private removeConnection(roomId: string, connection: ClientConnection): void {
    const roomClients = this.clientsByRoomId.get(roomId);

    if (roomClients === undefined || !roomClients.delete(connection)) {
      return;
    }

    this.openStreams -= 1;

    if (roomClients.size === 0) {
      this.clientsByRoomId.delete(roomId);
    }
  }
}
