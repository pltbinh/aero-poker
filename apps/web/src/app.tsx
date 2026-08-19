import { useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { createRoomApi, type RoomApi } from "./api/room-api.js";
import { createRoomCredentialStore, type RoomCredentialStore } from "./auth/room-credentials.js";
import { AppShell } from "./components/app-shell.js";
import { LandingPage } from "./pages/landing-page.js";
import { RoomPage } from "./pages/room-page.js";

interface AppProps {
  api?: RoomApi;
  credentials?: RoomCredentialStore;
}

function readHashKey(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

function LandingRoute(props: Required<AppProps>) {
  const navigate = useNavigate();

  return (
    <LandingPage
      api={props.api}
      credentials={props.credentials}
      initialRoomId=""
      navigate={navigate}
    />
  );
}

function SharedRoomRoute(props: Required<AppProps>) {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();

  return (
    <RoomPage api={props.api} credentials={props.credentials} navigate={navigate} roomId={roomId} />
  );
}

export function App({ api, credentials }: AppProps) {
  const resolvedApi = api ?? createRoomApi();
  const resolvedCredentials = credentials ?? createRoomCredentialStore();
  const [hashKey, setHashKey] = useState(readHashKey);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleHashChange = () => {
      setHashKey(window.location.hash);
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <HashRouter key={hashKey}>
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
