"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import type { Player, Property, GameState, RoomStatus } from "@/src/features/game/types";
import { fields, cityPrices, specialIds, pawnIcon } from "@/src/features/game/config";
import { GameBoard } from "@/src/features/game/components/GameBoard";

type Auction = { id: string; room_id: string; field_id: number; seller_id: string; starting_price: number; highest_bid: number | null; highest_bidder: string | null; ends_at: string; status: string };

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
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [auctionBusy, setAuctionBusy] = useState(false);
  const settlementInFlight = useRef(false);
  const [settlementError, setSettlementError] = useState("");

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

  const loadAuction = useCallback(async () => {
    const { data, error: auctionError } = await supabase.from("game_auctions").select("id, room_id, field_id, seller_id, starting_price, highest_bid, highest_bidder, ends_at, status")
      .eq("room_id", roomId).eq("status", "active").order("ends_at", { ascending: false }).limit(1);
    if (auctionError) throw auctionError;
    setAuction((data?.[0] as Auction | undefined) ?? null);
  }, [roomId]);

  useEffect(() => {
    void loadAuction().catch((err) => setError(err.message));
    const channel = supabase.channel(`auction-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_auctions", filter: `room_id=eq.${roomId}` }, () => {
        void loadAuction().catch((err) => setError(err.message));
        void loadGame().catch((err) => setError(err.message));
      }).subscribe();
    // Polling działa również wtedy, gdy publikacja Realtime nie obejmuje tabeli aukcji.
    const poll = setInterval(() => { void loadAuction().catch(() => {}); }, 2500);
    return () => { clearInterval(poll); void supabase.removeChannel(channel); };
  }, [roomId, loadAuction, loadGame]);

  useEffect(() => {
    if (!auction) { setSecondsLeft(0); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(auction.ends_at).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [auction]);

  // Rozliczenie jest bezpieczne przy kilku otwartych klientach:
  // jeżeli inny klient już zakończył aukcję, odczytujemy jej stan zamiast
  // pokazywać fałszywy błąd.
  const settleAuction = useCallback(async () => {
    if (!auction || !myId || settlementInFlight.current) return;
    const auctionId = auction.id;
    if (Date.now() < new Date(auction.ends_at).getTime()) return;
    settlementInFlight.current = true;
    setAuctionBusy(true);
    setSettlementError("");
    try {
      const { data: before, error: beforeError } = await supabase
        .from("game_auctions").select("status").eq("id", auctionId).single();
      if (beforeError) throw beforeError;
      if (before?.status === "active") {
        const { error: rpcError } = await supabase.rpc("settle_game_auction", { p_auction_id: auctionId });
        if (rpcError) {
          // Przy dwóch graczach drugi RPC może dostać błąd, choć pierwszy
          // zdążył już poprawnie zakończyć tę samą aukcję.
          const { data: after, error: afterError } = await supabase
            .from("game_auctions").select("status").eq("id", auctionId).single();
          if (afterError) throw afterError;
          if (after?.status === "active") throw rpcError;
        }
      }
      await Promise.all([loadAuction(), loadGame()]);
      setError("");
      setSettlementError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nie udało się rozliczyć aukcji.";
      setSettlementError(message);
      setError(message);
    } finally {
      settlementInFlight.current = false;
      setAuctionBusy(false);
    }
  }, [auction, myId, loadAuction, loadGame]);

  // secondsLeft zaczyna od zera, zanim timer zdąży się zainicjalizować.
  // Sprawdzamy więc również prawdziwy czas zakończenia z bazy.
  useEffect(() => {
    if (!auction || secondsLeft > 0 || auctionBusy || !myId || settlementError) return;
    if (Date.now() < new Date(auction.ends_at).getTime()) return;
    void settleAuction();
  }, [auction, secondsLeft, auctionBusy, myId, settlementError, settleAuction]);

  useEffect(() => {
    setSettlementError("");
  }, [auction?.id]);

  async function startAuction(fieldId: number) {
    if (auction || auctionBusy) return;
    const value = window.prompt("Cena wywoławcza (minimum $10):", String(fields[fieldId]?.price ?? 10));
    if (value === null) return;
    const price = Number(value);
    if (!Number.isSafeInteger(price) || price < 10) { setError("Podaj poprawną cenę (minimum $10)."); return; }
    setAuctionBusy(true); setError(""); setSettlementError("");
    try {
      const { error: rpcError } = await supabase.rpc("start_game_auction", { p_room_id: roomId, p_field_id: fieldId, p_starting_price: price });
      if (rpcError) throw rpcError;
      setSelectedFieldId(null);
      await loadAuction();
    } catch (err) { setError(err instanceof Error ? err.message : "Nie udało się rozpocząć aukcji."); }
    finally { setAuctionBusy(false); }
  }

  async function bidAuction(increment: number) {
    if (!auction || auctionBusy) return;
    const amount = auction.highest_bid === null ? auction.starting_price : auction.highest_bid + increment;
    setAuctionBusy(true); setError("");
    try {
      const { error: rpcError } = await supabase.rpc("place_game_auction_bid", { p_auction_id: auction.id, p_amount: amount });
      if (rpcError) throw rpcError;
      await loadAuction();
    } catch (err) { setError(err instanceof Error ? err.message : "Nie udało się złożyć oferty."); }
    finally { setAuctionBusy(false); }
  }

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
  const selectedProperty = properties.find((p) => p.field_id === selectedFieldId);
  const selectedField = selectedFieldId !== null ? fields[selectedFieldId] : undefined;
  const selectedOwner = players.find((p) => p.player_id === selectedProperty?.owner_id);
  const isMySelectedProperty = !!myId && selectedProperty?.owner_id === myId;
  const canManageSelected = isMySelectedProperty && myTurn && gameState.turn_phase === "decision" && !busy;



  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e3050_0%,#0b1220_52%,#080d17_100%)] text-white">
      <style>{`@keyframes bankrollDiceSpin { 0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 100% { transform: rotateX(1080deg) rotateY(1440deg) rotateZ(360deg); } } .bankroll-dice-spin { animation: bankrollDiceSpin 850ms linear infinite; } @keyframes bankrollPawnHop { 0% { transform: translateY(3px) scale(.9) rotate(-8deg); } 45% { transform: translateY(-8px) scale(1.14) rotate(5deg); } 100% { transform: translateY(0) scale(1); } } .bankroll-pawn-hop { animation: bankrollPawnHop 290ms ease-out; }`}</style>
      <div className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col border-x border-white/5 bg-[#0d1626]/80 pb-4 shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/80">Polska edycja</p>
            <h1 className="text-lg font-black tracking-tight">CITY <span className="text-amber-300">ROLL</span></h1>
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

        <div className="grid grid-cols-2 gap-1.5 px-2 py-2">{players.map((p) => (
          <div key={p.player_id} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 ${p.player_id === gameState.current_turn ? "border-amber-300/60 bg-amber-300/10" : "border-white/10 bg-white/5"}`}>
            <span className="shrink-0 text-lg">{pawnIcon(p.pawn_id)}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{p.nickname}{p.player_id === myId ? " (Ty)" : ""}</p><p className="text-[11px] font-extrabold text-emerald-300">${(gameState.balances?.[p.player_id] ?? 0).toLocaleString("en-US")}</p></div>
            {p.is_bankrupt && <span className="text-[10px] text-rose-300">💀</span>}
          </div>
        ))}</div>

        <GameBoard players={players} properties={properties} gameState={gameState} animatedPositions={animatedPositions} currentPlayer={currentPlayer} activePosition={activePosition} diceRolling={diceRolling} hasDice={hasDice} onSelectProperty={setSelectedFieldId} />
        {auction && (
          <section className="mx-3 mt-3 rounded-2xl border border-amber-300/40 bg-[#172235] p-4 shadow-xl" aria-live="polite">
            <div className="flex items-center justify-between"><h3 className="font-black text-amber-200">🔨 AUKCJA NA ŻYWO</h3><span className="font-black text-xl text-white">{secondsLeft}s</span></div>
            <p className="mt-2 text-sm font-bold">{fields[auction.field_id]?.name ?? `Pole ${auction.field_id}`}</p>
            <p className="mt-1 text-xs text-slate-300">Sprzedaje: {players.find(p => p.player_id === auction.seller_id)?.nickname ?? "Gracz"}</p>
            <p className="mt-2 text-2xl font-black text-amber-300">${auction.highest_bid ?? auction.starting_price}</p>
            <p className="text-xs text-slate-300">{auction.highest_bidder ? `Prowadzi: ${players.find(p => p.player_id === auction.highest_bidder)?.nickname ?? "Gracz"}` : "Brak ofert — pierwsza oferta = cena wywoławcza"}</p>
            {myId && myId !== auction.seller_id && !players.find(p => p.player_id === myId)?.is_bankrupt && secondsLeft > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(auction.highest_bid === null ? [0] : [10, 25, 50]).map(step => (
                  <button key={step} type="button" disabled={auctionBusy || auction.highest_bidder === myId || (gameState?.balances?.[myId] ?? 0) < (auction.highest_bid === null ? auction.starting_price : auction.highest_bid + step)} onClick={() => void bidAuction(step)} className="rounded-xl bg-amber-300 px-2 py-3 text-xs font-black text-slate-950 disabled:opacity-40">
                    {step === 0 ? `Licytuj $${auction.starting_price}` : `+$${step}`}
                  </button>
                ))}
              </div>
            )}
            {settlementError && <p role="alert" className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-xs text-rose-200">Błąd rozliczenia: {settlementError}</p>}
            {secondsLeft === 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-300">{auctionBusy ? "Trwa rozliczanie aukcji…" : "Czas aukcji upłynął."}</p>
                {settlementError && <button type="button" disabled={auctionBusy} onClick={() => void settleAuction()} className="w-full rounded-xl bg-amber-300 px-3 py-3 text-xs font-black text-slate-950 disabled:opacity-40">Ponów rozliczenie aukcji</button>}
              </div>
            )}
          </section>
        )}
        {selectedProperty && selectedField && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setSelectedFieldId(null)}>
            <section role="dialog" aria-modal="true" aria-label={`Nieruchomość ${selectedField.name}`} onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-amber-300/25 bg-[#172235] p-5 text-white shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Nieruchomość</p><h3 className="mt-1 text-xl font-black">{selectedField.name}</h3></div>
                <button type="button" onClick={() => setSelectedFieldId(null)} className="rounded-lg bg-white/10 px-3 py-1 text-lg" aria-label="Zamknij">×</button>
              </div>
              <p className="mt-3 text-sm text-slate-300">Właściciel: {selectedOwner?.nickname ?? "Nieznany"} {selectedOwner ? "• " + selectedOwner.color : ""}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Cena zakupu</p><strong className="text-amber-200">${selectedField.price ?? 0}</strong></div>
                <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Zabudowa</p><strong>{selectedProperty.building_level === 5 ? "Hotel" : `${selectedProperty.building_level} / 4 domków`}</strong></div>
              </div>
              {isMySelectedProperty ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-slate-400">Zarządzanie nieruchomością jest dostępne podczas Twojej fazy decyzji.</p>
                  {selectedProperty.building_level > 0 && <button type="button" disabled={!canManageSelected} onClick={async () => { await sellBuilding(selectedProperty.field_id); }} className="w-full rounded-xl bg-rose-400/15 px-3 py-3 text-sm font-bold text-rose-200 disabled:opacity-40">💰 Sprzedaj budynek</button>}
                  {selectedProperty.building_level === 0 && <button type="button" disabled={!canManageSelected} onClick={async () => { await sellProperty(selectedProperty.field_id); setSelectedFieldId(null); }} className="w-full rounded-xl bg-amber-300 px-3 py-3 text-sm font-black text-[#172033] disabled:opacity-40">💰 Sprzedaj do banku</button>}
                  <button type="button" disabled={!canManageSelected || selectedProperty.building_level !== 0 || !!auction || auctionBusy} onClick={() => void startAuction(selectedProperty.field_id)} className="w-full rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 text-sm font-bold text-amber-200 disabled:opacity-40">🔨 Wystaw na aukcję</button>
                </div>
              ) : <p className="mt-4 text-xs text-slate-400">Możesz oglądać nieruchomość, ale zarządzać nią może tylko właściciel.</p>}
            </section>
          </div>
        )}

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
                  {specialIds.has(activePosition) ? <p className="mt-1 text-xs text-slate-400">Pole specjalne — brak możliwości zakupu</p> : propertyOwner ? <p className="mt-1 text-xs text-slate-300">🏠 Właściciel: <span className="font-bold text-amber-200">{propertyOwnerPlayer?.nickname ?? "Gracz"}</span></p> : <><p className="mt-1 text-xl font-black text-emerald-300">${propertyPrice}</p><p className="mt-1 text-xs text-slate-400">Saldo: ${activeBalance.toLocaleString("en-US")}</p><button onClick={buyProperty} disabled={!myTurn || busy || !!auction || activeBalance < propertyPrice} className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-3 py-3 font-black text-[#08251d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "PRZETWARZANIE..." : `🏠 KUP MIASTO ZA $${propertyPrice}`}</button></>}
                </div>
                <button onClick={finishTurn} disabled={!myTurn || busy || !!auction || (gameState.balances?.[myId ?? ""] ?? 0) < 0} className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "KOŃCZENIE TURY..." : "⏭️ ZAKOŃCZ TURĘ"}</button>
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
