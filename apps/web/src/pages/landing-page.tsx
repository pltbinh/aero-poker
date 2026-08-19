import { Plus, Users } from "lucide-react";
import { displayNameSchema } from "@scrum-poker/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { RoomApiError, type RoomApi } from "../api/room-api.js";
import type { RoomCredentialStore } from "../auth/room-credentials.js";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Toaster } from "../components/ui/sonner.js";

interface LandingPageProps {
  api: Pick<RoomApi, "createRoom" | "joinRoom">;
  credentials: Pick<RoomCredentialStore, "save">;
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

  return "Something went wrong. Please try again.";
}

function clearFieldError(errors: FieldErrors, key: keyof FieldErrors): FieldErrors {
  const nextErrors = { ...errors };
  delete nextErrors[key];
  return nextErrors;
}

function validateDisplayName(name: string): string | undefined {
  if (name.length === 0) {
    return "Enter a display name.";
  }

  if (!displayNameSchema.safeParse(name).success) {
    return "Display name must be 1 to 30 characters.";
  }

  return undefined;
}

export function LandingPage({ api, credentials, navigate, initialRoomId = "" }: LandingPageProps) {
  const [displayName, setDisplayName] = useState("");
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
      nextErrors.roomCode = "Enter a room code to join.";
    }

    setFieldErrors(nextErrors);
    setFormError(null);
    setToastMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setPending(true);

    try {
      if (intent === "create") {
        await handleCreate(name);
      } else {
        await handleJoin(name, nextRoomCode);
      }
    } catch (error) {
      if (isTransientError(error)) {
        setToastMessage("The service is temporarily unavailable. Please try again.");
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
      <section className="space-y-5">
        <Badge>Friendly room setup</Badge>
        <div className="space-y-3">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Estimate together without a complicated setup.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[var(--muted-foreground)] sm:text-lg">
            Create a fresh planning room for your team or jump into a shared room code. The link stays clean:
            credentials never leave local storage.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
            <p className="text-sm font-semibold text-[var(--foreground)]">Keyboard-first</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Visible focus, Enter-key submit, and reduced-motion friendly transitions.
            </p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
            <p className="text-sm font-semibold text-[var(--foreground)]">Shareable hash links</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Shared URLs carry only the room code, which keeps GitHub Pages routing simple and safe.
            </p>
          </div>
        </div>
      </section>

      <Card className="p-6">
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();

            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            const fallbackIntent = trimValue(roomCode).length > 0 ? "join" : "create";
            const intent = submitter?.value === "join" ? "join" : submitter?.value === "create" ? "create" : fallbackIntent;

            await submit(intent);
          }}
        >
          <CardHeader className="space-y-1">
            <CardTitle>Start with your name</CardTitle>
            <CardDescription>
              Use one name field for both actions, then create a room or join an existing code.
            </CardDescription>
          </CardHeader>

          <div className="space-y-2">
            <Label htmlFor={displayNameId}>Display name</Label>
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
              placeholder="Alex"
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
              Create room
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              type="submit"
              value="join"
              variant="outline"
            >
              <Users className="size-4" aria-hidden="true" />
              Join room
            </Button>
          </div>

          <CardContent className="rounded-2xl bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">Heads up:</span> room links stay in the browser hash,
            while participant and facilitator tokens remain local to this browser only.
          </CardContent>
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
