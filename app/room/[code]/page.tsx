"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import { findRoom, startRoom, leaveRoom } from "@/src/features/multiplayer/rooms";
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

type PlayerWithPawn = RoomPlayer & { pawn_id?: number | null };

const pawnIcons = ["🐶", "🐱", "⚡", "🦊", "🐼", "🐸", "🤖", "👻"];
const playerAccents: Record<string, string> = {
  red: "#fb7185",
  blue: "#60a5fa",
  green: "#4ade80",
  yellow: "#facc15",
};

function RoomContent() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<PlayerWithPawn[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    let playersChannel: RealtimeChannel | null = null;
    let roomChannel: RealtimeChannel | null = null;

    async function loadRoom() {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw new Error("Nie jesteś zalogowany");

        const currentUserId = auth.user.id;
        const foundRoom = await findRoom(code);
        if (!foundRoom) throw new Error("Pokój nie istnieje");

        const roomPlayers = await getRoomPlayers(foundRoom.id);
        if (!roomPlayers.some((player) => player.player_id === currentUserId)) {
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
            if (active) setPlayers(updatedPlayers);
          },
          (message) => {
            if (active) setError(message);
          }
        );

        roomChannel = subscribeToRoomStatus(
          foundRoom.id,
          () => {
            if (active) router.replace(`/game/${foundRoom.id}`);
          },
          (message) => {
            if (active) setError(message);
          }
        );

        const currentRoom = await findRoom(code);
        if (active && currentRoom?.status === "playing") {
          router.replace(`/game/${foundRoom.id}`);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Nieznany błąd");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadRoom();
    return () => {
      active = false;
      if (playersChannel) void supabase.removeChannel(playersChannel);
      if (roomChannel) void supabase.removeChannel(roomChannel);
    };
  }, [code, router]);

  const me = players.find((player) => player.player_id === userId);
  const isHost = room?.host_id === userId;
  const readyCount = players.filter((player) => player.is_ready).length;
  const canStart = players.length >= 2 && players.every((player) => player.is_ready);

  async function handleReady() {
    if (!room || !me) return;
    setBusy(true);
    setError("");
    try {
      const updated = await setPlayerReady(room.id, !me.is_ready);
      setPlayers((current) =>
        current.map((player) =>
          player.player_id === userId ? { ...player, is_ready: updated.is_ready } : player
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd zmiany gotowości");
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
      setError(err instanceof Error ? err.message : "Błąd rozpoczynania gry");
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
      setError(err instanceof Error ? err.message : "Błąd opuszczania pokoju");
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
    } catch {
      setError("Nie udało się skopiować kodu. Zaznacz go i skopiuj ręcznie.");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-amber-200">
        <span className="animate-pulse font-semibold">🏙️ Ładowanie CITY ROLL...</span>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#090e1a] px-6 text-white">
        <div className="text-5xl">🏙️</div>
        <h1 className="text-3xl font-black">CITY <span className="text-amber-300">ROLL</span></h1>
        <p className="text-center text-rose-300">{error || "Nie znaleziono pokoju"}</p>
        <button onClick={() => router.push("/")} className="rounded-xl bg-amber-300 px-6 py-3 font-bold text-[#172033]">Wróć na start</button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e3050_0%,#0b1220_52%,#080d17_100%)] px-3 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-white sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-[480px] space-y-3 sm:space-y-4">
        <header className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#0d1626]/90 px-4 py-3 shadow-xl sm:px-5 sm:py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/80">Polska edycja · multiplayer</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">CITY <span className="text-amber-300">ROLL</span></h1>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center sm:h-12 sm:w-12 justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-2xl">🏙️</div>
        </header>

        <section className="rounded-2xl border border-white/10 bg-[#172235] p-4 text-center sm:p-5 shadow-xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-200">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" /> Poczekalnia graczy
          </div>
          <p className="text-xs text-slate-400">Kod zaproszenia dla znajomych</p>
          <div className="my-3 rounded-xl sm:my-4 border border-dashed border-amber-300/30 bg-[#0d1626] px-2 py-3 sm:px-3 sm:py-4">
            <p className="select-all break-all text-[clamp(1.55rem,8vw,3rem)] font-black tracking-[0.12em] text-amber-200 sm:tracking-[0.2em]">{room.code}</p>
          </div>
          <button onClick={handleCopy} className="w-full rounded-xl border border-amber-300/25 bg-amber-300/10 min-h-12 px-4 py-3 text-sm font-bold text-amber-200 transition hover:bg-amber-300/20">
            {copied ? "✓ Kod skopiowany" : "⧉ Kopiuj kod pokoju"}
          </button>
          <p className="mt-3 text-[11px] text-slate-400">Udostępnij kod znajomym, aby mogli dołączyć</p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#172235] p-3 shadow-xl sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-black">👥 Gracze w pokoju</h2>
              <p className="mt-1 text-xs text-slate-400">{readyCount} z {players.length} graczy gotowych</p>
            </div>
            <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-amber-200">{players.length}/{room.max_players}</span>
          </div>

          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-all" style={{ width: `${players.length ? (readyCount / players.length) * 100 : 0}%` }} />
          </div>

          <div className="space-y-2">
            {players.map((player) => {
              const pawn = player.pawn_id;
              const icon = typeof pawn === "number" && pawn >= 0 && pawn < pawnIcons.length ? pawnIcons[pawn] : "🎩";
              const isMe = player.player_id === userId;
              const host = player.player_id === room.host_id;
              return (
                <div key={player.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2.5 sm:gap-3 sm:px-3 sm:py-3 ${isMe ? "border-amber-300/35 bg-[#293348]" : "border-white/5 bg-[#0f1a2b]"}`}>
                  <div className="relative flex h-10 w-10 shrink-0 sm:h-11 sm:w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-2xl">
                    {icon}
                    <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#172235]" style={{ backgroundColor: playerAccents[player.color] ?? "#cbd5e1" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{player.nickname} {host && <span title="Gospodarz">👑</span>} {isMe && <span className="text-xs font-normal text-amber-200">(Ty)</span>}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{host ? "Gospodarz pokoju" : "Gracz"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black sm:px-2.5 sm:text-[10px] ${player.is_ready ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-slate-300"}`}>
                    {player.is_ready ? "✓ GOTOWY" : "⏳ CZEKA"}
                  </span>
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, room.max_players - players.length) }, (_, index) => (
              <div key={`empty-${index}`} className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-3 py-3 opacity-60">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-xl text-slate-500">+</div>
                <span className="text-xs text-slate-400">Wolne miejsce — oczekiwanie na gracza</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2 rounded-2xl sm:space-y-3 border border-white/10 bg-[#172235] p-3 shadow-xl sm:p-4">
          <button onClick={handleReady} disabled={busy || !me} className={`min-h-12 w-full rounded-xl px-4 py-3 text-sm font-black sm:py-4 transition disabled:cursor-not-allowed disabled:opacity-40 ${me?.is_ready ? "border border-emerald-300/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20" : "bg-gradient-to-r from-emerald-400 to-teal-400 text-[#08251d] hover:brightness-110"}`}>
            {me?.is_ready ? "✓ JESTEM GOTOWY — ZMIEŃ STATUS" : "✓ JESTEM GOTOWY"}
          </button>

          {isHost && (
            <>
              <button onClick={handleStart} disabled={busy || !canStart} className="min-h-12 w-full rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 px-4 py-3 sm:py-4 text-sm font-black text-[#172033] shadow-[0_6px_20px_rgba(245,158,11,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                🎲 ROZPOCZNIJ GRĘ
              </button>
              {!canStart && <p className="text-center text-[11px] text-slate-400">Do rozpoczęcia potrzeba minimum 2 graczy i gotowości wszystkich.</p>}
            </>
          )}

          <button onClick={handleLeave} disabled={busy} className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-40">
            ← Opuść pokój
          </button>
          {error && <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-center text-xs text-rose-300">{error}</p>}
        </section>
      </div>
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-amber-200">Ładowanie lobby CITY ROLL...</main>}>
      <RoomContent />
    </Suspense>
  );
}
