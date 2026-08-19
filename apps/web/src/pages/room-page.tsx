import { useEffect, useMemo, useState } from "react";
import { RoomApiError, type RoomApi } from "../api/room-api.js";
import type { RoomCredentialStore, RoomCredentials } from "../auth/room-credentials.js";
import { ConnectionStatus } from "../components/connection-status.js";
import { FacilitatorControls } from "../components/facilitator-controls.js";
import { ParticipantList } from "../components/participant-list.js";
import { ResultsDistribution } from "../components/results-distribution.js";
import { ShareRoom } from "../components/share-room.js";
import { VoteDeck } from "../components/vote-deck.js";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { useRoomConnection, type UseRoomConnectionHook } from "../room/use-room-connection.js";
import { LandingPage } from "./landing-page.js";
import type { VoteValue } from "@scrum-poker/protocol";

interface RoomPageProps {
  api: RoomApi;
  apiBaseUrl?: string | undefined;
  clipboard?: Pick<Clipboard, "writeText"> | undefined;
  credentials: RoomCredentialStore;
  navigate: (path: string) => void;
  roomId: string;
  shareBasePath?: string | undefined;
  shareOrigin?: string | undefined;
  useConnection?: UseRoomConnectionHook | undefined;
}

interface ActiveRoomPageProps extends Omit<RoomPageProps, "credentials"> {
  onExpired: () => void;
  storedCredentials: RoomCredentials;
}

function readApiBaseUrl(providedBaseUrl?: string): string {
  const envBaseUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL;
  const baseUrl = providedBaseUrl ?? envBaseUrl;

  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    throw new Error("VITE_API_BASE_URL is required.");
  }

  return baseUrl;
}

function activeMutationError(intent: "vote" | "reveal" | "reset"): string {
  if (intent === "vote") {
    return "We couldn't record your vote. Please try again.";
  }

  if (intent === "reveal") {
    return "We couldn't reveal the votes. Please try again.";
  }

  return "We couldn't reset the round. Please try again.";
}

function handleMutationError(
  error: unknown,
  intent: "vote" | "reveal" | "reset",
  onExpired: () => void,
  setMutationError: (message: string) => void,
): void {
  if (error instanceof RoomApiError && error.code === "ROOM_NOT_FOUND") {
    onExpired();
    return;
  }

  setMutationError(activeMutationError(intent));
}

function ExpiredRoomCard({ navigate }: Pick<RoomPageProps, "navigate">) {
  return (
    <Card className="p-6">
      <CardHeader>
        <Badge>Room expired</Badge>
        <CardTitle className="mt-3">Room expired</CardTitle>
        <CardDescription>This room is no longer available. Return to the landing page to start a new round.</CardDescription>
      </CardHeader>
      <CardContent className="mt-6">
        <Button onClick={() => navigate("/")}>Back to landing page</Button>
      </CardContent>
    </Card>
  );
}

