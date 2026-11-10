
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createRoom,
  findRoom,
  joinRoom,
} from "@/src/features/multiplayer/rooms";

export default function HomePage() {
  const router = useRouter();

  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateRoom() {
    if (nickname.trim().length < 2) {
      setError("Nick musi mieć minimum 2 znaki.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const room = await createRoom(nickname.trim());

      sessionStorage.setItem("playerNickname", nickname.trim());

      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Wystąpił błąd"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (nickname.trim().length < 2) {
      setError("Nick musi mieć minimum 2 znaki.");
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

      await joinRoom(code, nickname.trim());

      sessionStorage.setItem("playerNickname", nickname.trim());

      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Wystąpił błąd"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-5xl font-black text-yellow-400">
            BANK ROLL
          </h1>
          <p className="text-slate-400 mt-3">
            Graj ze znajomymi online
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5">
          <div>
            <label className="block mb-2 text-sm">
              Twój nick
            </label>
            <input
              type="text"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Wpisz nick..."
              className="w-full rounded-lg bg-slate-800 border border-slate-600 p-3 outline-none focus:border-yellow-400"
            />
          </div>

          <button
            onClick={handleCreateRoom}
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-black font-bold py-3 rounded-lg"
          >
            Utwórz pokój
          </button>

          <div className="flex items-center gap-3 text-slate-500">
            <div className="h-px bg-slate-700 flex-1" />
            LUB
            <div className="h-px bg-slate-700 flex-1" />
          </div>

          <div>
            <label className="block mb-2 text-sm">
              Kod pokoju
            </label>
            <input
              type="text"
              maxLength={6}
              value={roomCode}
              onChange={(e) =>
                setRoomCode(e.target.value.toUpperCase())
              }
              placeholder="NP. ABC123"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 p-3 uppercase tracking-widest outline-none focus:border-yellow-400"
            />
          </div>

          <button
            onClick={handleJoinRoom}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold py-3 rounded-lg"
          >
            Dołącz do pokoju
          </button>

          {error && (
            <p className="text-red-400 text-sm text-center">
              {error}
            </p>
          )}

          {loading && (
            <p className="text-yellow-400 text-sm text-center">
              Ładowanie...
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
