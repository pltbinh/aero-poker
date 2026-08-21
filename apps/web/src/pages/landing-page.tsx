import { Plus, Users } from "lucide-react";
import { displayNameSchema } from "@scrum-poker/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { RoomApiError, type RoomApi } from "../api/room-api.js";
import type { RoomCredentialStore } from "../auth/room-credentials.js";
import { Alert } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Card, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Toaster } from "../components/ui/sonner.js";

interface LandingPageProps {
  api: Pick<RoomApi, "createRoom" | "joinRoom">;
  credentials: Pick<RoomCredentialStore, "loadDisplayName" | "save" | "saveDisplayName">;
  navigate: (path: string) => void;
  initialRoomId?: string;
}

interface FieldErrors {
  displayName?: string;
  roomCode?: string;
}

function trimValue(value: string): string {
  return value.trim();
}

function isTransientError(error: unknown): boolean {
  if (!(error instanceof RoomApiError)) {
    return true;
  }

  return error.code === "SERVICE_UNAVAILABLE";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Something went sideways. Give it another go.";
}

function clearFieldError(errors: FieldErrors, key: keyof FieldErrors): FieldErrors {
  const nextErrors = { ...errors };
  delete nextErrors[key];
  return nextErrors;
}

function validateDisplayName(name: string): string | undefined {
  if (name.length === 0) {
    return "Enter your name to jump in.";
  }

  if (!displayNameSchema.safeParse(name).success) {
    return "Keep your name under 30 characters.";
  }

  return undefined;
}

export function LandingPage({ api, credentials, navigate, initialRoomId = "" }: LandingPageProps) {
  const [displayName, setDisplayName] = useState(() => credentials.loadDisplayName() ?? "");
  const [roomCode, setRoomCode] = useState(initialRoomId);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const displayNameId = useId();
  const roomCodeId = useId();
  const displayNameErrorId = useId();
  const roomCodeErrorId = useId();
  const formErrorId = useId();
  const seededRoomCodeRef = useRef(initialRoomId);

  useEffect(() => {
    if (initialRoomId === seededRoomCodeRef.current) {
      return;
    }

    setRoomCode((currentRoomCode) => {
      const shouldResync =
        trimValue(currentRoomCode).length === 0 || currentRoomCode === seededRoomCodeRef.current;

      return shouldResync ? initialRoomId : currentRoomCode;
    });
    seededRoomCodeRef.current = initialRoomId;
  }, [initialRoomId]);

  async function handleCreate(name: string) {
    const createdRoom = await api.createRoom(name);
    credentials.save(createdRoom.roomId, {
      participantToken: createdRoom.participantToken,
      facilitatorToken: createdRoom.facilitatorToken,
    });
    navigate(`/room/${createdRoom.roomId}`);
  }

  async function handleJoin(name: string, roomId: string) {
    const joinedRoom = await api.joinRoom(roomId, name);
    credentials.save(roomId, {
      participantToken: joinedRoom.participantToken,
    });
    navigate(`/room/${roomId}`);
  }

  async function submit(intent: "create" | "join") {
    const name = trimValue(displayName);
    const nextRoomCode = trimValue(roomCode);
    const nextErrors: FieldErrors = {};

    const displayNameError = validateDisplayName(name);

    if (displayNameError !== undefined) {
      nextErrors.displayName = displayNameError;
    }

    if (intent === "join" && nextRoomCode.length === 0) {
      nextErrors.roomCode = "Add a room code to join the game.";
    }

    setFieldErrors(nextErrors);
    setFormError(null);
    setToastMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    credentials.saveDisplayName(name);
    setPending(true);

    try {
      if (intent === "create") {
        await handleCreate(name);
      } else {
        await handleJoin(name, nextRoomCode);
      }
    } catch (error) {
      if (isTransientError(error)) {
        setToastMessage("Aero is taking a quick breather. Try again in a moment.");
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-start justify-center py-4 sm:items-center sm:py-8">
      <Card className="relative w-full max-w-lg overflow-hidden border-2 p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-2 bg-[linear-gradient(90deg,var(--primary),var(--accent),var(--primary))]"
        />
        <form
          className="space-y-6"
          onSubmit={async (event) => {
            event.preventDefault();

            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            const fallbackIntent = trimValue(roomCode).length > 0 ? "join" : "create";
            const intent = submitter?.value === "join" ? "join" : submitter?.value === "create" ? "create" : fallbackIntent;

            await submit(intent);
          }}
        >
          <CardHeader>
            <CardTitle className="font-[var(--font-game)] text-3xl font-black tracking-tight sm:text-4xl">
              Ready to play?
            </CardTitle>
          </CardHeader>

          <div className="space-y-2">
            <Label htmlFor={displayNameId}>Your name</Label>
            <Input
              aria-describedby={fieldErrors.displayName ? displayNameErrorId : undefined}
              aria-invalid={fieldErrors.displayName !== undefined}
              disabled={pending}
              id={displayNameId}
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (fieldErrors.displayName !== undefined) {
                  setFieldErrors((current) => clearFieldError(current, "displayName"));
                }
              }}
              placeholder="What should we call you?"
              type="text"
              value={displayName}
            />
            {fieldErrors.displayName ? (
              <p className="text-sm font-medium text-[var(--destructive)]" id={displayNameErrorId} role="alert">
                {fieldErrors.displayName}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={roomCodeId}>Room code</Label>
            <Input
              aria-describedby={fieldErrors.roomCode ? roomCodeErrorId : undefined}
              aria-invalid={fieldErrors.roomCode !== undefined}
              className="uppercase tracking-[0.14em]"
              disabled={pending}
              id={roomCodeId}
              onChange={(event) => {
                setRoomCode(event.target.value);
                if (fieldErrors.roomCode !== undefined) {
                  setFieldErrors((current) => clearFieldError(current, "roomCode"));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit("join");
                }
              }}
              placeholder="room-123"
              type="text"
              value={roomCode}
            />
            {fieldErrors.roomCode ? (
              <p className="text-sm font-medium text-[var(--destructive)]" id={roomCodeErrorId} role="alert">
                {fieldErrors.roomCode}
              </p>
            ) : null}
          </div>

          {formError ? (
            <Alert aria-live="polite" id={formErrorId}>
              <span>{formError}</span>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="flex-1"
              disabled={pending}
              type="submit"
              value="create"
            >
              <Plus className="size-4" aria-hidden="true" />
              Start a room
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              type="submit"
              value="join"
              variant="outline"
            >
              <Users className="size-4" aria-hidden="true" />
              Join the game
            </Button>
          </div>
        </form>
      </Card>

      <Toaster
        message={toastMessage}
        onDismiss={() => {
          setToastMessage(null);
        }}
      />
    </div>
  );
}
