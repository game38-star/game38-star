"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";

type Player = { player_id: string; nickname: string; color: string; joined_at: string };
type Property = { field_id: number; owner_id: string };
type GameState = {
  room_id: string;
  current_turn: string | null;
  positions: Record<string, number>;
  balances: Record<string, number>;
  dice_1: number | null;
  dice_2: number | null;
  turn_number: number;
  turn_phase: "roll" | "decision";
  last_rent: { from_player: string; to_player: string; field_id: number; amount: number } | null;
  last_start_bonus?: { player_id: string; amount: number } | null;
};

const pawnColors = ["🔴", "🔵", "🟢", "🟡"];
const playerAccents = ["#fb7185", "#60a5fa", "#4ade80", "#facc15"];
const cityNames = [
  "START", "GDAŃSK", "GDYNIA", "SOPOT", "OLSZTYN", "TORUŃ", "BYDGOSZCZ",
  "WIĘZIENIE", "SZCZECIN", "GORZÓW", "POZNAŃ", "ZIELONA GÓRA", "WROCŁAW", "OPOLE",
  "PARKING", "KATOWICE", "KRAKÓW", "RZESZÓW", "LUBLIN", "KIELCE", "ŁÓDŹ",
  "IDŹ DO WIĘZ.", "BIAŁYSTOK", "RADOM", "PŁOCK", "SIEDLCE", "WARSZAWA", "ZAKOPANE",
];
const groupColors = ["#fb7185", "#60a5fa", "#fbbf24", "#34d399", "#a78bfa", "#fb923c"];
const specialIds = new Set([0, 7, 14, 21]);
const fields = cityNames.map((name, id) => ({
  id,
  name,
  price: specialIds.has(id) ? null : 100 + id * 15,
  color: groupColors[Math.floor(id / 4) % groupColors.length],
}));

function getPosition(index: number) {
  if (index < 8) return { row: 8, col: 8 - index };
  if (index < 15) return { row: 8 - (index - 7), col: 1 };
  if (index < 22) return { row: 1, col: index - 13 };
  return { row: index - 20, col: 8 };
}

