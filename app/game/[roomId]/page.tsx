
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";

const fieldColors = [
  "#f87171",
  "#60a5fa",
  "#facc15",
  "#4ade80",
  "#c084fc",
  "#fb923c",
];

const fields = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  label:
    i === 0
      ? "START"
      : i === 7
      ? "WIĘZIENIE"
      : i === 14
      ? "PARKING"
      : i === 21
      ? "IDŹ DO WIĘZ."
      : `$${100 + i * 15}`,
  color: fieldColors[i % fieldColors.length],
}));

type Player = {
  player_id: string;
  nickname: string;
  color: string;
  joined_at: string;
};

type GameState = {
  room_id: string;
  current_turn: string | null;
  positions: Record<string, number>;
  dice_1: number | null;
  dice_2: number | null;
  turn_number: number;
};

function getPosition(index: number) {
  if (index < 8) {
    return { row: 8, col: 8 - index };
  }
  if (index < 15) {
    return { row: 8 - (index - 7), col: 1 };
  }
  if (index < 22) {
    return { row: 1, col: index - 13 };
  }
  return { row: index - 20, col: 8 };
}

const pawnColors = ["🔴", "🔵", "🟢", "🟡"];

function GameContent() {
  const params = useParams();
  const roomId = String(params.roomId);

  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");

  const loadGame = useCallback(async () => {
    const [playersResult, stateResult] = await Promise.all([
      supabase
        .from("room_players")
        .select("player_id, nickname, color, joined_at")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true }),

      supabase
        .from("game_states")
        .select("*")
        .eq("room_id", roomId)
        .single(),
    ]);

    if (playersResult.error) {
      throw playersResult.error;
    }

    if (stateResult.error) {
      throw stateResult.error;
    }

    setPlayers(playersResult.data ?? []);
    setGameState(stateResult.data as GameState);
  }, [roomId]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const { data, error: authError } =
          await supabase.auth.getUser();

        if (authError) throw authError;

        if (!data.user) {
          throw new Error("Nie jesteś zalogowany.");
        }

        if (!active) return;

        setMyId(data.user.id);
        await loadGame();
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Nie udało się wczytać gry."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    const channel = supabase
      .channel(`game-state-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_states",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          if (active) {
            void loadGame().catch((err) => {
              setError(
                err instanceof Error
                  ? err.message
                  : "Błąd synchronizacji."
              );
            });
          }
        }
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId, loadGame]);

  async function rollDice() {
    if (!myId || !gameState || rolling) return;

    if (gameState.current_turn !== myId) {
      setError("To nie jest Twoja tura.");
      return;
    }

    setRolling(true);
    setError("");

    try {
      const { error: rollError } = await supabase.rpc(
        "roll_game_dice",
        { p_room_id: roomId }
      );

      if (rollError) throw rollError;

      await loadGame();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Nie udało się rzucić kostkami."
      );
    } finally {
      setRolling(false);
    }
  }

  const myTurn =
    !!myId && gameState?.current_turn === myId;

  const currentPlayer = players.find(
    (player) => player.player_id === gameState?.current_turn
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-[#20202b] text-white flex items-center justify-center">
        Ładowanie gry...
      </main>
    );
  }

  if (!gameState) {
    return (
      <main className="min-h-screen bg-[#20202b] text-white p-6 text-center">
        <p>Nie udało się wczytać stanu gry.</p>
        <p className="text-red-400 mt-3">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#20202b] text-white flex justify-center">
      <div className="w-full max-w-[430px] min-h-screen bg-[#343440] flex flex-col">

        <header className="p-3 text-center bg-[#252530]">
          <h1 className="text-xl font-black text-yellow-400">
            BANK ROLL
          </h1>
          <p className="text-xs text-gray-400">
            Cel majątku: $5 000
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 p-3">
          {players.slice(0, 2).map((player, index) => (
            <div
              key={player.player_id}
              className="bg-[#262632] rounded-xl p-3"
            >
              <p className="text-sm truncate">
                {pawnColors[index]} {player.nickname}
              </p>
              <p className="text-green-400 font-bold">
                $1 500
              </p>
            </div>
          ))}
        </div>

        <div className="px-2">
          <div className="grid grid-cols-8 gap-[2px] bg-[#191923] p-[2px] rounded-lg aspect-square">
            {fields.map((field) => {
              const boardPosition = getPosition(field.id);

              return (
                <div
                  key={field.id}
                  style={{
                    gridRow: boardPosition.row,
                    gridColumn: boardPosition.col,
                    backgroundColor: field.color,
                  }}
                  className="rounded-sm flex flex-col items-center justify-center text-center p-[1px] overflow-hidden"
                >
                  <span className="text-[7px] font-black text-black leading-tight break-all">
                    {field.label}
                  </span>

                  <div className="flex flex-wrap justify-center gap-[2px]">
                    {players.map((player, index) => {
                      const playerPosition =
                        gameState.positions[player.player_id] ?? 0;

                      if (playerPosition !== field.id) {
                        return null;
                      }

                      return (
                        <span
                          key={player.player_id}
                          className="text-[10px]"
                          title={player.nickname}
                        >
                          {pawnColors[index] ?? "⚪"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div
              style={{
                gridRow: "2 / 8",
                gridColumn: "2 / 8",
              }}
              className="bg-[#b9d5df] rounded-md flex flex-col items-center justify-center text-slate-900 gap-3"
            >
              <div className="text-6xl">🏦</div>
              <h2 className="font-black text-xl">
                BANK ROLL
              </h2>
              <div className="text-4xl">🎲 🎲</div>

              <p className="text-xs font-bold text-center">
                {gameState.dice_1 !== null &&
                gameState.dice_2 !== null
                  ? `${gameState.dice_1} + ${gameState.dice_2} = ${
                      gameState.dice_1 + gameState.dice_2
                    }`
                  : "Oczekiwanie na pierwszy rzut"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3">
          {players.slice(2, 4).map((player, index) => (
            <div
              key={player.player_id}
              className="bg-[#262632] rounded-xl p-3"
            >
              <p className="text-sm truncate">
                {pawnColors[index + 2]} {player.nickname}
              </p>
              <p className="text-green-400 font-bold">
                $1 500
              </p>
            </div>
          ))}
        </div>

        <div className="mt-auto p-4 bg-[#252530] space-y-3">
          <p className="text-center text-sm text-gray-300">
            {myTurn
              ? "🎲 Twoja tura!"
              : `Oczekiwanie na gracza: ${
                  currentPlayer?.nickname ?? "..."
                }`}
          </p>

          <p className="text-center text-xs text-gray-400">
            Tura numer {gameState.turn_number}
          </p>

          {error && (
            <p className="text-red-400 text-sm text-center">
              {error}
            </p>
          )}

          <button
            onClick={rollDice}
            disabled={!myTurn || rolling}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-black py-4 rounded-xl"
          >
            {rolling
              ? "RZUCANIE..."
              : "🎲 RZUĆ KOSTKAMI"}
          </button>

          <p className="text-[10px] text-gray-500 text-center break-all">
            Pokój: {roomId}
          </p>
        </div>
      </div>
    </main>
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={<p>Ładowanie planszy...</p>}>
      <GameContent />
    </Suspense>
  );
}
