"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import { createRoom, findRoom, joinRoom } from "@/src/features/multiplayer/rooms";

const pawnOptions = [
  { id: 0, icon: "🐶", name: "Pies" },
  { id: 1, icon: "🐱", name: "Kot" },
  { id: 2, icon: "⚡", name: "Pikachu" },
  { id: 3, icon: "🦊", name: "Lis" },
  { id: 4, icon: "🐼", name: "Panda" },
  { id: 5, icon: "🐸", name: "Żaba" },
  { id: 6, icon: "🤖", name: "Robot" },
  { id: 7, icon: "👻", name: "Duszek" },
];

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [selectedPawn, setSelectedPawn] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (pawnError) throw new Error(`Nie udało się zapisać pionka: ${pawnError.message}`);
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
      setError(err instanceof Error ? err.message : "Wystąpił błąd");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!validate()) return;
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
      await joinRoom(code, nickname.trim());
      await savePawn(room);
      sessionStorage.setItem("playerNickname", nickname.trim());
      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wystąpił błąd");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-5xl font-black text-yellow-400">BANK ROLL</h1>
          <p className="text-slate-400 mt-3">Graj ze znajomymi online</p>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
          <div>
            <label htmlFor="nickname" className="block mb-2 text-sm">Twój nick</label>
            <input id="nickname" type="text" maxLength={20} value={nickname}
              onChange={(e) => setNickname(e.target.value)} placeholder="Wpisz nick..."
              className="w-full rounded-lg bg-slate-800 border border-slate-600 p-3 outline-none focus:border-yellow-400" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Wybierz swoją postać</p>
            <div className="grid grid-cols-4 gap-2">
              {pawnOptions.map((pawn) => (
                <button key={pawn.id} type="button" disabled={loading}
                  aria-pressed={selectedPawn === pawn.id}
                  onClick={() => { setSelectedPawn(pawn.id); setError(""); }}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition disabled:opacity-50 ${selectedPawn === pawn.id ? "border-yellow-400 bg-yellow-400/15 ring-1 ring-yellow-400" : "border-slate-700 bg-slate-800 hover:border-slate-500"}`}>
                  <span className="text-3xl">{pawn.icon}</span>
                  <span className="text-[11px] font-semibold">{pawn.name}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              {selectedPawn === null ? "Wybierz pionek, aby rozpocząć" : `Wybrano: ${pawnOptions[selectedPawn].icon} ${pawnOptions[selectedPawn].name}`}
            </p>
          </div>

          <button type="button" onClick={handleCreateRoom} disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-black font-bold py-3 rounded-lg">
            Utwórz pokój
          </button>

          <div className="flex items-center gap-3 text-slate-500">
            <div className="h-px bg-slate-700 flex-1" />LUB<div className="h-px bg-slate-700 flex-1" />
          </div>

          <div>
            <label htmlFor="roomCode" className="block mb-2 text-sm">Kod pokoju</label>
            <input id="roomCode" type="text" maxLength={6} value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="NP. ABC123"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 p-3 uppercase tracking-widest outline-none focus:border-yellow-400" />
          </div>

          <button type="button" onClick={handleJoinRoom} disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold py-3 rounded-lg">
            Dołącz do pokoju
          </button>

          {error && <p role="alert" className="text-red-400 text-sm text-center">{error}</p>}
          {loading && <p className="text-yellow-400 text-sm text-center">Zapisywanie postaci...</p>}
        </div>
      </div>
    </main>
  );
}