function GameContent() {
  const params = useParams();
  const roomId = String(params.roomId);
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadGame = useCallback(async () => {
    const [playersResult, stateResult, propertiesResult] = await Promise.all([
      supabase.from("room_players").select("player_id, nickname, color, joined_at")
        .eq("room_id", roomId).order("joined_at", { ascending: true }).order("player_id", { ascending: true }),
      supabase.from("game_states").select("*").eq("room_id", roomId).single(),
      supabase.from("game_properties").select("field_id, owner_id").eq("room_id", roomId),
    ]);
    if (playersResult.error) throw playersResult.error;
    if (stateResult.error) throw stateResult.error;
    if (propertiesResult.error) throw propertiesResult.error;
    setPlayers(playersResult.data ?? []);
    setProperties(propertiesResult.data ?? []);
    setGameState(stateResult.data as GameState);
  }, [roomId]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!data.user) throw new Error("Nie jesteś zalogowany.");
        if (!active) return;
        setMyId(data.user.id);
        await loadGame();
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Nie udało się wczytać gry.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    const channel = supabase.channel(`game-state-${roomId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_states", filter: `room_id=eq.${roomId}`,
      }, () => {
        if (active) void loadGame().catch((err) => {
          if (active) setError(err instanceof Error ? err.message : "Błąd synchronizacji.");
        });
      }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [roomId, loadGame]);

  async function rollDice() {
    if (!myId || !gameState || busy) return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "roll") {
      setError("Teraz nie możesz rzucić kostkami."); return;
    }
    setBusy(true); setError("");
    try {
      const { error: rpcError } = await supabase.rpc("roll_game_dice", { p_room_id: roomId });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) { setError(err instanceof Error ? err.message : "Nie udało się rzucić kostkami."); }
    finally { setBusy(false); }
  }

  async function finishTurn() {
    if (!myId || !gameState || busy) return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Nie możesz teraz zakończyć tury."); return;
    }
    setBusy(true); setError("");
    try {
      const { error: rpcError } = await supabase.rpc("finish_game_turn", { p_room_id: roomId });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) { setError(err instanceof Error ? err.message : "Nie udało się zakończyć tury."); }
    finally { setBusy(false); }
  }

  async function buyProperty() {
    if (!myId || !gameState || busy) return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Teraz nie możesz kupić nieruchomości."); return;
    }
    const position = gameState.positions?.[myId];
    if (position == null || specialIds.has(position)) { setError("Tego pola nie można kupić."); return; }
    if (properties.some((property) => property.field_id === position)) {
      setError("Ta nieruchomość ma już właściciela."); return;
    }
    const price = 100 + position * 15;
    if ((gameState.balances?.[myId] ?? 0) < price) {
      setError("Nie masz wystarczająco pieniędzy."); return;
    }
    setBusy(true); setError("");
    try {
      const { error: rpcError } = await supabase.rpc("buy_game_property", { p_room_id: roomId });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) { setError(err instanceof Error ? err.message : "Nie udało się kupić nieruchomości."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-slate-200">Ładowanie BANK ROLL...</main>;
  if (!gameState) return <main className="min-h-screen bg-[#090e1a] p-8 text-center text-white">Nie udało się wczytać gry.<p className="mt-3 text-rose-400">{error}</p></main>;

  const myTurn = !!myId && gameState.current_turn === myId;
  const currentPlayer = players.find((p) => p.player_id === gameState.current_turn);
  const activePosition = gameState.current_turn ? gameState.positions?.[gameState.current_turn] ?? 0 : 0;
  const activeField = fields[activePosition];
  const propertyOwner = properties.find((p) => p.field_id === activePosition);
  const propertyOwnerPlayer = players.find((p) => p.player_id === propertyOwner?.owner_id);
  const propertyPrice = 100 + activePosition * 15;
  const activeBalance = gameState.current_turn ? gameState.balances?.[gameState.current_turn] ?? 0 : 0;
  const hasDice = gameState.dice_1 !== null && gameState.dice_2 !== null;

  function renderPlayer(player: Player, index: number) {
    const isCurrent = gameState!.current_turn === player.player_id;
    const isMe = player.player_id === myId;
    const owned = properties.filter((p) => p.owner_id === player.player_id).length;
    return (
      <div key={player.player_id} className={`relative min-w-0 rounded-2xl border p-3 transition-colors ${isCurrent ? "border-amber-300/70 bg-[#293348] shadow-[0_0_22px_rgba(251,191,36,0.12)]" : "border-white/10 bg-[#172235]"}`}>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg">{pawnColors[index] ?? "⚪"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{player.nickname}{isMe ? " (Ty)" : ""}</p>
            <p className="text-[10px] text-slate-400">🏠 {owned} miast{owned === 1 ? "o" : ""}</p>
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between gap-1">
          <span className="text-lg font-black tracking-tight" style={{ color: playerAccents[index] ?? "#fff" }}>${(gameState!.balances?.[player.player_id] ?? 1500).toLocaleString("en-US")}</span>
          {isCurrent && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-black text-[#151b2b]">TURA</span>}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e3050_0%,#0b1220_52%,#080d17_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col border-x border-white/5 bg-[#0d1626]/80 pb-4 shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/80">Polska edycja</p>
            <h1 className="text-2xl font-black tracking-tight">BANK <span className="text-amber-300">ROLL</span></h1>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Tura</p>
            <p className="text-lg font-black text-amber-300">#{gameState.turn_number}</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-3">{players.slice(0, 2).map((p, i) => renderPlayer(p, i))}</div>

        {/* Układ 8 × 8: dokładnie 28 pól na obwodzie, bank w środku. */}
        <div className="px-2 sm:px-3">
          <div className="grid aspect-square grid-cols-8 grid-rows-8 gap-[2px] overflow-hidden rounded-2xl border border-white/10 bg-[#060b15] p-[3px] shadow-[0_14px_45px_rgba(0,0,0,0.35)]">
            {fields.map((field) => {
              const pos = getPosition(field.id);
              const owner = properties.find((p) => p.field_id === field.id);
              const ownerIndex = players.findIndex((p) => p.player_id === owner?.owner_id);
              const pawns = players.map((p, i) => ({ player: p, index: i })).filter(({ player }) => (gameState.positions?.[player.player_id] ?? 0) === field.id);
              const isActive = activePosition === field.id;
              const isSpecial = field.price === null;
              return (
                <div key={field.id} style={{ gridRow: pos.row, gridColumn: pos.col, borderTopColor: isSpecial ? "#fbbf24" : field.color }}
                  title={`${field.name}${field.price !== null ? ` • $${field.price}` : ""}${ownerIndex >= 0 ? ` • właściciel: ${players[ownerIndex].nickname}` : ""}`}
                  className={`relative flex min-h-0 min-w-0 flex-col items-center justify-between overflow-hidden rounded-[5px] border border-t-[4px] px-[1px] py-[2px] text-center ${isActive ? "border-x-amber-300/70 border-b-amber-300/70 bg-[#34435a]" : "border-x-white/5 border-b-white/5 bg-[#1a283b]"}`}>
                  <span className="w-full break-words text-center text-[clamp(5px,1.55vw,8px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-100">{field.name}</span>
                  <div className="flex min-h-0 flex-col items-center justify-end gap-0">
                    {field.price !== null ? <span className="text-[clamp(6px,1.65vw,9px)] font-black leading-none text-amber-200">${field.price}</span> : <span className="text-[clamp(9px,2.6vw,15px)] leading-none">{field.id === 0 ? "🚩" : field.id === 7 ? "🔒" : field.id === 14 ? "🅿️" : "🚓"}</span>}
                    {owner && <span className="text-[clamp(8px,2vw,12px)] leading-none" title={ownerIndex >= 0 ? players[ownerIndex].nickname : "Właściciel"}>{pawnColors[ownerIndex] ?? "⚪"}⌂</span>}
                    {pawns.length > 0 && <div className="flex max-w-full flex-wrap justify-center gap-0 leading-none">{pawns.map(({ player, index }) => <span key={player.player_id} title={player.nickname} className="text-[clamp(8px,2vw,12px)] leading-none">{pawnColors[index] ?? "⚪"}</span>)}</div>}
                  </div>
                </div>
              );
            })}

            <div style={{ gridRow: "2 / 8", gridColumn: "2 / 8" }} className="relative flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-sky-200/10 bg-[radial-gradient(circle_at_50%_20%,#2d4663_0%,#18263c_50%,#101b2e_100%)] p-2 text-center">
              <div className="absolute inset-3 rounded-full border border-white/5" />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-3xl shadow-lg">🏦</div>
              <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-amber-200/70">Polska edycja</p>
              <h2 className="relative text-[clamp(18px,6vw,28px)] font-black tracking-tight">BANK <span className="text-amber-300">ROLL</span></h2>
              <p className="relative max-w-[95%] truncate text-[11px] font-medium text-slate-300">{currentPlayer?.nickname ?? "Oczekiwanie"} • {gameState.turn_phase === "roll" ? "rzut kostkami" : "decyzja"}</p>
              <div className="relative flex items-center gap-2">
                {[gameState.dice_1, gameState.dice_2].map((die, i) => <div key={i} className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white text-2xl font-black text-[#18263c] shadow-md">{die ?? "?"}</div>)}
              </div>
              <p className="relative text-xs font-bold text-amber-200">{hasDice ? `Wynik: ${gameState.dice_1! + gameState.dice_2!}` : "Czekamy na pierwszy rzut"}</p>
              <div className="relative rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] text-slate-300">Cel: $5 000</div>
            </div>
          </div>
        </div>

        {players.length > 2 && <div className="grid grid-cols-2 gap-2 px-3 py-3">{players.slice(2, 4).map((p, i) => renderPlayer(p, i + 2))}</div>}

        <div className="space-y-2 px-3 pt-3">
          {gameState.last_start_bonus && <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-center"><p className="text-sm font-bold text-emerald-200">💰 Premia za START</p><p className="text-xs text-slate-300">{players.find((p) => p.player_id === gameState.last_start_bonus?.player_id)?.nickname ?? "Gracz"} ukończył okrążenie</p><p className="text-xl font-black text-emerald-300">+${gameState.last_start_bonus.amount}</p></div>}
          {gameState.last_rent && <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-center"><p className="text-sm font-bold text-amber-200">💸 Zapłacono czynsz</p><p className="text-xs text-slate-300">{players.find((p) => p.player_id === gameState.last_rent?.from_player)?.nickname ?? "Gracz"} → {players.find((p) => p.player_id === gameState.last_rent?.to_player)?.nickname ?? "Gracz"} · {fields[gameState.last_rent.field_id]?.name ?? "Nieruchomość"}</p><p className="text-xl font-black text-amber-200">${gameState.last_rent.amount}</p></div>}
        </div>

        <section className="mt-auto px-3 pt-3">
          <div className="rounded-2xl border border-white/10 bg-[#172235] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Aktualny ruch</p><p className="truncate text-sm font-bold text-white">{myTurn ? "✨ Twoja kolej!" : `⏳ ${currentPlayer?.nickname ?? "Oczekiwanie"}`}</p></div>
              <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">{gameState.turn_phase === "roll" ? "RZUT" : "DECYZJA"}</span>
            </div>
            {error && <p role="alert" className="mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 p-2 text-center text-xs text-rose-300">{error}</p>}
            {gameState.turn_phase === "roll" ? (
              <button onClick={rollDice} disabled={!myTurn || busy} className="w-full rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 px-4 py-4 text-sm font-black tracking-wide text-[#172033] shadow-[0_6px_20px_rgba(245,158,11,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "RZUCANIE..." : "🎲 RZUĆ KOSTKAMI"}</button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-[#0f1a2b] p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pole {activePosition}</p>
                  <p className="mt-1 text-lg font-black text-white">{activeField?.name ?? "Nieznane pole"}</p>
                  {specialIds.has(activePosition) ? <p className="mt-1 text-xs text-slate-400">Pole specjalne — brak możliwości zakupu</p> : propertyOwner ? <p className="mt-1 text-xs text-slate-300">🏠 Właściciel: <span className="font-bold text-amber-200">{propertyOwnerPlayer?.nickname ?? "Gracz"}</span></p> : <><p className="mt-1 text-xl font-black text-emerald-300">${propertyPrice}</p><p className="mt-1 text-xs text-slate-400">Saldo: ${activeBalance.toLocaleString("en-US")}</p><button onClick={buyProperty} disabled={!myTurn || busy || activeBalance < propertyPrice} className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-3 py-3 font-black text-[#08251d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "PRZETWARZANIE..." : `🏠 KUP MIASTO ZA $${propertyPrice}`}</button></>}
                </div>
                <button onClick={finishTurn} disabled={!myTurn || busy} className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "KOŃCZENIE TURY..." : "⏭️ ZAKOŃCZ TURĘ"}</button>
              </div>
            )}
            <p className="mt-3 truncate text-center text-[10px] text-slate-500">Pokój: {roomId}</p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function GamePage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-white">Ładowanie planszy...</main>}><GameContent /></Suspense>;
}
