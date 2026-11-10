"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import type { Player, Property, GameState, RoomStatus } from "@/src/features/game/types";
import { fields, cityPrices, specialIds } from "@/src/features/game/config";
import { PlayerCard } from "@/src/features/game/components/PlayerCard";
import { GameBoard } from "@/src/features/game/components/GameBoard";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function GameContent() {
  const params = useParams();
  const roomId = String(params.roomId);
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [diceRolling, setDiceRolling] = useState(false);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, number>>({});

  const [error, setError] = useState("");

  const loadGame = useCallback(async () => {
    const [playersResult, stateResult, propertiesResult, roomResult] = await Promise.all([
      supabase.from("room_players").select("player_id, nickname, color, joined_at, is_bankrupt, pawn_id")
        .eq("room_id", roomId).order("joined_at", { ascending: true }).order("player_id", { ascending: true }),
      supabase.from("game_states").select("*").eq("room_id", roomId).single(),
      supabase.from("game_properties").select("field_id, owner_id, building_level").eq("room_id", roomId),
      supabase.from("rooms").select("status, winner_id").eq("id", roomId).single(),
    ]);
    if (playersResult.error) throw new Error("Błąd graczy: " + playersResult.error.message);
    if (stateResult.error) throw new Error("Błąd stanu gry: " + stateResult.error.message);
    if (propertiesResult.error) throw new Error("Błąd nieruchomości: " + propertiesResult.error.message);
    if (roomResult.error) throw new Error("Błąd pokoju: " + roomResult.error.message);
    setPlayers(playersResult.data ?? []);
    setProperties(propertiesResult.data ?? []);
    setGameState(stateResult.data as GameState);
    setRoomStatus(roomResult.data as RoomStatus);
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
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "roll") {
      setError("Teraz nie możesz rzucić kostkami."); return;
    }

    const playerId = myId;
    const startPosition = gameState.positions?.[playerId] ?? 0;
    const startedAt = Date.now();
    const diceSound = new Audio("/sounds/dice-roll.wav");
    diceSound.volume = 0.7;
    void diceSound.play().catch(() => {});

    setBusy(true);
    setDiceRolling(true);
    setAnimatedPositions((previous) => ({ ...previous, [playerId]: startPosition }));
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("roll_game_dice", { p_room_id: roomId });
      if (rpcError) throw rpcError;

      // Odczytujemy autentyczny wynik z serwera, bez ponownego losowania.
      const { data: rolledState, error: stateError } = await supabase
        .from("game_states")
        .select("dice_1, dice_2, positions")
        .eq("room_id", roomId)
        .single();
      if (stateError) throw stateError;

      const first = Number(rolledState.dice_1);
      const second = Number(rolledState.dice_2);
      if (!Number.isInteger(first) || !Number.isInteger(second) || first < 1 || first > 6 || second < 1 || second > 6) {
        throw new Error("Nie udało się odczytać wyniku kostek.");
      }
      const steps = first + second;
      // Co najmniej 900 ms animacji rzutu, nawet jeśli baza odpowie błyskawicznie.
      await wait(Math.max(0, 900 - (Date.now() - startedAt)));
      await loadGame();
      setDiceRolling(false);
      await wait(350);

      for (let step = 1; step <= steps; step++) {
        setAnimatedPositions((previous) => ({ ...previous, [playerId]: (startPosition + step) % 28 }));
        await wait(290);
      }
      // Na koniec oddajemy pozycję serwerowi, który pozostaje źródłem prawdy.
      setAnimatedPositions((previous) => {
        const next = { ...previous };
        delete next[playerId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się rzucić kostkami.");
      setAnimatedPositions((previous) => {
        const next = { ...previous };
        delete next[playerId];
        return next;
      });
    } finally {
      setDiceRolling(false);
      setBusy(false);
    }
  }

  async function finishTurn() {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Nie możesz teraz zakończyć tury."); return;
    }
    if ((gameState.balances?.[myId] ?? 0) < 0) {
      setError("Masz dług. Sprzedaj majątek albo ogłoś bankructwo."); return;
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
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Teraz nie możesz kupić nieruchomości."); return;
    }
    const position = gameState.positions?.[myId];
    if (position == null || specialIds.has(position)) { setError("Tego pola nie można kupić."); return; }
    if (properties.some((property) => property.field_id === position)) {
      setError("Ta nieruchomość ma już właściciela."); return;
    }
    const price = cityPrices[position];
    if (price == null) { setError("Tego pola nie można kupić."); return; }
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

  async function buildProperty(fieldId: number) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Możesz budować tylko podczas swojej tury w fazie decyzji.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("build_game_property", {
        p_room_id: roomId,
        p_field_id: fieldId,
      });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się rozbudować miasta.");
    } finally {
      setBusy(false);
    }
  }

  async function sellBuilding(fieldId: number) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Możesz sprzedawać tylko podczas swojej tury.");
      return;
    }
    const property = properties.find((p) => p.field_id === fieldId);
    if (!property || property.owner_id !== myId || property.building_level <= 0) {
      setError("Nie masz budynku do sprzedania na tym polu.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("sell_game_building", {
        p_room_id: roomId,
        p_field_id: fieldId,
      });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się sprzedać budynku.");
    } finally {
      setBusy(false);
    }
  }

  async function sellProperty(fieldId: number) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Możesz sprzedawać tylko podczas swojej tury.");
      return;
    }
    const property = properties.find((p) => p.field_id === fieldId);
    if (!property || property.owner_id !== myId) {
      setError("To nie jest Twoje miasto.");
      return;
    }
    if ((property.building_level ?? 0) > 0) {
      setError("Najpierw sprzedaj domki lub hotel.");
      return;
    }
    const city = fields[fieldId];
    if (!city || city.price === null) return;
    if (!window.confirm(`Sprzedać ${city.name} do banku za $${Math.floor(city.price * 0.5)}?`)) return;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("sell_game_property", {
        p_room_id: roomId,
        p_field_id: fieldId,
      });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się sprzedać miasta.");
    } finally {
      setBusy(false);
    }
  }

  async function declareBankruptcy() {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision" ||
        (gameState.balances?.[myId] ?? 0) >= 0) {
      setError("Bankructwo można ogłosić tylko przy ujemnym saldzie podczas własnej decyzji.");
      return;
    }
    if (!window.confirm("Ogłosić bankructwo? Stracisz wszystkie miasta i odpadniesz z gry.")) return;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("declare_game_bankruptcy", { p_room_id: roomId });
      if (rpcError) throw rpcError;
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się ogłosić bankructwa.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-slate-200">Ładowanie CITY ROLL...</main>;
  if (!gameState) return <main className="min-h-screen bg-[#090e1a] p-8 text-center text-white">Nie udało się wczytać gry.<p className="mt-3 text-rose-400">{error}</p></main>;

  const gameFinished = roomStatus?.status === "finished";
  const winner = players.find((p) => p.player_id === roomStatus?.winner_id);
  const myTurn = !gameFinished && !!myId && gameState.current_turn === myId && !players.find((p) => p.player_id === myId)?.is_bankrupt;
  const currentPlayer = players.find((p) => p.player_id === gameState.current_turn);
  const activePosition = gameState.current_turn ? gameState.positions?.[gameState.current_turn] ?? 0 : 0;
  const activeField = fields[activePosition];
  const propertyOwner = properties.find((p) => p.field_id === activePosition);
  const propertyOwnerPlayer = players.find((p) => p.player_id === propertyOwner?.owner_id);
  const propertyPrice = cityPrices[activePosition] ?? 0;
  const activeBalance = gameState.current_turn ? gameState.balances?.[gameState.current_turn] ?? 0 : 0;
  const hasDice = gameState.dice_1 !== null && gameState.dice_2 !== null;


  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e3050_0%,#0b1220_52%,#080d17_100%)] text-white">
      <style>{`@keyframes bankrollDiceSpin { 0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 100% { transform: rotateX(1080deg) rotateY(1440deg) rotateZ(360deg); } } .bankroll-dice-spin { animation: bankrollDiceSpin 850ms linear infinite; } @keyframes bankrollPawnHop { 0% { transform: translateY(3px) scale(.9) rotate(-8deg); } 45% { transform: translateY(-8px) scale(1.14) rotate(5deg); } 100% { transform: translateY(0) scale(1); } } .bankroll-pawn-hop { animation: bankrollPawnHop 290ms ease-out; }`}</style>
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col border-x border-white/5 bg-[#0d1626]/80 pb-4 shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/80">Polska edycja</p>
            <h1 className="text-2xl font-black tracking-tight">CITY <span className="text-amber-300">ROLL</span></h1>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Tura</p>
            <p className="text-lg font-black text-amber-300">#{gameState.turn_number}</p>
          </div>
        </header>

        {gameFinished && (
          <section className="mx-3 mt-3 rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-300/20 to-[#172235] p-5 text-center shadow-xl">
            <div className="text-5xl">🏆</div>
            <h2 className="mt-2 text-xl font-black text-amber-200">KONIEC GRY!</h2>
            <p className="mt-1 text-sm text-white">Zwycięzca: <strong>{winner?.nickname ?? "Nieznany gracz"}</strong></p>
            {roomStatus?.winner_id === myId && <p className="mt-2 text-sm font-bold text-emerald-300">🎉 Wygrałeś CITY ROLL!</p>}
            <div className="mt-3 space-y-1 text-left">
              {players.map((player) => (
                <div key={player.player_id} className="flex justify-between rounded-lg bg-black/20 px-3 py-2 text-xs">
                  <span>{player.player_id === roomStatus?.winner_id ? "👑 " : player.is_bankrupt ? "💀 " : "• "}{player.nickname}</span>
                  <span className="font-bold">${(gameState.balances?.[player.player_id] ?? 0).toLocaleString("en-US")}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-3">{players.slice(0, 2).map((p, i) => <PlayerCard key={p.player_id} player={p} index={i} gameState={gameState} myId={myId} properties={properties} />)}</div>

        <GameBoard players={players} properties={properties} gameState={gameState} animatedPositions={animatedPositions} currentPlayer={currentPlayer} activePosition={activePosition} diceRolling={diceRolling} hasDice={hasDice} />
        {players.length > 2 && <div className="grid grid-cols-2 gap-2 px-3 py-3">{players.slice(2, 4).map((p, i) => <PlayerCard key={p.player_id} player={p} index={i + 2} gameState={gameState} myId={myId} properties={properties} />)}</div>}

        <div className="space-y-2 px-3 pt-3">
          {gameState.last_start_bonus && <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-center"><p className="text-sm font-bold text-emerald-200">💰 Premia za START</p><p className="text-xs text-slate-300">{players.find((p) => p.player_id === gameState.last_start_bonus?.player_id)?.nickname ?? "Gracz"} ukończył okrążenie</p><p className="text-xl font-black text-emerald-300">+${gameState.last_start_bonus.amount}</p></div>}
          {gameState.last_rent && <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-center"><p className="text-sm font-bold text-amber-200">💸 Zapłacono czynsz</p><p className="text-xs text-slate-300">{players.find((p) => p.player_id === gameState.last_rent?.from_player)?.nickname ?? "Gracz"} → {players.find((p) => p.player_id === gameState.last_rent?.to_player)?.nickname ?? "Gracz"} · {fields[gameState.last_rent.field_id]?.name ?? "Nieruchomość"}</p><p className="text-xl font-black text-amber-200">${gameState.last_rent.amount}</p></div>}
        </div>

        {myTurn && gameState.turn_phase === "decision" && (
          <section className="px-3 pt-3">
            <div className="rounded-2xl border border-white/10 bg-[#172235] p-4">
              <h3 className="mb-1 text-sm font-bold text-white">🏗️ Zarządzanie miastami</h3>
              <p className="mb-3 text-[11px] text-slate-400">
                Buduj domki i hotele, sprzedawaj budynki albo oddaj miasto do banku.
              </p>
              {properties.filter((p) => p.owner_id === myId).length === 0 ? (
                <p className="text-xs text-slate-400">Najpierw kup swoje pierwsze miasto.</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {properties.filter((p) => p.owner_id === myId).map((property) => {
                    const level = property.building_level ?? 0;
                    const price = fields[property.field_id]?.price ?? 0;
                    const cost = Math.ceil(price * 0.5);
                    const buildingRefund = Math.floor(cost * 0.5);
                    const cityRefund = Math.floor(price * 0.5);
                    const canAfford = (gameState.balances?.[myId!] ?? 0) >= cost;
                    return (
                      <div key={property.field_id} className="rounded-xl border border-white/5 bg-white/5 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-white">
                              {fields[property.field_id]?.name ?? `Pole ${property.field_id}`}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {level === 5 ? "🏨 Hotel" : level === 0 ? "Bez budynków" : `🏠 ${level}/4 domków`}
                            </p>
                          </div>
                          <span className="text-xs font-bold text-amber-200">${price}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {level < 5 && (
                            <button type="button" onClick={() => buildProperty(property.field_id)}
                              disabled={busy || !canAfford}
                              className="rounded-lg bg-emerald-400 px-3 py-2 text-[11px] font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
                              {level === 4 ? `🏨 HOTEL −$${cost}` : `🏠 BUDUJ −$${cost}`}
                            </button>
                          )}
                          {level > 0 && (
                            <button type="button" onClick={() => sellBuilding(property.field_id)} disabled={busy}
                              className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] font-black text-rose-200 disabled:opacity-40">
                              💰 SPRZEDAJ BUDYNEK +${buildingRefund}
                            </button>
                          )}
                          {level === 0 && (
                            <button type="button" onClick={() => sellProperty(property.field_id)} disabled={busy}
                              className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] font-black text-amber-200 disabled:opacity-40">
                              🏙️ SPRZEDAJ MIASTO +${cityRefund}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mt-auto px-3 pt-3">
          <div className="rounded-2xl border border-white/10 bg-[#172235] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Aktualny ruch</p><p className="truncate text-sm font-bold text-white">{myTurn ? "✨ Twoja kolej!" : `⏳ ${currentPlayer?.nickname ?? "Oczekiwanie"}`}</p></div>
              <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">{gameState.turn_phase === "roll" ? "RZUT" : "DECYZJA"}</span>
            </div>
            {error && <p role="alert" className="mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 p-2 text-center text-xs text-rose-300">{error}</p>}
            {gameState.turn_phase === "roll" ? (
              <button onClick={rollDice} disabled={!myTurn || busy} className="w-full rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 px-4 py-4 text-sm font-black tracking-wide text-[#172033] shadow-[0_6px_20px_rgba(245,158,11,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "🎲 RZUCANIE / RUCH PIONKA..." : "🎲 RZUĆ KOSTKAMI"}</button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-[#0f1a2b] p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pole {activePosition}</p>
                  <p className="mt-1 text-lg font-black text-white">{activeField?.name ?? "Nieznane pole"}</p>
                  {specialIds.has(activePosition) ? <p className="mt-1 text-xs text-slate-400">Pole specjalne — brak możliwości zakupu</p> : propertyOwner ? <p className="mt-1 text-xs text-slate-300">🏠 Właściciel: <span className="font-bold text-amber-200">{propertyOwnerPlayer?.nickname ?? "Gracz"}</span></p> : <><p className="mt-1 text-xl font-black text-emerald-300">${propertyPrice}</p><p className="mt-1 text-xs text-slate-400">Saldo: ${activeBalance.toLocaleString("en-US")}</p><button onClick={buyProperty} disabled={!myTurn || busy || activeBalance < propertyPrice} className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-3 py-3 font-black text-[#08251d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "PRZETWARZANIE..." : `🏠 KUP MIASTO ZA $${propertyPrice}`}</button></>}
                </div>
                <button onClick={finishTurn} disabled={!myTurn || busy || (gameState.balances?.[myId ?? ""] ?? 0) < 0} className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "KOŃCZENIE TURY..." : "⏭️ ZAKOŃCZ TURĘ"}</button>
                {myTurn && (gameState.balances?.[myId ?? ""] ?? 0) < 0 && (
                  <div className="space-y-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3">
                    <p className="text-xs text-rose-200">Masz ujemne saldo. Sprzedaj budynki lub miasta, aby spłacić dług. Możesz też ogłosić bankructwo.</p>
                    <button type="button" onClick={declareBankruptcy} disabled={busy}
                      className="w-full rounded-xl border border-rose-400/40 bg-rose-500/20 px-4 py-3 text-sm font-black text-rose-200 disabled:opacity-40">
                      💀 OGŁOŚ BANKRUCTWO
                    </button>
                  </div>
                )}
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
