import { AlertCircle, ArrowRight, Plus, Users } from "lucide-react";
import { useId, useState } from "react";
import type { RoomApi, RoomApiError } from "../api/room-api.js";
import type { RoomCredentialStore } from "../auth/room-credentials.js";

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
  const code = (error as Partial<RoomApiError> | undefined)?.code;
  return code === "SERVICE_UNAVAILABLE" || !(error instanceof Error);
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
  const toastId = useId();

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

    if (name.length === 0) {
      nextErrors.displayName = "Enter a display name.";
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
        <span className="inline-flex w-fit items-center rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--accent-foreground)]">
          Friendly room setup
        </span>
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

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--card-shadow)]">
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
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">Start with your name</h2>
            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
              Use one name field for both actions, then create a room or join an existing code.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--foreground)]" htmlFor={displayNameId}>
              Display name
            </label>
            <input
              aria-describedby={fieldErrors.displayName ? displayNameErrorId : undefined}
              aria-invalid={fieldErrors.displayName !== undefined}
              className="w-full rounded-2xl border border-[var(--input)] bg-[var(--background)] px-4 py-3 text-base text-[var(--foreground)] shadow-sm transition placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
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
            <label className="text-sm font-medium text-[var(--foreground)]" htmlFor={roomCodeId}>
              Room code
            </label>
            <input
              aria-describedby={fieldErrors.roomCode ? roomCodeErrorId : undefined}
              aria-invalid={fieldErrors.roomCode !== undefined}
              className="w-full rounded-2xl border border-[var(--input)] bg-[var(--background)] px-4 py-3 text-base uppercase tracking-[0.14em] text-[var(--foreground)] shadow-sm transition placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
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
            <div
              aria-live="polite"
              className="rounded-2xl border border-[color:color-mix(in_srgb,var(--destructive)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--destructive)_10%,var(--card))] px-4 py-3 text-sm text-[var(--foreground)]"
              id={formErrorId}
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:translate-y-[-1px] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              type="submit"
              value="create"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create room
            </button>
            <button
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] shadow-sm transition hover:border-[var(--ring)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              type="submit"
              value="join"
            >
              <Users className="size-4" aria-hidden="true" />
              Join room
            </button>
          </div>

          <div className="rounded-2xl bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">Heads up:</span> room links stay in the browser hash,
            while participant and facilitator tokens remain local to this browser only.
          </div>
        </form>
      </section>

      {toastMessage ? (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[var(--card-shadow)]"
          id={toastId}
          role="status"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <span>{toastMessage}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
