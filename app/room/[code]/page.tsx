
"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import {
  findRoom,
  startRoom,
  leaveRoom,
} from "@/src/features/multiplayer/rooms";
import {
  getRoomPlayers,
  subscribeToRoomPlayers,
  subscribeToRoomStatus,
  type RoomPlayer,
} from "@/src/features/multiplayer/realtime";
import { setPlayerReady } from "@/src/features/multiplayer/players";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Room = {
  id: string;
  code: string;
  host_id: string;
  status: string;
  max_players: number;
};

const colors: Record<string, string> = {
  red: "🔴",
  blue: "🔵",
  green: "🟢",
  yellow: "🟡",
};

// Właściwy komponent lobby
function RoomContent() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let playersChannel: RealtimeChannel | null = null;
    let roomChannel: RealtimeChannel | null = null;

    async function loadRoom() {
      try {
        const { data: auth, error: authError } =
          await supabase.auth.getUser();

        if (authError || !auth.user) {
          throw new Error("Nie jesteś zalogowany");
        }

        const currentUserId = auth.user.id;
        const foundRoom = await findRoom(code);

        if (!foundRoom) {
          throw new Error("Pokój nie istnieje");
        }

        const roomPlayers = await getRoomPlayers(
          foundRoom.id
        );

        if (
          !roomPlayers.some(
            (player) => player.player_id === currentUserId
          )
        ) {
          throw new Error("Nie należysz do tego pokoju");
        }

        if (!active) return;

        setRoom(foundRoom);
        setPlayers(roomPlayers);
        setUserId(currentUserId);

        if (foundRoom.status === "playing") {
          router.replace(`/game/${foundRoom.id}`);
          return;
        }

        playersChannel = subscribeToRoomPlayers(
          foundRoom.id,
          (updatedPlayers) => {
            if (active) {
              setPlayers(updatedPlayers);
            }
          },
          (message) => {
            if (active) {
              setError(message);
            }
          }
        );

        roomChannel = subscribeToRoomStatus(
          foundRoom.id,
          () => {
            if (active) {
              router.replace(`/game/${foundRoom.id}`);
            }
          },
          (message) => {
            if (active) {
              setError(message);
            }
          }
        );

        // Sprawdzenie statusu po rozpoczęciu subskrypcji
        const currentRoom = await findRoom(code);

        if (
          active &&
          currentRoom?.status === "playing"
        ) {
          router.replace(`/game/${foundRoom.id}`);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Nieznany błąd"
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadRoom();

    return () => {
      active = false;

      if (playersChannel) {
        supabase.removeChannel(playersChannel);
      }

      if (roomChannel) {
        supabase.removeChannel(roomChannel);
      }
    };
  }, [code, router]);

  const me = players.find(
    (player) => player.player_id === userId
  );

  const isHost = room?.host_id === userId;

  const canStart =
    players.length >= 2 &&
    players.every((player) => player.is_ready);

  async function handleReady() {
    if (!room || !me) return;

    setBusy(true);
    setError("");

    try {
      const updated = await setPlayerReady(
        room.id,
        !me.is_ready
      );

      setPlayers((current) =>
        current.map((player) =>
          player.player_id === userId
            ? {
                ...player,
                is_ready: updated.is_ready,
              }
            : player
        )
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Błąd zmiany gotowości"
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!room) return;

    setBusy(true);
    setError("");

    try {
      await startRoom(room.id);
      router.push(`/game/${room.id}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Błąd rozpoczynania gry"
      );
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!room) return;

    setBusy(true);
    setError("");

    try {
      await leaveRoom(room.id);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Błąd opuszczania pokoju"
      );
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        Ładowanie pokoju...
      </main>
    );
  }

  if (!room) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">
          {error || "Nie znaleziono pokoju"}
        </p>

        <button
          onClick={() => router.push("/")}
          className="bg-yellow-400 text-black px-6 py-3 rounded-lg"
        >
          Wróć
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex justify-center p-6">
      <div className="w-full max-w-xl space-y-6">
        <h1 className="text-4xl font-black text-yellow-400 text-center">
          BANK ROLL
        </h1>

        <p className="text-center text-slate-400">
          Poczekalnia graczy
        </p>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 text-center">
          <p className="text-slate-400">
            Kod zaproszenia
          </p>

          <p className="text-4xl font-black tracking-widest my-4">
            {room.code}
          </p>

          <button
            onClick={() =>
              navigator.clipboard.writeText(room.code)
            }
            className="text-yellow-400 font-semibold"
          >
            Kopiuj kod
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-bold">
            Gracze ({players.length}/{room.max_players})
          </h2>

          {players.map((player) => (
            <div
              key={player.id}
              className="bg-slate-800 rounded-xl p-4 flex justify-between items-center gap-3"
            >
              <span>
                {colors[player.color] ?? "⚪"}{" "}
                {player.nickname}

                {player.player_id === room.host_id &&
                  " 👑"}

                {player.player_id === userId &&
                  " (Ty)"}
              </span>

              <span className="text-sm whitespace-nowrap">
                {player.is_ready
                  ? "✅ Gotowy"
                  : "⏳ Czeka"}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <button
            onClick={handleReady}
            disabled={busy || !me}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 p-4 rounded-xl font-bold"
          >
            {me?.is_ready
              ? "Nie jestem gotowy"
              : "Jestem gotowy"}
          </button>

          {isHost && (
            <button
              onClick={handleStart}
              disabled={busy || !canStart}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-black disabled:opacity-40 p-4 rounded-xl font-bold"
            >
              Rozpocznij grę
            </button>
          )}

          <button
            onClick={handleLeave}
            disabled={busy}
            className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 p-3 rounded-xl"
          >
            Opuść pokój
          </button>
        </div>

        {error && (
          <p className="text-red-400 text-center">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

// Suspense wymagany przez Next.js 16
export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
          Ładowanie lobby...
        </main>
      }
    >
      <RoomContent />
    </Suspense>
  );
}
