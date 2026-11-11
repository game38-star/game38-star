"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import { createRoom, findRoom, joinRoom } from "@/src/features/multiplayer/rooms";

import { pawnOptions } from "@/src/features/game/config";

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [selectedPawn, setSelectedPawn] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"create" | "join" | null>(null);
  const [occupiedPawns, setOccupiedPawns] = useState<number[]>([]);
  const [checkingPawns, setCheckingPawns] = useState(false);
  const [pawnCheckError, setPawnCheckError] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  // Sprawdzamy zajęte pionki po wpisaniu kodu i odświeżamy co 3 sekundy.
  useEffect(() => {
    if (mode !== "join" || roomCode.trim().length !== 6) {
      setOccupiedPawns([]);
      setCheckingPawns(false);
      setPawnCheckError(false);
      return;
    }

    let active = true;
    const code = roomCode.trim().toUpperCase();
    async function checkPawns() {
      if (!active) return;
      setCheckingPawns(true);
      try {
        const room = await findRoom(code);
        if (!active) return;
        if (!room) {
          setOccupiedPawns([]);
          setPawnCheckError(false);
          return;
        }
        const { data, error: queryError } = await supabase
          .from("room_players")
          .select("pawn_id, player_id")
          .eq("room_id", room.id);
        if (queryError) throw queryError;
        if (!active) return;
        setOccupiedPawns((data ?? []).flatMap((p) =>
          typeof p.pawn_id === "number" && p.player_id !== currentUserId ? [p.pawn_id] : []
        ));
        setPawnCheckError(false);
      } catch {
        if (active) {
          setOccupiedPawns([]);
          setPawnCheckError(true);
        }
      } finally {
        if (active) setCheckingPawns(false);
      }
    }

    const timeout = window.setTimeout(() => void checkPawns(), 250);
    const interval = window.setInterval(() => void checkPawns(), 3000);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [mode, roomCode, currentUserId]);

  function isPawnConflict(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const candidate = err as { message?: unknown; details?: unknown; cause?: unknown };
    const details = [candidate.message, candidate.details]
      .filter((part): part is string => typeof part === "string")
      .join(" ").toLowerCase();
    return details.includes("ta postać jest już zajęta") ||
      details.includes("wybrana postać jest już zajęta") ||
      details.includes("room_players_unique_pawn_per_room") ||
      (candidate.cause != null && isPawnConflict(candidate.cause));
  }

  async function fetchOccupiedPawns(roomId: string): Promise<number[]> {
    const { data, error: queryError } = await supabase
      .from("room_players")
      .select("pawn_id, player_id")
      .eq("room_id", roomId);
    if (queryError) throw queryError;
    return [...new Set((data ?? []).flatMap((player) =>
      typeof player.pawn_id === "number" && player.player_id !== currentUserId ? [player.pawn_id] : []
    ))];
  }

  function showJoinError(err: unknown) {
    if (isPawnConflict(err)) {
      setSelectedPawn(null);
      setError("Wybrana postać jest już zajęta. Wybierz jedną z dostępnych postaci.");
      return;
    }
    setError(err instanceof Error ? err.message : "Nie udało się dołączyć do pokoju.");
  }

  function validate(): boolean {
    if (nickname.trim().length < 2) {
      setError("Nick musi mieć minimum 2 znaki.");
      return false;
    }
    if (selectedPawn === null) {
      setError("Najpierw wybierz swoją postać.");
      return false;
    }
    return true;
  }

  async function savePawn(room: { id?: string; code: string }) {
    if (selectedPawn === null) throw new Error("Wybierz postać.");
    let roomId = room.id;
    if (!roomId) {
      const found = await findRoom(room.code);
      roomId = (found as { id?: string } | null)?.id;
    }
    if (!roomId) throw new Error("Nie udało się ustalić identyfikatora pokoju.");

    const { error: pawnError } = await supabase.rpc("set_game_pawn", {
      p_room_id: roomId,
      p_pawn_id: selectedPawn,
    });
    if (pawnError) {
      // Nie ukrywamy innych błędów bazy pod komunikatem o zajętym pionku.
      if (isPawnConflict(pawnError)) {
        const occupied = await fetchOccupiedPawns(roomId);
        setOccupiedPawns(occupied);
        if (occupied.includes(selectedPawn)) {
          setSelectedPawn(null);
          throw new Error("Ta postać jest już zajęta w tym pokoju. Wybierz inną.");
        }
      }
      throw new Error("Nie udało się zapisać postaci: " + pawnError.message);
    }
  }

  async function handleCreateRoom() {
    if (!validate()) return;
    setLoading(true);
    setError("");
    try {
      const room = await createRoom(nickname.trim());
      await savePawn(room);
      sessionStorage.setItem("playerNickname", nickname.trim());
      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się utworzyć pokoju.");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!validate()) return;
    if (selectedPawn !== null && occupiedPawns.includes(selectedPawn)) {
      setError("Ta postać jest już zajęta. Wybierz dostępną postać.");
      return;
    }
    if (!roomCode.trim()) {
      setError("Wpisz kod pokoju.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const code = roomCode.trim().toUpperCase();
      const room = await findRoom(code);
      if (!room) {
        setError("Nie znaleziono pokoju.");
        return;
      }
      // Odczyt tuż przed dołączeniem ogranicza ryzyko wyboru zajętej postaci.
      const latestOccupied = await fetchOccupiedPawns(room.id);
      setOccupiedPawns(latestOccupied);
      if (selectedPawn !== null && latestOccupied.includes(selectedPawn)) {
        setSelectedPawn(null);
        setError("Ta postać jest już zajęta. Wybierz inną.");
        return;
      }

      await joinRoom(code, nickname.trim());
      await savePawn(room);
      sessionStorage.setItem("playerNickname", nickname.trim());
      router.push(`/room/${room.code}`);
    } catch (err) {
      showJoinError(err);
      try {
        const found = await findRoom(roomCode.trim().toUpperCase());
        if (found) setOccupiedPawns(await fetchOccupiedPawns(found.id));
      } catch {
        // Przy kolejnym odświeżeniu lista dostępności zostanie ponownie pobrana.
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080d17] px-4 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,#243b5b_0%,#0c1525_48%,#080d17_85%)]" />
      <div className="pointer-events-none absolute -left-28 top-16 h-72 w-72 rounded-full bg-sky-500/10 blur-[90px]" />
      <div className="pointer-events-none absolute -right-24 bottom-12 h-72 w-72 rounded-full bg-amber-400/10 blur-[90px]" />

      <div className="relative z-10 w-full max-w-[440px]">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] border border-amber-300/25 bg-gradient-to-br from-[#293e59] to-[#142137] text-3xl shadow-[0_12px_40px_rgba(0,0,0,.4)]">🏙️</div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[.35em] text-amber-300/75">Polska edycja · Multiplayer</p>
          <h1 className="text-5xl font-black tracking-[-.06em] sm:text-6xl">CITY <span className="text-amber-300">ROLL</span></h1>
          <p className="mt-3 text-sm text-slate-400">Kupuj miasta. Buduj imperium. Wygrywaj ze znajomymi.</p>
        </header>

        <section className="rounded-[28px] border border-white/10 bg-[#142137]/90 p-5 shadow-[0_24px_70px_rgba(0,0,0,.45)] backdrop-blur-xl sm:p-7">
          {mode === null ? (
            <div className="space-y-4">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-extrabold">Gotowy do gry?</h2>
                <p className="mt-1 text-xs text-slate-400">Wybierz, jak chcesz rozpocząć rozgrywkę</p>
              </div>
              <button type="button" onClick={() => { setMode("create"); setError(""); }}
                className="group flex w-full items-center gap-4 rounded-2xl border border-amber-200/30 bg-gradient-to-r from-amber-300 to-yellow-500 px-5 py-5 text-left text-[#162033] shadow-[0_10px_30px_rgba(245,158,11,.15)] transition hover:-translate-y-0.5 hover:brightness-110">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black/10 text-2xl">＋</span>
                <span className="flex-1"><span className="block text-base font-black">Utwórz pokój</span><span className="block text-xs font-medium opacity-75">Zaproś znajomych do gry</span></span>
                <span className="text-xl font-bold">›</span>
              </button>
              <button type="button" onClick={() => { setMode("join"); setError(""); }}
                className="group flex w-full items-center gap-4 rounded-2xl border border-sky-300/20 bg-[#233750] px-5 py-5 text-left transition hover:-translate-y-0.5 hover:border-sky-300/50 hover:bg-[#2b4260]">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-2xl">👥</span>
                <span className="flex-1"><span className="block text-base font-black">Dołącz do pokoju</span><span className="block text-xs text-slate-400">Masz kod od znajomego?</span></span>
                <span className="text-xl font-bold text-slate-400">›</span>
              </button>
              <div className="flex items-center justify-center gap-2 pt-3 text-[11px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Gra online w czasie rzeczywistym</div>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void (mode === "create" ? handleCreateRoom() : handleJoinRoom()); }}>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-300/75">CITY ROLL</p><h2 className="mt-1 text-xl font-black">{mode === "create" ? "Nowy pokój" : "Dołącz do gry"}</h2></div>
                <button type="button" disabled={loading} onClick={() => { setMode(null); setError(""); }} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50">← Wróć</button>
              </div>
              <div>
                <label htmlFor="nickname" className="mb-2 block text-xs font-bold text-slate-300">TWÓJ NICK</label>
                <input id="nickname" type="text" maxLength={20} autoComplete="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Wpisz tutaj" className="w-full rounded-xl border border-white/10 bg-[#0d192b] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/10" />
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold text-slate-300">WYBIERZ POSTAĆ</p><span className="text-[10px] text-slate-500">{pawnOptions.length} postacie</span></div>
                <div className="grid grid-cols-4 gap-2">
                  {pawnOptions.map((pawn) => {
                    const taken = mode === "join" && occupiedPawns.includes(pawn.id);
                    const selected = selectedPawn === pawn.id;
                    return (
                      <button key={pawn.id} type="button" disabled={loading || taken}
                        aria-pressed={selected} aria-label={`${pawn.name}${taken ? " — zajęta" : ""}`}
                        onClick={() => { setSelectedPawn(pawn.id); setError(""); }}
                        style={{ borderColor: selected && !taken ? pawn.color : undefined, backgroundColor: selected && !taken ? `${pawn.color}20` : undefined }}
                        className={`relative flex min-h-[90px] flex-col items-center justify-center gap-1 rounded-xl border p-2 transition disabled:cursor-not-allowed ${taken ? "border-white/5 bg-[#101a2a] opacity-40 grayscale" : selected ? "border-2" : "border-white/10 bg-[#1d2d44] hover:-translate-y-0.5 hover:border-white/30"}`}>
                        {selected && !taken && <span style={{ color: pawn.color }} className="absolute right-1 top-1 text-[10px]">✓</span>}
                        <span className="text-[28px] leading-none">{pawn.icon}</span>
                        <span style={{ color: selected && !taken ? pawn.color : undefined }} className="text-[10px] font-semibold text-slate-300">{pawn.name}</span>
                        {taken && <span className="text-[9px] font-bold text-rose-300">ZAJĘTA</span>}
                      </button>
                    );
                  })}
                </div>
                {mode === "join" && roomCode.trim().length === 6 && (
                  <p className="mt-2 text-xs text-slate-400" aria-live="polite">
                    {pawnCheckError ? "Nie można sprawdzić zajętych postaci — dostępność zostanie zweryfikowana przy dołączeniu."
                      : checkingPawns && occupiedPawns.length === 0 ? "Sprawdzanie dostępnych postaci..."
                      : `${pawnOptions.length - occupiedPawns.length} z ${pawnOptions.length} postaci dostępnych`}
                  </p>
                )}
                {mode === "join" && roomCode.trim().length !== 6 && <p className="mt-2 text-xs text-slate-400">Wpisz kod pokoju, aby zobaczyć zajęte postacie.</p>}
              </div>
              {mode === "join" && <div><label htmlFor="roomCode" className="mb-2 block text-xs font-bold text-slate-300">KOD POKOJU</label><input id="roomCode" type="text" maxLength={6} autoCapitalize="characters" value={roomCode} onChange={(e) => { setRoomCode(e.target.value.toUpperCase()); setSelectedPawn(null); setOccupiedPawns([]); }} placeholder="NP. ABC123" className="w-full rounded-xl border border-white/10 bg-[#0d192b] px-4 py-3.5 text-center text-lg font-black uppercase tracking-[.25em] text-white outline-none transition placeholder:text-slate-600 focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/10" /></div>}
              <button type="submit" disabled={loading} className={`w-full rounded-xl px-4 py-4 text-sm font-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${mode === "create" ? "bg-gradient-to-r from-amber-300 to-yellow-500 text-[#162033]" : "bg-gradient-to-r from-sky-500 to-blue-600 text-white"}`}>{loading ? "Zapisywanie postaci..." : mode === "create" ? "✨ Utwórz pokój" : "👥 Dołącz do pokoju"}</button>
            </form>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-3 text-center text-xs text-rose-300">{error}</p>}
        </section>
      </div>
    </main>
  );
}
