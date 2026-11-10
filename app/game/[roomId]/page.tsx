"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase/client";

type Player = { player_id: string; nickname: string; color: string; joined_at: string; is_bankrupt: boolean; pawn_id: number | null };
type RoomStatus = { status: string; winner_id: string | null };
type Property = { field_id: number; owner_id: string; building_level: number };
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
function pawnIcon(pawn: number | null | undefined) {
  return pawnOptions.find((option) => option.id === pawn)?.icon ?? "🎩";
}
const playerAccents = ["#fb7185", "#60a5fa", "#4ade80", "#facc15"];
const cityNames = [
  "START", "GDAŃSK", "GDYNIA", "SOPOT", "OLSZTYN", "TORUŃ", "BYDGOSZCZ",
  "WIĘZIENIE", "SZCZECIN", "GORZÓW", "POZNAŃ", "ZIELONA GÓRA", "WROCŁAW", "OPOLE",
  "PARKING", "KATOWICE", "KRAKÓW", "RZESZÓW", "LUBLIN", "KIELCE", "ŁÓDŹ",
  "IDŹ DO WIĘZ.", "BIAŁYSTOK", "RADOM", "PŁOCK", "SIEDLCE", "WARSZAWA", "ZAKOPANE",
];
const groupColors = ["#fb7185", "#60a5fa", "#fbbf24", "#34d399", "#a78bfa", "#fb923c"];
const specialIds = new Set([0, 7, 14, 21]);
// Ceny według układu widocznego na zrzucie Plato, dostosowane do 28 pól.
// START -> lewa krawędź -> góra -> prawa krawędź -> dół.
const cityPrices: Array<number | null> = [
  null, 180, 180, 345, 70, 395, 395,
  null, 20, 20, 60, 70, 70, 60,
  null, 590, 590, 80, 80, 80, 40,
  null, 45, 50, 150, 35, 70, 150,
];
const fields = cityNames.map((name, id) => ({
  id,
  name,
  price: cityPrices[id],
  color: groupColors[Math.floor(id / 4) % groupColors.length],
}));

