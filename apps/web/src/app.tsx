import { ThemeProvider } from "next-themes";
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { createRoomApi, type RoomApi } from "./api/room-api.js";
import { createRoomCredentialStore, type RoomCredentialStore } from "./auth/room-credentials.js";
import { AppShell } from "./components/app-shell.js";
import { LandingPage } from "./pages/landing-page.js";

interface AppProps {
  api?: Pick<RoomApi, "createRoom" | "joinRoom">;
  credentials?: RoomCredentialStore;
}

function LandingRoute(props: Required<AppProps>) {
  const navigate = useNavigate();

  return (
    <LandingPage
      api={props.api}
      credentials={props.credentials}
      navigate={navigate}
    />
  );
}

function SharedRoomRoute(props: Required<AppProps>) {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const savedCredentials = roomId.length > 0 ? props.credentials.load(roomId) : null;

  if (savedCredentials === null) {
    return (
      <LandingPage
        api={props.api}
        credentials={props.credentials}
        initialRoomId={roomId}
        navigate={navigate}
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--card-shadow)]">
      <span className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--accent-foreground)]">
        Seat restored
      </span>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Room {roomId}</h1>
      <p className="mt-3 text-base leading-7 text-[var(--muted-foreground)]">
        This browser already has credentials for the shared room. The interactive room screen lands in Task 7; for now,
        the route and local restoration boundary are in place.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-[var(--muted-foreground)]">
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1">
          Participant token restored
        </span>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1">
          Facilitator access {savedCredentials.facilitatorToken ? "available" : "not stored"}
        </span>
      </div>
    </section>
  );
}

export function App({ api, credentials }: AppProps) {
  const resolvedApi = api ?? createRoomApi();
  const resolvedCredentials = credentials ?? createRoomCredentialStore();

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<LandingRoute api={resolvedApi} credentials={resolvedCredentials} />} />
            <Route path="/room/:roomId" element={<SharedRoomRoute api={resolvedApi} credentials={resolvedCredentials} />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </ThemeProvider>
  );
}
