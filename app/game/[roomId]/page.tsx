"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";
import type { Player, Property, GameState, RoomStatus } from "@/src/features/game/types";
import { fields, cityPrices, specialIds, pawnIcon } from "@/src/features/game/config";
import { GameBoard } from "@/src/features/game/components/GameBoard";
import { playGameSound, setGameSoundsMuted } from "@/src/features/game/gameSounds";
import { getCityEconomy } from "@/src/features/game/cityEconomy";
import { useGameEvents } from "@/src/features/game/useGameEvents";
import type { GameEvent as DisplayGameEvent, GameEventType } from "@/src/features/game/gameEvents";
import { useAutoDice } from "@/src/features/game/useAutoDice";

type JailState = { player_id: string; turns_remaining: number; bail_locked: boolean };
type ChanceNotice = { id: number; player_id: string; card_id: number; title: string; description: string; kind: string; value: number; amount?: number; new_position?: number; rent?: number };

type Auction = { id: string; room_id: string; field_id: number; seller_id: string; starting_price: number; highest_bid: number | null; highest_bidder: string | null; ends_at: string; status: string };

// Grupy kolorystyczne zgodne z regułami build_game_property w Supabase.
const buildColorGroups: number[][] = [
  [1, 2], [3, 5, 6], [8, 9], [10, 12, 13],
  [15, 16], [17, 19, 20], [22, 23], [24, 26, 27],
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const turnTips = [
  "🏠 Przed rzutem możesz zarządzać swoimi nieruchomościami. Kliknij miasto na planszy, aby budować, sprzedawać lub wystawić je na aukcję. Po rzucie sprzedaż jest możliwa wyłącznie przy zadłużeniu.",
  "💰 Zachowaj rezerwę gotówki — po rzucie możesz trafić na miasto przeciwnika i zapłacić czynsz.",
  "🏘️ Zbierz wszystkie miasta jednego koloru, aby odblokować możliwość budowania domków.",
  "🏠 Każdy kolejny domek podnosi czynsz. Sprawdź cennik miasta przed inwestycją.",
  "💸 Sprzedaż domku pozwala odzyskać 75% kosztu jego budowy. To sposób na zdobycie gotówki.",
  "🏙️ Za sprzedaż miasta do banku odzyskasz 80% jego ceny zakupu. Najpierw sprzedaj wszystkie domki.",
  "🔨 Przed rzutem możesz wystawić własne niezabudowane miasto na aukcję.",
  "🎲 Sprawdź sześć kolejnych pól na planszy — na jednym z nich zakończysz ruch.",
  "👀 Obserwuj zabudowę rywali. Czynsz za miasto z trzema domkami może być bardzo wysoki.",
  "⚖️ Nie zawsze opłaca się budować od razu. Porównaj koszt domku ze wzrostem czynszu.",
];

// Wskazówka jest stała w obrębie tury, również przy odświeżaniu danych.
function getTurnTip(turnNumber: number, playerId: string | null) {
  let hash = Math.imul(turnNumber, 2654435761) >>> 0;
  for (const char of playerId ?? "") {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  }
  return turnTips[hash % turnTips.length];
}


function GameContent() {
  const params = useParams();
  const roomId = String(params.roomId);
  const latestGameEvent = useGameEvents(roomId);
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [jailStates, setJailStates] = useState<JailState[]>([]);
  const [turnClock, setTurnClock] = useState<{ deadline_at: string; turn_number: number; player_id: string | null } | null>(null);
  const [turnSeconds, setTurnSeconds] = useState(60);

  const [chanceNotice, setChanceNotice] = useState<ChanceNotice | null>(null);
  const lastCardId = useRef<number>(0);
  const cardsInitialized = useRef(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [soundsMuted, setSoundsMuted] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("city-roll-sounds-muted") === "1";
    setSoundsMuted(saved);
    setGameSoundsMuted(saved);
  }, []);
  const toggleSounds = () => {
    const next = !soundsMuted;
    setSoundsMuted(next);
    setGameSoundsMuted(next);
    window.localStorage.setItem("city-roll-sounds-muted", next ? "1" : "0");
  };
  const [diceRolling, setDiceRolling] = useState(false);
  const [manualDiceAnimating, setManualDiceAnimating] = useState(false);
  const [manualRolledValue, setManualRolledValue] = useState<number | null>(null);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, number>>({});

  const [error, setError] = useState("");
  const [declinedPurchaseKey, setDeclinedPurchaseKey] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [auctionBusy, setAuctionBusy] = useState(false);
  const [auctionStartFieldId, setAuctionStartFieldId] = useState<number | null>(null);
  const [auctionStartPrice, setAuctionStartPrice] = useState("100");
  const [auctionStartError, setAuctionStartError] = useState("");
  const settlementInFlight = useRef(false);
  const [settlementError, setSettlementError] = useState("");
  const [saleNotice, setSaleNotice] = useState<{ id: number; player_id: string; field_id: number; amount: number; created_at: string; event_type: "property_sale" | "building_sale" } | null>(null);
  const lastNoticeId = useRef<number>(0);
  const autoFinishInFlight = useRef(false);
  const [confirmation, setConfirmation] = useState<{ type: "sell"; fieldId: number; price: number } | { type: "bankruptcy" } | null>(null);

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

  const {
    autoDiceRolling,
    autoDiceAnimating,
    autoRolledValue,
    autoIdleNotice,
  } = useAutoDice({
    roomId,
    enabled: roomStatus?.status === "playing",
    players,
    manualRolling: diceRolling,
    onGameChanged: loadGame,
  });

  // Licznik tury pobierany z Supabase; odświeżenie strony nie resetuje czasu.
  const loadTurnClock = useCallback(async () => {
    const { data, error: clockError } = await supabase.from("city_roll_turn_clock")
      .select("deadline_at,turn_number,player_id")
      .eq("room_id", roomId).maybeSingle();
    if (clockError) throw clockError;
    setTurnClock(data);
  }, [roomId]);

  useEffect(() => {
    void loadTurnClock().catch(() => {});
    const poll = setInterval(() => { void loadTurnClock().catch(() => {}); }, 1200);
    return () => clearInterval(poll);
  }, [loadTurnClock]);

  useEffect(() => {
    const tick = () => {
      if (!turnClock) return;
      setTurnSeconds(Math.max(0, Math.ceil((new Date(turnClock.deadline_at).getTime() - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [turnClock]);

  const loadCardsAndJail = useCallback(async () => {
    const [jailResult, cardResult] = await Promise.all([
      supabase.from("city_roll_jail").select("player_id, turns_remaining, bail_locked").eq("room_id", roomId),
      supabase.from("city_roll_card_history")
        .select("id, player_id, card_id, result, city_roll_cards(title, description, kind, value)")
        .eq("room_id", roomId).order("id", { ascending: false }).limit(8),
    ]);
    if (jailResult.error) throw jailResult.error;
    if (cardResult.error) throw cardResult.error;
    setJailStates((jailResult.data ?? []) as JailState[]);
    const feed: ChanceNotice[] = (cardResult.data ?? []).flatMap((item) => {
      const rawCard = item.city_roll_cards;
      const card = (Array.isArray(rawCard) ? rawCard[0] : rawCard) as
        { title: string; description: string; kind: string; value: number } | null;
      if (!card) return [];
      const result = item.result as { title?: string; description?: string; kind?: string;
        amount?: number; new_position?: number; rent?: number } | null;
      return [{ id: item.id, player_id: item.player_id, card_id: item.card_id,
        ...card, ...(result ?? {}) }];
    });
    const latest = feed[0];
    if (!cardsInitialized.current) {
      lastCardId.current = latest?.id ?? 0;
      cardsInitialized.current = true;
    } else if (latest && latest.id > lastCardId.current) {
      lastCardId.current = latest.id;
      setChanceNotice(latest);
    }
  }, [roomId]);

  useEffect(() => {
    void loadCardsAndJail().catch((err) => setError(err.message));
    const poll = setInterval(() => { void loadCardsAndJail().catch(() => {}); }, 1800);
    return () => clearInterval(poll);
  }, [loadCardsAndJail]);

  useEffect(() => {
    if (!chanceNotice) return;
    const timer = setTimeout(() => setChanceNotice((current) => current?.id === chanceNotice.id ? null : current), 6000);
    return () => clearTimeout(timer);
  }, [chanceNotice]);

  async function jailAction(action: "pay" | "skip") {
    if (!myId || !gameState || busy || diceRolling || auction || auctionBusy ||
        gameState.current_turn !== myId || gameState.turn_phase !== "roll") return;
    if (action === "pay" && jailStates.find(j => j.player_id === myId)?.bail_locked) {
      setError("Po wybraniu odsiadki nie możesz już zapłacić kaucji. Musisz odsiedzieć pozostałe kolejki.");
      return;
    }
    setBusy(true); setError("");
    try {
      const rpc = action === "pay" ? "city_roll_pay_jail" : "city_roll_skip_jail_turn";
      const { error: rpcError } = await supabase.rpc(rpc, { p_room_id: roomId });
      if (rpcError) throw rpcError;
      await Promise.all([loadGame(), loadCardsAndJail()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wykonać akcji więzienia.");
    } finally { setBusy(false); }
  }

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
    let mounted = true;
    const loadSales = async () => {
      const { data, error: saleError } = await supabase.from("game_sale_events")
        .select("id, player_id, field_id, amount, created_at, event_type")
        .eq("room_id", roomId).order("id", { ascending: false }).limit(1);
      if (saleError || !mounted || !data?.length) return;
      const item = data[0];
      if (item.id > lastNoticeId.current) {
        lastNoticeId.current = item.id;
        setSaleNotice(item);
      }
    };
    void loadSales();
    const channel = supabase.channel(`sales-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_sale_events", filter: `room_id=eq.${roomId}` }, () => { void loadSales(); })
      .subscribe();
    // Realtime może nie być włączony; polling pozostaje zapasowym mechanizmem.
    const poll = setInterval(() => { void loadSales(); }, 1500);
    return () => { mounted = false; clearInterval(poll); void supabase.removeChannel(channel); };
  }, [roomId]);

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

  function openAuctionStart(fieldId: number) {
    if (auction || auctionBusy || !myTurn || gameState?.turn_phase !== "roll" || diceRolling) return;
    setAuctionStartFieldId(fieldId);
    setAuctionStartPrice(String(fields[fieldId]?.price ?? 10));
    setAuctionStartError("");
  }

  async function startAuction() {
    if (auctionStartFieldId === null || auction || auctionBusy || !myTurn || gameState?.turn_phase !== "roll" || diceRolling) return;
    const fieldId = auctionStartFieldId;
    const price = Number(auctionStartPrice);
    if (!Number.isSafeInteger(price) || price < 10) {
      setAuctionStartError("Podaj pełną kwotę w dolarach, minimum $10.");
      return;
    }
    setAuctionBusy(true); setError(""); setAuctionStartError(""); setSettlementError("");
    try {
      const { error: rpcError } = await supabase.rpc("start_game_auction", { p_room_id: roomId, p_field_id: fieldId, p_starting_price: price });
      if (rpcError) throw rpcError;
      setAuctionStartFieldId(null);
      setSelectedFieldId(null);
      await loadAuction();
    } catch (err) {
      setAuctionStartError(err instanceof Error ? err.message : "Nie udało się rozpocząć aukcji.");
    } finally {
      setAuctionBusy(false);
    }
  }

  async function respondToDuelAuction(accept: boolean) {
    if (!auction || auctionBusy || !myId) return;
    setAuctionBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("respond_game_auction_duel", {
        p_auction_id: auction.id,
        p_accept: accept,
      });
      if (rpcError) throw rpcError;
      await Promise.all([loadAuction(), loadGame()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się odpowiedzieć na ofertę.");
    } finally {
      setAuctionBusy(false);
    }
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

  // Kończymy turę automatycznie, gdy po rzucie nie ma decyzji do podjęcia.
  // Przy ujemnym saldzie zostawiamy czas na dobrowolną sprzedaż majątku.
  useEffect(() => {
    if (!myId || !gameState || busy || diceRolling || auction || auctionBusy ||
        auctionStartFieldId !== null || roomStatus?.status === "finished" ||
        gameState.current_turn !== myId || gameState.turn_phase !== "decision" ||
        autoFinishInFlight.current) return;

    const balance = Number(gameState.balances?.[myId] ?? 0);
    if (balance < 0) return;

    const position = gameState.positions?.[myId] ?? 0;
    const freeCity = !specialIds.has(position) && cityPrices[position] != null &&
      !properties.some((property) => property.field_id === position);
    const key = `${gameState.turn_number}:${gameState.current_turn}:${position}`;
    const canBuy = freeCity && balance >= (cityPrices[position] ?? Infinity) && declinedPurchaseKey !== key;
    if (canBuy) return;

    const timer = setTimeout(async () => {
      if (autoFinishInFlight.current) return;
      autoFinishInFlight.current = true;
      setBusy(true);
      try {
        const { error: rpcError } = await supabase.rpc("finish_game_turn", { p_room_id: roomId });
        if (rpcError) throw rpcError;
        await loadGame();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Nie udało się automatycznie zakończyć tury.");
      } finally {
        autoFinishInFlight.current = false;
        setBusy(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [myId, gameState, properties, busy, diceRolling, auction, auctionBusy,
      auctionStartFieldId, roomStatus?.status, declinedPurchaseKey, roomId, loadGame]);

  async function rollDice() {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (auction || auctionBusy || auctionStartFieldId !== null) {
      setError("Najpierw zakończ aktywną aukcję."); return;
    }
    if (gameState.current_turn !== myId || gameState.turn_phase !== "roll") {
      setError("Teraz nie możesz rzucić kostkami."); return;
    }

    if (jailStates.some((j) => j.player_id === myId && j.turns_remaining > 0)) {
      setError("Jesteś w więzieniu. Zapłać $150 albo odsiedź kolejkę."); return;
    }
    const playerId = myId;
    const movingPawnId = players.find((p) => p.player_id === playerId)?.pawn_id ?? 0;
    const previousCardId = lastCardId.current;
    const startPosition = gameState.positions?.[playerId] ?? 0;
    const startedAt = Date.now();
    const diceSound = new Audio("/sounds/dice-roll.wav");
    diceSound.volume = 0.7;
    void diceSound.play().catch(() => {});

    setSaleNotice(null);
    setBusy(true);
    setDiceRolling(true);
    setManualDiceAnimating(true);
    setManualRolledValue(null);
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
      if (!Number.isInteger(first) || first < 1 || first > 6) {
        throw new Error("Nie udało się odczytać wyniku kostek.");
      }
      setManualRolledValue(first);
      const steps = first;
      const diceLanding = (startPosition + steps) % 28;
      const serverFinal = Number(rolledState.positions?.[playerId] ?? diceLanding);
      // Co najmniej 900 ms animacji rzutu, nawet jeśli baza odpowie błyskawicznie.
      await wait(Math.max(0, 900 - (Date.now() - startedAt)));
      setManualDiceAnimating(false);
      await loadGame();
      // Trzymaj blokadę decyzji do zakończenia animacji pionka.
      await wait(350);

      for (let step = 1; step <= steps; step++) {
        setAnimatedPositions((previous) => ({ ...previous, [playerId]: (startPosition + step) % 28 }));
        playGameSound("move", movingPawnId);
        await wait(290);
      }
      // Efekt karty wykonany przez serwer po wejściu na pole 7 lub 21.
      if ((diceLanding === 7 || diceLanding === 21) && serverFinal !== diceLanding) {
        const { data: cardRows } = await supabase.from("city_roll_card_history")
          .select("id, card_id, city_roll_cards(kind)")
          .eq("room_id", roomId).eq("player_id", playerId)
          .gt("id", previousCardId).order("id", { ascending: false }).limit(1);
        const cardRow = cardRows?.[0];
        const cardRaw = cardRow?.city_roll_cards;
        const kind = (Array.isArray(cardRaw) ? cardRaw[0] : cardRaw)?.kind;
        if (kind === "forward" || kind === "backward") {
          const direction = kind === "forward" ? 1 : -1;
          let current = diceLanding;
          for (let i = 0; i < 6 && current !== serverFinal; i++) {
            current = (current + direction + 28) % 28;
            setAnimatedPositions((previous) => ({ ...previous, [playerId]: current }));
            playGameSound("move", movingPawnId);
            await wait(290);
          }
        } else {
          // Teleportacja i więzienie: bez sztucznego przechodzenia przez pola.
          setAnimatedPositions((previous) => ({ ...previous, [playerId]: serverFinal }));
          await wait(450);
        }
      }
      await loadCardsAndJail();
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
      setManualDiceAnimating(false);
      setManualRolledValue(null);
      setDiceRolling(false);
      setBusy(false);
    }
  }

  async function finishTurn() {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision") {
      setError("Nie możesz teraz zakończyć tury."); return;
    }
    if ((gameState.balances?.[myId] ?? 0) <= -500) {
      setError("Osiągnąłeś limit debetu -$500. Sprzedaj majątek albo ogłoś bankructwo."); return;
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
      playGameSound("buy");
      await loadGame();
    } catch (err) { setError(err instanceof Error ? err.message : "Nie udało się kupić nieruchomości."); }
    finally { setBusy(false); }
  }

  async function buildProperty(fieldId: number) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "roll") {
      setError("Możesz budować tylko przed rzutem kostkami.");
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
      playGameSound("build");
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się rozbudować miasta.");
    } finally {
      setBusy(false);
    }
  }

  async function sellBuilding(fieldId: number) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (!canSellAssets) {
      setError("Sprzedaż możliwa przed rzutem lub po rzucie przy ujemnym saldzie.");
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
      playGameSound("sell");
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się sprzedać budynku.");
    } finally {
      setBusy(false);
    }
  }

  async function sellProperty(fieldId: number, confirmed = false) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (!canSellAssets) {
      setError("Sprzedaż możliwa przed rzutem lub po rzucie przy ujemnym saldzie.");
      return;
    }
    const property = properties.find((p) => p.field_id === fieldId);
    if (!property || property.owner_id !== myId) {
      setError("To nie jest Twoje miasto.");
      return;
    }
    if ((property.building_level ?? 0) > 0) {
      setError("Najpierw sprzedaj budynki.");
      return;
    }
    const city = fields[fieldId];
    if (!city || city.price === null) return;
   
const economy = getCityEconomy(fieldId);

const sellPrice = economy
  ? economy.sellPrice
  : Math.floor(city.price * 0.5);

if (!confirmed) {
  setConfirmation({ type: "sell", fieldId, price: sellPrice });
  return;
}

    setConfirmation(null);
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("sell_game_property", {
        p_room_id: roomId,
        p_field_id: fieldId,
      });
      if (rpcError) throw rpcError;
      playGameSound("sell");
      await loadGame();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się sprzedać miasta.");
    } finally {
      setBusy(false);
    }
  }

  async function declareBankruptcy(confirmed = false) {
    if (!myId || !gameState || busy || roomStatus?.status === "finished") return;
    if (gameState.current_turn !== myId || gameState.turn_phase !== "decision" ||
        (gameState.balances?.[myId] ?? 0) > -500) {
      setError("Bankructwo można ogłosić przy saldzie -$500 lub niższym.");
      return;
    }
    if (!confirmed) {
      setConfirmation({ type: "bankruptcy" });
      return;
    }
    setConfirmation(null);
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

  const activePlayerCount = players.filter((p) => !p.is_bankrupt).length;
  const duelAuction = activePlayerCount === 2;
  const gameFinished = roomStatus?.status === "finished";
  const winner = players.find((p) => p.player_id === roomStatus?.winner_id);
  const myJailState = jailStates.find((j) => j.player_id === myId);
  const myJailTurns = myJailState?.turns_remaining ?? 0;
  const myBailLocked = myJailState?.bail_locked === true;
  const myTurn = !gameFinished && !!myId && gameState.current_turn === myId && !players.find((p) => p.player_id === myId)?.is_bankrupt;
  const myBalance = myId ? Number(gameState.balances?.[myId] ?? 0) : 0;
  const auctionBlocked = !!auction || auctionBusy || auctionStartFieldId !== null;
  const canSellAssets = myTurn && !busy && !diceRolling && !auctionBlocked &&
    (gameState.turn_phase === "roll" ||
      (gameState.turn_phase === "decision" && myBalance < 0));
  const canDeclareBankruptcy = myTurn && !busy && !auctionBlocked &&
    gameState.turn_phase === "decision" && myBalance <= -500;
  const netWorthByPlayer: Record<string, number> = {};
  for (const player of players) {
    const cash = Number(gameState.balances?.[player.player_id] ?? 0);
    const assetValue = properties
      .filter((property) => property.owner_id === player.player_id)
      .reduce((sum, property) => {
        const purchasePrice = Number(cityPrices[property.field_id] ?? 0);
        const buildingCost = Number(getCityEconomy(property.field_id)?.buildingCost ?? 0);
        return sum + purchasePrice + Math.max(0, property.building_level ?? 0) * buildingCost;
      }, 0);
    netWorthByPlayer[player.player_id] = cash + assetValue;
  }
  const knownEventTypes: GameEventType[] = ["property_purchase", "auction_bid", "auction_won", "auction_no_sale", "building_built", "building_sale", "property_sale", "rent_paid", "chance_card"];
  const eventActor = players.find(p => p.player_id === latestGameEvent?.player_id);
  const boardGameEvent: DisplayGameEvent | null = latestGameEvent && knownEventTypes.includes(latestGameEvent.event_type as GameEventType)
    ? {
        id: String(latestGameEvent.id),
        roomId,
        type: latestGameEvent.event_type as GameEventType,
        actorId: latestGameEvent.player_id,
        actorName: eventActor?.nickname ?? "Gracz",
        fieldId: latestGameEvent.field_id,
        fieldName: latestGameEvent.field_id != null ? (fields[latestGameEvent.field_id]?.name ?? `Pole ${latestGameEvent.field_id}`) : null,
        amount: latestGameEvent.amount,
        recipientName: latestGameEvent.event_type === "rent_paid"
          ? (players.find(p => p.player_id === latestGameEvent.description)?.nickname ?? "właścicielowi")
          : null,
        cardText: latestGameEvent.event_type === "chance_card" ? latestGameEvent.description : null,
        createdAt: latestGameEvent.created_at,
      }
    : null;
  const currentPlayer = players.find((p) => p.player_id === gameState.current_turn);
  const activePosition = gameState.current_turn ? gameState.positions?.[gameState.current_turn] ?? 0 : 0;
  const activeField = fields[activePosition];
  const propertyOwner = properties.find((p) => p.field_id === activePosition);
  const propertyOwnerPlayer = players.find((p) => p.player_id === propertyOwner?.owner_id);
  const propertyPrice = cityPrices[activePosition] ?? 0;
  const activeBalance = gameState.current_turn ? gameState.balances?.[gameState.current_turn] ?? 0 : 0;
  const hasDice = gameState.dice_1 !== null;
  const selectedProperty = properties.find((p) => p.field_id === selectedFieldId);
  const selectedField = selectedFieldId !== null ? fields[selectedFieldId] : undefined;
  const selectedOwner = players.find((p) => p.player_id === selectedProperty?.owner_id);
  const isMySelectedProperty = !!myId && selectedProperty?.owner_id === myId;
  const purchaseKey = `${gameState.turn_number}:${gameState.current_turn}:${activePosition}`;
  const showPurchasePrompt = myTurn && gameState.turn_phase === "decision" && !diceRolling && !busy &&
    !specialIds.has(activePosition) && cityPrices[activePosition] != null &&
    !propertyOwner && activeBalance >= propertyPrice && declinedPurchaseKey !== purchaseKey;
  const awaitingChoice = showPurchasePrompt || (myTurn && gameState.turn_phase === "decision" && myBalance < 0);
  const autoCompletingTurn = myTurn && gameState.turn_phase === "decision" && !awaitingChoice;
  const canManageSelected = isMySelectedProperty && myTurn && myJailTurns === 0 && gameState.turn_phase === "roll" && !busy && !diceRolling && !auctionBlocked;
  const canSellSelected = isMySelectedProperty && canSellAssets;
  const selectedColorGroup = selectedFieldId === null
    ? undefined
    : buildColorGroups.find((group) => group.includes(selectedFieldId));
  const missingColorFields = selectedColorGroup?.filter((fieldId) =>
    !properties.some((property) => property.field_id === fieldId && property.owner_id === myId)
  ) ?? [];
  const hasFullColorGroup = !!selectedColorGroup && missingColorFields.length === 0;
  const isBuildableCity = !!selectedColorGroup;
  const selectedEconomy = selectedFieldId !== null ? getCityEconomy(selectedFieldId) : null;
  const utilityIds = [4, 11, 18, 25];
  const isSelectedUtility = selectedFieldId !== null && utilityIds.includes(selectedFieldId);
  const selectedUtilityCount = selectedProperty ? properties.filter((property) =>
    utilityIds.includes(property.field_id) && property.owner_id === selectedProperty.owner_id
  ).length : 0;
  const selectedUtilityRent = selectedUtilityCount * 40;
  const selectedLevel = Math.max(0, Math.min(3, selectedProperty?.building_level ?? 0));
  const selectedBuildCost = selectedEconomy?.buildingCost ?? 0;
  const canBuildSelected = canManageSelected && hasFullColorGroup &&
    !!selectedEconomy && !auction && !auctionBusy && selectedLevel < 3 &&
    (gameState.balances?.[myId ?? ""] ?? 0) >= selectedBuildCost;




  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e3050_0%,#0b1220_52%,#080d17_100%)] text-white">
      <style>{`@keyframes bankrollDiceSpin { 0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 100% { transform: rotateX(1080deg) rotateY(1440deg) rotateZ(360deg); } } .bankroll-dice-spin { animation: bankrollDiceSpin 850ms linear infinite; } @keyframes bankrollPawnHop { 0% { transform: translateY(3px) scale(.9) rotate(-8deg); } 45% { transform: translateY(-8px) scale(1.14) rotate(5deg); } 100% { transform: translateY(0) scale(1); } } .bankroll-pawn-hop { animation: bankrollPawnHop 290ms ease-out; }`}</style>
      <div className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col border-x border-white/5 bg-[#0d1626]/80 pb-4 shadow-2xl">
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-sm font-black leading-none tracking-tight">CITY <span className="text-amber-300">ROLL</span></h1>
            <span className="text-[8px] font-semibold uppercase tracking-wider text-amber-300/65">Polska edycja</span>
          </div>
          <div className="flex shrink-0 items-baseline gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1">
            <span className="text-[9px] uppercase text-slate-400">Tura</span>
            <span className="text-xs font-black leading-none text-amber-300">#{gameState.turn_number}</span>
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
                  <span className="font-bold">Majątek: ${(netWorthByPlayer[player.player_id] ?? 0).toLocaleString("en-US")}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-1 px-2 py-1">{players.map((p) => (
          <div key={p.player_id} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 ${p.player_id === gameState.current_turn ? "border-amber-300/60 bg-amber-300/10" : "border-white/10 bg-white/5"}`}>
            <span className="relative grid h-10 w-10 shrink-0 place-items-center" title={roomStatus?.status === "playing" && p.player_id === gameState.current_turn ? `Pozostało ${turnSeconds} sekund na ruch` : undefined}>
              {roomStatus?.status === "playing" && p.player_id === gameState.current_turn && turnClock?.player_id === p.player_id && turnClock.turn_number === gameState.turn_number && (
                <svg className="absolute inset-0 h-10 w-10 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="3" />
                  <circle cx="20" cy="20" r="17" fill="none" stroke={turnSeconds <= 10 ? "#fb7185" : turnSeconds <= 20 ? "#fbbf24" : "#34d399"} strokeWidth="3" strokeLinecap="round" strokeDasharray={2 * Math.PI * 17} strokeDashoffset={2 * Math.PI * 17 * (1 - Math.max(0, Math.min(60, turnSeconds)) / 60)} style={{ transition: "stroke-dashoffset 250ms linear, stroke 250ms ease" }} />
                </svg>
              )}
              <span className="relative z-10 text-lg leading-none">{pawnIcon(p.pawn_id)}</span>
            </span>
            <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{p.nickname}{p.player_id === myId ? " (Ty)" : ""}</p>
            <p className="text-[10px] font-extrabold text-emerald-300">Gotówka: ${(gameState.balances?.[p.player_id] ?? 0).toLocaleString("en-US")}</p><p className="text-[10px] font-bold text-amber-200">Majątek: ${(netWorthByPlayer[p.player_id] ?? 0).toLocaleString("en-US")} / $7,000</p><div className="mt-1 h-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-amber-300" style={{ width: `${Math.max(0, Math.min(100, ((netWorthByPlayer[p.player_id] ?? 0) / 7000) * 100))}%` }} /></div></div>
            {p.is_bankrupt && <span className="text-[10px] text-rose-300">💀</span>}
          </div>
        ))}</div>

        <div className="relative">
          <div className="mb-2 flex justify-end"><button type="button" onClick={toggleSounds} aria-label={soundsMuted ? "Włącz dźwięki gry" : "Wycisz dźwięki gry"} className="rounded-lg border border-white/20 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">{soundsMuted ? "🔇 Włącz dźwięki" : "🔊 Wycisz dźwięki"}</button></div>
          <GameBoard players={players} properties={properties} gameState={gameState} animatedPositions={animatedPositions} currentPlayer={currentPlayer} activePosition={activePosition} diceRolling={diceRolling || autoDiceRolling} diceAnimating={manualDiceAnimating || autoDiceAnimating} rolledValue={autoDiceRolling ? autoRolledValue : manualRolledValue} idleNotice={autoIdleNotice} hasDice={hasDice} onSelectProperty={setSelectedFieldId} gameEvent={boardGameEvent} chanceNotice={chanceNotice ? { playerName: players.find(p => p.player_id === chanceNotice.player_id)?.nickname ?? "Gracz", title: chanceNotice.title, description: chanceNotice.description, kind: chanceNotice.kind, newPositionName: chanceNotice.new_position != null ? fields[chanceNotice.new_position]?.name : undefined } : null} saleNotice={saleNotice ? { playerName: players.find(p => p.player_id === saleNotice.player_id)?.nickname ?? "Gracz", fieldName: fields[saleNotice.field_id]?.name ?? `Pole ${saleNotice.field_id}`, amount: saleNotice.amount, eventType: saleNotice.event_type } : null} />

      {/* Obowiązkowa decyzja więzienna. Brak X, timeoutu i zamykania tłem. */}
      {myTurn && myJailTurns > 0 && gameState.turn_phase === "roll" && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[#050914]/90 p-2 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="city-roll-jail-title"
            className="w-[94%] max-w-[360px] rounded-2xl border border-rose-400/50 bg-[#172235] p-3 text-center text-white shadow-2xl">
            <div className="text-3xl" aria-hidden="true">🚔</div>
            <h2 id="city-roll-jail-title" className="mt-1 text-lg font-black text-rose-200">JESTEŚ W WIĘZIENIU!</h2>
            <p className="mt-3 text-sm text-slate-200">Pozostało kolejek do odsiedzenia:</p>
            <p className="mt-1 text-3xl font-black text-amber-300">{myJailTurns}</p>
            {myBailLocked ? (
              <p className="mt-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm font-bold text-amber-200" role="status">
                🔒 Wybrałeś odsiadkę. Kaucja jest już niedostępna — musisz odsiedzieć pozostałe {myJailTurns} {myJailTurns === 1 ? "kolejkę" : "kolejki"}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-300">Możesz zapłacić $150 albo wybrać odsiadkę. Uwaga: po pierwszym wybraniu „Strać kolejkę” nie będzie już możliwości zapłaty kaucji w kolejnych turach.</p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!myBailLocked && <button type="button" disabled={busy || diceRolling || auctionBlocked || myBalance < 150}
                onClick={() => void jailAction("pay")}
                className="rounded-2xl bg-emerald-400 px-2 py-2 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
                🔓 Zapłać 150 $<span className="mt-1 block text-xs font-medium">Wychodzisz i możesz rzucać</span>
              </button>}
              <button type="button" disabled={busy || diceRolling || auctionBlocked}
                onClick={() => void jailAction("skip")}
                className="rounded-2xl border border-rose-300/40 bg-rose-500/20 px-2 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
                🎲 Strać kolejkę<span className="mt-1 block text-xs font-medium">Pozostanie {Math.max(0, myJailTurns - 1)}</span>
              </button>
            </div>
            {!myBailLocked && myBalance < 150 && <p className="mt-3 text-xs text-amber-200">Nie masz 150 $ — musisz odsiedzieć kolejkę.</p>}
            {error && <p role="alert" className="mt-4 rounded-xl bg-rose-500/20 p-3 text-sm text-rose-200">{error}</p>}
          </section>
        </div>
      )}
        </div>
        {auction && (
          <section className="mx-3 mt-3 rounded-2xl border border-amber-300/40 bg-[#172235] p-4 shadow-xl" aria-live="polite">
            <div className="flex items-center justify-between"><h3 className="font-black text-amber-200">🔨 AUKCJA NA ŻYWO</h3><span className="font-black text-xl text-white">{secondsLeft}s</span></div>
            <p className="mt-2 text-sm font-bold">{fields[auction.field_id]?.name ?? `Pole ${auction.field_id}`}</p>
            <p className="mt-1 text-xs text-slate-300">Sprzedaje: {players.find(p => p.player_id === auction.seller_id)?.nickname ?? "Gracz"}</p>
            <p className="mt-2 text-2xl font-black text-amber-300">${auction.highest_bid ?? auction.starting_price}</p>
            <p className="text-xs text-slate-300">{auction.highest_bidder ? `Prowadzi: ${players.find(p => p.player_id === auction.highest_bidder)?.nickname ?? "Gracz"}` : "Brak ofert — pierwsza oferta = cena wywoławcza"}</p>
            {duelAuction && (
              <p className="mt-2 text-xs text-slate-300">Oferta bezpośrednia — drugi gracz może kupić nieruchomość lub odrzucić propozycję.</p>
            )}
            {myId && myId !== auction.seller_id && !players.find(p => p.player_id === myId)?.is_bankrupt && secondsLeft > 0 && (
              duelAuction ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={auctionBusy || (gameState?.balances?.[myId] ?? 0) < auction.starting_price}
                    onClick={() => void respondToDuelAuction(true)}
                    className="rounded-xl bg-emerald-400 px-2 py-3 text-xs font-black text-slate-950 disabled:opacity-40">
                    ✅ Kup za ${auction.starting_price}
                  </button>
                  <button type="button" disabled={auctionBusy}
                    onClick={() => void respondToDuelAuction(false)}
                    className="rounded-xl border border-white/20 bg-white/10 px-2 py-3 text-xs font-bold text-white disabled:opacity-40">
                    ✕ Odrzuć
                  </button>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(auction.highest_bid === null ? [0] : [10, 25, 50]).map(step => (
                    <button key={step} type="button" disabled={auctionBusy || auction.highest_bidder === myId || (gameState?.balances?.[myId] ?? 0) < (auction.highest_bid === null ? auction.starting_price : auction.highest_bid + step)} onClick={() => void bidAuction(step)} className="rounded-xl bg-amber-300 px-2 py-3 text-xs font-black text-slate-950 disabled:opacity-40">
                      {step === 0 ? `Licytuj $${auction.starting_price}` : `+$${step}`}
                    </button>
                  ))}
                </div>
              )
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
        {confirmation && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => { if (!busy) setConfirmation(null); }}>
            <section role="dialog" aria-modal="true" aria-label={confirmation.type === "sell" ? "Potwierdź sprzedaż miasta" : "Potwierdź bankructwo"} onClick={(event) => event.stopPropagation()} className="w-full max-w-sm overflow-hidden rounded-3xl border border-amber-300/25 bg-[#172235] p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-4xl">{confirmation.type === "sell" ? "🏙️" : "💀"}</div>
              <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">CITY ROLL • POTWIERDZENIE</p>
              <h3 className="mt-2 text-center text-xl font-black">{confirmation.type === "sell" ? "Sprzedać nieruchomość?" : "Ogłosić bankructwo?"}</h3>
              {confirmation.type === "sell" ? (
                <>
                  <p className="mt-2 text-center text-sm text-slate-300">{fields[confirmation.fieldId]?.name ?? "Twoje miasto"} zostanie sprzedane do banku.</p>
                  <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-center">
                    <p className="text-xs font-semibold text-slate-300">Otrzymasz</p>
                    <p className="mt-1 text-3xl font-black text-emerald-300">+${confirmation.price.toLocaleString("en-US")}</p>
                  </div>
                  <p className="mt-3 text-center text-xs text-slate-400">Po sprzedaży stracisz własność tego miasta.</p>
                </>
              ) : (
                <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-center text-sm text-rose-200">Stracisz wszystkie swoje nieruchomości i odpadniesz z rozgrywki. Tej decyzji nie można cofnąć.</p>
              )}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button type="button" disabled={busy} onClick={() => setConfirmation(null)} className="rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-40">Anuluj</button>
                <button type="button" disabled={busy} onClick={() => { if (confirmation.type === "sell") void sellProperty(confirmation.fieldId, true); else void declareBankruptcy(true); }} className={`rounded-xl px-3 py-3 text-sm font-black transition disabled:opacity-40 ${confirmation.type === "sell" ? "bg-amber-300 text-[#172033] hover:bg-amber-200" : "bg-rose-400 text-slate-950 hover:bg-rose-300"}`}>
                  {busy ? "Przetwarzanie..." : confirmation.type === "sell" ? "Sprzedaj miasto" : "Potwierdź"}
                </button>
              </div>
            </section>
          </div>
        )}
        {auctionStartFieldId !== null && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => { if (!auctionBusy) setAuctionStartFieldId(null); }}>
            <section role="dialog" aria-modal="true" aria-label="Ustaw cenę wywoławczą" onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-amber-300/25 bg-[#172235] p-5 text-white shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">CITY ROLL • AUKCJA</p>
                  <h3 className="mt-1 text-xl font-black">🔨 Wystaw nieruchomość</h3>
                  <p className="mt-2 text-sm text-slate-300">{fields[auctionStartFieldId]?.name}</p>
                </div>
                <button type="button" disabled={auctionBusy} onClick={() => setAuctionStartFieldId(null)} className="rounded-lg bg-white/10 px-3 py-1 text-lg disabled:opacity-40" aria-label="Zamknij">×</button>
              </div>
              <form className="mt-5" onSubmit={(event) => { event.preventDefault(); void startAuction(); }}>
                <label htmlFor="auction-start-price" className="mb-2 block text-xs font-bold text-slate-300">Cena wywoławcza ($)</label>
                <div className="flex items-center rounded-xl border border-amber-300/30 bg-[#0d1626] px-4 focus-within:border-amber-300">
                  <span className="text-xl font-black text-amber-300">$</span>
                  <input id="auction-start-price" type="number" min="10" step="1" inputMode="numeric" required autoFocus value={auctionStartPrice} onChange={(event) => { setAuctionStartPrice(event.target.value); setAuctionStartError(""); }} className="w-full bg-transparent px-3 py-4 text-xl font-black text-white outline-none" />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>Minimum: $10</span><span>Czas aukcji: 30 sekund</span></div>
                {auctionStartError && <p role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">{auctionStartError}</p>}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" disabled={auctionBusy} onClick={() => setAuctionStartFieldId(null)} className="rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-bold disabled:opacity-40">Anuluj</button>
                  <button type="submit" disabled={auctionBusy || !Number.isSafeInteger(Number(auctionStartPrice)) || Number(auctionStartPrice) < 10 || auctionStartPrice.trim() === ""} className="rounded-xl bg-amber-300 px-3 py-3 text-sm font-black text-[#172033] disabled:opacity-40">{auctionBusy ? "Wystawianie..." : "Rozpocznij aukcję"}</button>
                </div>
              </form>
            </section>
          </div>
        )}

        {selectedField && selectedField.price !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setSelectedFieldId(null)}>
            <section role="dialog" aria-modal="true" aria-label={`Nieruchomość ${selectedField.name}`} onClick={(event) => event.stopPropagation()} className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/15 bg-[#172235] p-5 text-white shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">CITY ROLL • KARTA NIERUCHOMOŚCI</p>
                  <h3 className="mt-1 text-xl font-black">{selectedField.name}</h3>
                </div>
                <button type="button" onClick={() => setSelectedFieldId(null)} className="rounded-lg bg-white/10 px-3 py-1 text-lg" aria-label="Zamknij">×</button>
              </div>
              <div className="mt-3 h-2 rounded-full" style={{ backgroundColor: selectedField.color }} />
              <p className="mt-3 text-sm text-slate-300">Właściciel: <strong className="text-white">{selectedOwner?.nickname ?? "Brak właściciela"}</strong></p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Cena zakupu</p><strong className="text-lg text-amber-200">${selectedField.price}</strong></div>
                <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Zabudowa</p><strong className="text-lg">{selectedLevel} / 3</strong></div>
              </div>
              {isSelectedUtility && (
                <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                  <p className="font-bold">🚆 Obiekt specjalny — bez rozbudowy</p>
                  <p className="mt-1">Czynsz: 1 obiekt = $40, 2 = $80, 3 = $120, 4 = $160.</p>
                  <p className="mt-1">{selectedProperty ? `Właściciel posiada ${selectedUtilityCount}/4 obiektów. Aktualny czynsz: $${selectedUtilityRent}.` : "Po zakupie pierwszego obiektu czynsz wynosi $40."}</p>
                </div>
              )}
              {selectedEconomy ? (
                <>
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
                    <h4 className="mb-3 text-sm font-black text-amber-200">CENNIK NIERUCHOMOŚCI</h4>
                    <div className="space-y-2 text-sm">
                      <div className={`flex justify-between rounded-lg px-2 py-1.5 ${selectedLevel === 0 ? "bg-emerald-400/15 text-emerald-200" : "text-slate-300"}`}><span>Czynsz bez budynków</span><strong>${selectedEconomy.rent}</strong></div>
                      {selectedEconomy.buildingRents.map((rent, index) => (
                        <div key={index} className={`flex justify-between rounded-lg px-2 py-1.5 ${selectedLevel === index + 1 ? "bg-emerald-400/15 text-emerald-200" : "text-slate-300"}`}>
                          <span>🏠 {index + 1} {index === 0 ? "budynek" : "budynki"}</span><strong>${rent}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white/5 p-3 text-center"><p className="text-xs text-slate-400">Koszt budynku</p><strong className="text-emerald-300">${selectedEconomy.buildingCost}</strong></div>
                    <div className="rounded-xl bg-white/5 p-3 text-center"><p className="text-xs text-slate-400">Cena odsprzedaży miasta*</p><strong className="text-amber-200">${selectedEconomy.sellPrice}</strong></div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">*Cena z nowego cennika. Faktyczną wypłatę ustala funkcja sprzedaży w Supabase.</p>
                </>
              ) : (
                <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-slate-300">Pole specjalne. Nie można budować tutaj budynków.</p>
              )}
              {!selectedProperty && (
                <p className="mt-4 rounded-xl border border-sky-400/20 bg-sky-400/10 p-3 text-xs text-sky-200">To pole nie ma jeszcze właściciela. Możesz je kupić po zatrzymaniu się na nim podczas własnej tury, jeśli pozwalają na to zasady gry.</p>
              )}
              {isMySelectedProperty && selectedProperty && (
                <div className="mt-4 space-y-2">
                  {isBuildableCity && !hasFullColorGroup && (
                    <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-xs text-amber-100">🔒 Aby budować, musisz posiadać wszystkie miasta tego koloru. Brakuje: {missingColorFields.map((fieldId) => fields[fieldId]?.name ?? `Pole ${fieldId}`).join(", ")}.</p>
                  )}
                  {selectedEconomy && selectedLevel < 3 && (
                    <button type="button" disabled={!canBuildSelected} onClick={() => void buildProperty(selectedProperty.field_id)} className="w-full rounded-xl bg-emerald-400 px-3 py-3 text-sm font-black text-slate-950 disabled:opacity-40">🏠 Wybuduj poziom {selectedLevel + 1} — ${selectedBuildCost}</button>
                  )}
                  {selectedEconomy && selectedLevel >= 3 && (
                    <p className="rounded-xl bg-emerald-400/10 p-3 text-center text-xs font-bold text-emerald-300">🏠 Maksymalny poziom zabudowy (3/3)</p>
                  )}
                  {selectedEconomy && selectedLevel > 0 && (
                    <button type="button" disabled={!canSellSelected} onClick={() => void sellBuilding(selectedProperty.field_id)} className="w-full rounded-xl bg-rose-400/15 px-3 py-3 text-sm font-bold text-rose-200 disabled:opacity-40">💰 Sprzedaj budynek — zwrot ${Math.floor(selectedEconomy.buildingCost / 2)}</button>
                  )}
                  {selectedLevel === 0 && (
                    <button type="button" disabled={!canSellSelected} onClick={() => void sellProperty(selectedProperty.field_id)} className="w-full rounded-xl bg-amber-300 px-3 py-3 text-sm font-black text-[#172033] disabled:opacity-40">💰 Sprzedaj do banku</button>
                  )}
                  <button type="button" disabled={!canManageSelected || selectedLevel !== 0 || !!auction || auctionBusy} onClick={() => openAuctionStart(selectedProperty.field_id)} className="w-full rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 text-sm font-bold text-amber-200 disabled:opacity-40">🔨 Wystaw na aukcję</button>
                </div>
              )}
              {selectedProperty && !isMySelectedProperty && <p className="mt-4 text-xs text-slate-400">Możesz oglądać nieruchomość, ale zarządzać nią może tylko właściciel.</p>}
            </section>
          </div>
        )}

        <section className="px-2 pt-1.5">
          <div className="rounded-xl border border-white/10 bg-[#172235] p-2 shadow-xl">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Aktualny ruch</p><p className="truncate text-sm font-bold text-white">{myTurn ? "✨ Twoja kolej!" : `⏳ ${currentPlayer?.nickname ?? "Oczekiwanie"}`}</p></div>
              <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">{gameState.turn_phase === "roll" ? "RZUT" : autoCompletingTurn ? "KONIEC RUCHU" : "DECYZJA"}</span>
            </div>
            {error && <p role="alert" className="mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 p-2 text-center text-xs text-rose-300">{error}</p>}
            <div className="space-y-2">
              <button
                type="button"
                onClick={rollDice}
                disabled={gameState.turn_phase !== "roll" || !myTurn || myJailTurns > 0 || busy || diceRolling || !!auction || auctionBusy || auctionStartFieldId !== null}
                className="w-full rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 px-4 py-4 text-sm font-black tracking-wide text-[#172033] shadow-[0_6px_20px_rgba(245,158,11,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {diceRolling
                  ? "🎲 RZUCANIE / RUCH PIONKA..."
                  : myTurn && gameState.turn_phase === "roll"
                    ? myJailTurns > 0 ? "🔒 JESTEŚ W WIĘZIENIU" : "🎲 RZUĆ KOSTKĄ"
                    : myTurn && gameState.turn_phase === "decision"
                      ? showPurchasePrompt
                        ? "🏙️ WYBIERZ: KUP LUB ODRZUĆ"
                        : myBalance < 0
                          ? "💰 UREGULUJ DŁUG LUB ZAKOŃCZ TURĘ"
                          : "⏳ AUTOMATYCZNE ZAKOŃCZENIE TURY"
                      : gameState.turn_phase === "roll"
                        ? `⏳ RZUT GRACZA: ${currentPlayer?.nickname ?? "Przeciwnik"}`
                        : `⏳ GRA: ${currentPlayer?.nickname ?? "Przeciwnik"}`}
              </button>
              {gameState.turn_phase === "roll" && myTurn && (
                <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-center text-xs leading-relaxed text-amber-100" role="note">
                  {getTurnTip(gameState.turn_number, gameState.current_turn)}
                </p>
              )}
              {gameState.turn_phase === "decision" && (
                <div className="space-y-1.5">
                {showPurchasePrompt && (
                  <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-2">
                    <p className="mb-1 text-center text-xs font-bold">Czy chcesz kupić {activeField?.name ?? "to miasto"} za ${propertyPrice}?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => void buyProperty()}
                        disabled={busy || !!auction || activeBalance < propertyPrice}
                        className="rounded-lg bg-emerald-400 px-2 py-2 text-xs font-black text-slate-950 disabled:opacity-40">{busy ? "Kupowanie..." : "✅ Kupuję"}</button>
                      <button type="button" onClick={() => setDeclinedPurchaseKey(purchaseKey)}
                        disabled={busy || !!auction}
                        className="rounded-lg border border-white/15 bg-white/10 px-2 py-2 text-xs font-bold text-white disabled:opacity-40">✕ Odrzuć</button>
                    </div>
                  </div>
                )}
                {myTurn && myBalance < 0 && <button onClick={finishTurn} disabled={!myTurn || busy || !!auction || myBalance <= -500} className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "KOŃCZENIE TURY..." : "⏭️ ZAKOŃCZ TURĘ"}</button>}
                {myTurn && (gameState.balances?.[myId ?? ""] ?? 0) < 0 && (
                  <div className="space-y-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3">
                    <p className="text-xs text-rose-200">{myBalance <= -500
                      ? "Osiągnąłeś limit debetu -$500. Sprzedaj budynki lub nieruchomości, aby poprawić saldo, albo ogłoś bankructwo."
                      : "Masz dług. Możesz sprzedać majątek lub zakończyć turę."}</p>
                    {canDeclareBankruptcy && <button type="button" onClick={() => void declareBankruptcy()} disabled={!canDeclareBankruptcy}
                      className="w-full rounded-xl border border-rose-400/40 bg-rose-500/20 px-4 py-3 text-sm font-black text-rose-200 disabled:opacity-40">
                      💀 OGŁOŚ BANKRUCTWO
                    </button>}
                  </div>
                )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function GamePage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-white">Ładowanie planszy...</main>}><GameContent /></Suspense>;
}