function getPosition(index: number) {
  // START: lewy dolny róg. Ruch przeciwnie do poprzedniej wersji.
  if (index < 8) return { row: 8 - index, col: 1 };
  if (index < 15) return { row: 1, col: index - 6 };
  if (index < 22) return { row: index - 13, col: 8 };
  return { row: 8, col: 29 - index };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function Dice3D({ value, rolling }: { value: number | null; rolling: boolean }) {
  const faceRotations: Record<number, string> = {
    1: "rotateX(0deg) rotateY(0deg)",
    2: "rotateY(-90deg)",
    3: "rotateX(-90deg)",
    4: "rotateX(90deg)",
    5: "rotateY(90deg)",
    6: "rotateY(180deg)",
  };
  const faces = [
    { n: 1, transform: "translateZ(20px)" },
    { n: 2, transform: "rotateY(90deg) translateZ(20px)" },
    { n: 3, transform: "rotateX(90deg) translateZ(20px)" },
    { n: 4, transform: "rotateX(-90deg) translateZ(20px)" },
    { n: 5, transform: "rotateY(-90deg) translateZ(20px)" },
    { n: 6, transform: "rotateY(180deg) translateZ(20px)" },
  ];
  return (
    <div className="relative h-12 w-12" style={{ perspective: "250px" }} aria-label={rolling ? "Kostka się obraca" : `Kostka: ${value ?? "?"}`}>
      <div className={`absolute left-1 top-1 h-10 w-10 ${rolling ? "bankroll-dice-spin" : ""}`}
        style={{ transformStyle: "preserve-3d", transform: rolling ? undefined : faceRotations[value ?? 1], transition: rolling ? "none" : "transform 450ms ease-out" }}>
        {faces.map((face) => (
          <div key={face.n} className="absolute inset-0 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-xl font-black text-slate-900 shadow-inner"
            style={{ transform: face.transform, backfaceVisibility: "hidden" }}>
            {face.n}
          </div>
        ))}
      </div>
      {!rolling && value === null && <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-amber-300">?</span>}
    </div>
  );
}

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

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#090e1a] text-slate-200">Ładowanie BANK ROLL...</main>;
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

  function renderPlayer(player: Player, index: number) {
    const isCurrent = gameState!.current_turn === player.player_id;
    const isMe = player.player_id === myId;
    const owned = properties.filter((p) => p.owner_id === player.player_id).length;
    return (
      <div key={player.player_id} className={`relative min-w-0 rounded-2xl border p-3 transition-colors ${player.is_bankrupt ? "opacity-50 " : ""}${isCurrent ? "border-amber-300/70 bg-[#293348] shadow-[0_0_22px_rgba(251,191,36,0.12)]" : "border-white/10 bg-[#172235]"}`}>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg">{pawnIcon(player.pawn_id)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{player.nickname}{isMe ? " (Ty)" : ""}</p>
            <p className="text-[10px] text-slate-400">🏠 {owned} miast{owned === 1 ? "o" : ""}</p>
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between gap-1">
          <span className="text-lg font-black tracking-tight" style={{ color: playerAccents[index] ?? "#fff" }}>${(gameState!.balances?.[player.player_id] ?? 1500).toLocaleString("en-US")}</span>
          {player.is_bankrupt && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[9px] font-black text-rose-300">BANKRUT</span>}
          {isCurrent && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-black text-[#151b2b]">TURA</span>}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e3050_0%,#0b1220_52%,#080d17_100%)] text-white">
      <style>{`@keyframes bankrollDiceSpin { 0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 100% { transform: rotateX(1080deg) rotateY(1440deg) rotateZ(360deg); } } .bankroll-dice-spin { animation: bankrollDiceSpin 850ms linear infinite; } @keyframes bankrollPawnHop { 0% { transform: translateY(3px) scale(.9) rotate(-8deg); } 45% { transform: translateY(-8px) scale(1.14) rotate(5deg); } 100% { transform: translateY(0) scale(1); } } .bankroll-pawn-hop { animation: bankrollPawnHop 290ms ease-out; }`}</style>
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

        {gameFinished && (
          <section className="mx-3 mt-3 rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-300/20 to-[#172235] p-5 text-center shadow-xl">
            <div className="text-5xl">🏆</div>
            <h2 className="mt-2 text-xl font-black text-amber-200">KONIEC GRY!</h2>
            <p className="mt-1 text-sm text-white">Zwycięzca: <strong>{winner?.nickname ?? "Nieznany gracz"}</strong></p>
            {roomStatus?.winner_id === myId && <p className="mt-2 text-sm font-bold text-emerald-300">🎉 Wygrałeś BANK ROLL!</p>}
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

        <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-3">{players.slice(0, 2).map((p, i) => renderPlayer(p, i))}</div>

        {/* Układ 8 × 8: dokładnie 28 pól na obwodzie, bank w środku. */}
        <div className="px-2 sm:px-3">
          <div className="grid aspect-square grid-cols-8 grid-rows-8 gap-[2px] overflow-hidden rounded-2xl border border-white/10 bg-[#060b15] p-[3px] shadow-[0_14px_45px_rgba(0,0,0,0.35)]">
            {fields.map((field) => {
              const pos = getPosition(field.id);
              const owner = properties.find((p) => p.field_id === field.id);
              const ownerIndex = players.findIndex((p) => p.player_id === owner?.owner_id);
              const pawns = players.map((p, i) => ({ player: p, index: i })).filter(({ player }) => !player.is_bankrupt && (animatedPositions[player.player_id] ?? gameState.positions?.[player.player_id] ?? 0) === field.id);
              const isActive = activePosition === field.id;
              const isSpecial = field.price === null;
              return (
                <div key={field.id} style={{ gridRow: pos.row, gridColumn: pos.col, borderTopColor: isSpecial ? "#fbbf24" : field.color }}
                  title={`${field.name}${field.price !== null ? ` • $${field.price}` : ""}${ownerIndex >= 0 ? ` • właściciel: ${players[ownerIndex].nickname}` : ""}`}
                  className={`relative flex min-h-0 min-w-0 flex-col items-center justify-between overflow-hidden rounded-[5px] border border-t-[4px] px-[1px] py-[2px] text-center ${isActive ? "border-x-amber-300/70 border-b-amber-300/70 bg-[#34435a]" : "border-x-white/5 border-b-white/5 bg-[#1a283b]"}`}>
                  <span className="w-full break-words text-center text-[clamp(5px,1.55vw,8px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-100">{field.name}</span>
                  <div className="flex min-h-0 flex-col items-center justify-end gap-0">
                    {field.price !== null ? <span className="text-[clamp(6px,1.65vw,9px)] font-black leading-none text-amber-200">${field.price}</span> : <span className="text-[clamp(9px,2.6vw,15px)] leading-none">{field.id === 0 ? "🚩" : field.id === 7 ? "🔒" : field.id === 14 ? "🅿️" : "🚓"}</span>}
                    {owner && (
                      <span
                        className="flex items-center justify-center gap-[1px] rounded-[3px] bg-black/25 px-[1px] leading-none"
                        title={`Zabudowa: ${owner.building_level === 5 ? "hotel" : `${owner.building_level} domków`} • ${field.name} • właściciel: ${ownerIndex >= 0 ? players[ownerIndex].nickname : "nieznany"}`}
                      >
                         <span className="text-[clamp(8px,2vw,12px)]">{owner.building_level === 5 ? "🏨" : "🏠"}</span>
                         {owner.building_level > 0 && owner.building_level < 5 && (
                           <span className="text-[7px] font-black text-white">{owner.building_level}</span>
                         )}
                        <span className="h-[6px] w-[6px] rounded-full border border-white/50" style={{ backgroundColor: playerAccents[ownerIndex] ?? "#fff" }} />
                      </span>
                    )}
                    {pawns.length > 0 && <div className="flex max-w-full flex-wrap justify-center gap-0 leading-none">{pawns.map(({ player, index }) => <span key={`${player.player_id}-${animatedPositions[player.player_id] ?? "idle"}`} title={player.nickname} className={`inline-block origin-bottom text-[clamp(12px,3vw,19px)] leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)] ${animatedPositions[player.player_id] !== undefined ? "bankroll-pawn-hop" : ""}`}>{pawnIcon(player.pawn_id)}</span>)}</div>}
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
                {[gameState.dice_1, gameState.dice_2].map((die, i) => <Dice3D key={i} value={die} rolling={diceRolling} />)}
              </div>
              <p className="relative text-xs font-bold text-amber-200">{diceRolling ? "🎲 Kostki się toczą..." : hasDice ? `Wynik: ${gameState.dice_1! + gameState.dice_2!}` : "Czekamy na pierwszy rzut"}</p>
              <div className="relative rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] text-slate-300">Cel: $5 000</div>
              <div className="relative flex items-center justify-center gap-3 rounded-lg border border-white/10 bg-black/15 px-2 py-1 text-[9px] text-slate-300">
                <span>🏠 Domki 1–4</span><span>🏨 Hotel 5</span>
              </div>
            </div>
          </div>
        </div>

        {players.length > 2 && <div className="grid grid-cols-2 gap-2 px-3 py-3">{players.slice(2, 4).map((p, i) => renderPlayer(p, i + 2))}</div>}

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