function ActiveRoomPage({
  api,
  apiBaseUrl,
  clipboard,
  navigate,
  onExpired,
  roomId,
  shareBasePath,
  shareOrigin,
  storedCredentials,
  useConnection = useRoomConnection,
}: ActiveRoomPageProps) {
  const [selectedValue, setSelectedValue] = useState<VoteValue | null>(null);
  const [pendingVoteValue, setPendingVoteValue] = useState<VoteValue | null>(null);
  const [pendingReveal, setPendingReveal] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const connection = useConnection({
    roomId,
    participantToken: storedCredentials.participantToken,
    api,
    apiBaseUrl: readApiBaseUrl(apiBaseUrl),
  });

  useEffect(() => {
    if (connection.status === "expired") {
      onExpired();
    }
  }, [connection.status, onExpired]);

  const selfParticipant = useMemo(
    () =>
      connection.snapshot?.participants.find(
        (participant) => participant.id === connection.snapshot?.selfParticipantId,
      ) ?? null,
    [connection.snapshot],
  );

  useEffect(() => {
    if (connection.snapshot === null || selfParticipant === null) {
      return;
    }

    if (connection.snapshot.phase === "revealed" && selfParticipant.vote !== undefined) {
      setSelectedValue(selfParticipant.vote);
      return;
    }

    if (connection.snapshot.phase === "voting" && !selfParticipant.hasVoted) {
      setSelectedValue(null);
    }
  }, [connection.snapshot, selfParticipant]);

  async function handleVote(value: VoteValue) {
    setMutationError(null);
    setPendingVoteValue(value);

    try {
      await api.vote(roomId, storedCredentials.participantToken, value);
      setSelectedValue(value);
    } catch (error) {
      handleMutationError(error, "vote", onExpired, setMutationError);
    } finally {
      setPendingVoteValue(null);
    }
  }

  async function handleReveal() {
    if (storedCredentials.facilitatorToken === undefined) {
      return;
    }

    setMutationError(null);
    setPendingReveal(true);

    try {
      await api.reveal(roomId, storedCredentials.participantToken, storedCredentials.facilitatorToken);
    } catch (error) {
      handleMutationError(error, "reveal", onExpired, setMutationError);
    } finally {
      setPendingReveal(false);
    }
  }

  async function handleReset() {
    if (storedCredentials.facilitatorToken === undefined) {
      return;
    }

    setMutationError(null);
    setPendingReset(true);

    try {
      await api.reset(roomId, storedCredentials.participantToken, storedCredentials.facilitatorToken);
    } catch (error) {
      handleMutationError(error, "reset", onExpired, setMutationError);
    } finally {
      setPendingReset(false);
    }
  }

  if (connection.status === "expired") {
    return <ExpiredRoomCard navigate={navigate} />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardHeader className="space-y-3">
          <Badge>Voting room</Badge>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <CardTitle>Room {roomId}</CardTitle>
              <CardDescription>
                Hidden votes stay hidden until the facilitator reveals the round.
              </CardDescription>
            </div>
            <ShareRoom basePath={shareBasePath} clipboard={clipboard} origin={shareOrigin} roomId={roomId} />
          </div>
          <ConnectionStatus onReconnect={connection.reconnect} status={connection.status} />
        </CardHeader>
        {mutationError ? (
          <CardContent className="mt-4">
            <Alert aria-live="polite">{mutationError}</Alert>
          </CardContent>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="p-6">
          <CardHeader className="space-y-3">
            <CardTitle>Vote deck</CardTitle>
            <CardDescription>Pick one card. The room snapshot remains authoritative for everyone else.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <VoteDeck
              onVote={handleVote}
              pendingValue={pendingVoteValue}
              revealed={connection.snapshot?.phase === "revealed"}
              selectedValue={selectedValue}
            />
            {connection.snapshot !== null ? (
              <FacilitatorControls
                canFacilitate={storedCredentials.facilitatorToken !== undefined}
                onReset={handleReset}
                onReveal={handleReveal}
                pendingReset={pendingReset}
                pendingReveal={pendingReveal}
                phase={connection.snapshot.phase}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="space-y-3">
            <CardTitle>Participants</CardTitle>
            <CardDescription>
              During voting, each participant shows only whether they are waiting or voted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connection.snapshot === null ? (
              <p className="text-sm text-[var(--muted-foreground)]">Connecting to the latest room snapshot.</p>
            ) : (
              <ParticipantList
                participants={connection.snapshot.participants}
                phase={connection.snapshot.phase}
                selfParticipantId={connection.snapshot.selfParticipantId}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {connection.snapshot?.phase === "revealed" ? (
        <Card className="p-6">
          <CardHeader className="space-y-3">
            <CardTitle>Revealed distribution</CardTitle>
            <CardDescription>Counts are grouped by exact string value with no average calculation.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResultsDistribution participants={connection.snapshot.participants} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function RoomPage({
  api,
  apiBaseUrl,
  clipboard,
  credentials,
  navigate,
  roomId,
  shareBasePath,
  shareOrigin,
  useConnection,
}: RoomPageProps) {
  const [expired, setExpired] = useState(false);
  const storedCredentials = credentials.load(roomId);

  useEffect(() => {
    setExpired(false);
  }, [roomId]);

  if (expired) {
    return <ExpiredRoomCard navigate={navigate} />;
  }

  if (storedCredentials === null) {
    return <LandingPage api={api} credentials={credentials} initialRoomId={roomId} navigate={navigate} />;
  }

  return (
    <ActiveRoomPage
      api={api}
      apiBaseUrl={apiBaseUrl}
      clipboard={clipboard}
      navigate={navigate}
      onExpired={() => {
        credentials.remove(roomId);
        setExpired(true);
      }}
      roomId={roomId}
      shareBasePath={shareBasePath}
      shareOrigin={shareOrigin}
      storedCredentials={storedCredentials}
      useConnection={useConnection}
    />
  );
}
