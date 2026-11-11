"use client";

import type { Player, Property, GameState } from "../types";
import { fields, getPosition, pawnIcon, pawnColor } from "../config";
import { GameEventNotice } from "./GameEventNotice";
import { getCityRent } from "../cityEconomy";
import type { GameEvent } from "../gameEvents";

// Sześcienna kostka 3D: sześć prawdziwych ścian, żadnych migających cyfr.
const DICE_PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

const DICE_FACES = [
  { number: 1, transform: "translateZ(42px)" },
  { number: 6, transform: "rotateY(180deg) translateZ(42px)" },
  { number: 3, transform: "rotateY(90deg) translateZ(42px)" },
  { number: 4, transform: "rotateY(-90deg) translateZ(42px)" },
  { number: 2, transform: "rotateX(90deg) translateZ(42px)" },
  { number: 5, transform: "rotateX(-90deg) translateZ(42px)" },
] as const;

const DICE_LANDING: Record<number, string> = {
  1: "rotateX(-18deg) rotateY(-24deg)",
  2: "rotateX(-108deg) rotateY(-18deg)",
  3: "rotateX(-18deg) rotateY(-114deg)",
  4: "rotateX(-18deg) rotateY(66deg)",
  5: "rotateX(72deg) rotateY(-18deg)",
  6: "rotateX(-18deg) rotateY(156deg)",
};

function DiceFace({ value, rolling = false }: { value: number | null | undefined; rolling?: boolean }) {
  const face = value != null && value >= 1 && value <= 6 ? value : 1;
  return (
    <div className="relative flex h-[136px] w-[136px] items-center justify-center" role="img"
      aria-label={rolling ? "Trwa rzut trójwymiarową kostką" : `Kostka: ${face} oczek`}>
      <div className={`absolute bottom-[8px] h-[19px] w-[88px] rounded-full bg-black/45 blur-[9px] ${rolling ? "city-roll-dice-shadow" : ""}`} />
      <div className={rolling ? "city-roll-dice-bounce" : "city-roll-dice-settle"}>
        <div style={{ perspective: "650px" }} className="h-[84px] w-[84px]">
          <div className={`relative h-[84px] w-[84px] ${rolling ? "city-roll-dice-tumble" : ""}`}
            style={{ transformStyle: "preserve-3d", ...(!rolling ? { transform: DICE_LANDING[face] } : {}) }}>
            {DICE_FACES.map(({ number, transform }) => (
              <div key={number} style={{ transform, backfaceVisibility: "hidden" }}
                className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-[4px] rounded-[14px] border-[2px] border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-200 p-[13px] shadow-[inset_-5px_-5px_10px_rgba(100,116,139,.22),inset_3px_3px_6px_white]">
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} className={`self-center justify-self-center rounded-full ${DICE_PIPS[number].includes(i) ? "h-[12px] w-[12px] bg-[#101827] shadow-[inset_1px_1px_2px_#0009]" : "h-0 w-0"}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type SaleNotice = {
  playerName: string;
  fieldName: string;
  amount: number;
  eventType?: "property_sale" | "building_sale";
};

export function GameBoard({
  players, properties, gameState, animatedPositions, currentPlayer,
  activePosition, diceRolling, diceAnimating = false, rolledValue = null, hasDice, onSelectProperty, saleNotice, gameEvent, chanceNotice, ownFieldNotice, idleNotice,
}: {
  players: Player[];
  properties: Property[];
  gameState: GameState;
  animatedPositions: Record<string, number>;
  currentPlayer: Player | undefined;
  activePosition: number;
  diceRolling: boolean;
  diceAnimating?: boolean;
  rolledValue?: number | null;
  hasDice: boolean;
  onSelectProperty?: (fieldId: number) => void;
  saleNotice?: SaleNotice | null;
  chanceNotice?: { playerName: string; title: string; description: string; kind: string; newPositionName?: string } | null;
  gameEvent?: GameEvent | null;
  ownFieldNotice?: { playerName: string; fieldName: string; key: string } | null;
  idleNotice?: {playerName:string;kind:string;misses:number;dice:number|null}|null;
}) {
  const isBuildingSale = saleNotice?.eventType === "building_sale";

  return (
    <div className="flex min-h-0 justify-center px-1 sm:px-2">
      <style>{`
        @keyframes cityRollDiceTumble {
          0% { transform: rotateX(15deg) rotateY(-20deg) rotateZ(0deg); }
          25% { transform: rotateX(390deg) rotateY(240deg) rotateZ(85deg); }
          50% { transform: rotateX(770deg) rotateY(510deg) rotateZ(160deg); }
          75% { transform: rotateX(1110deg) rotateY(850deg) rotateZ(240deg); }
          100% { transform: rotateX(1455deg) rotateY(1110deg) rotateZ(360deg); }
        }
        @keyframes cityRollDiceBounce {
          0%, 100% { transform: translateY(7px); }
          30% { transform: translateY(-28px); }
          55% { transform: translateY(-10px); }
          80% { transform: translateY(-20px); }
        }
        @keyframes cityRollDiceSettle {
          0% { transform: translateY(-22px) scale(1.07); }
          55% { transform: translateY(5px) scale(.97); }
          75% { transform: translateY(-5px) scale(1.02); }
          100% { transform: translateY(0) scale(1); }
        }
        @keyframes cityRollDiceShadow {
          0%, 100% { transform: scale(1); opacity: .65; }
          30% { transform: scale(.65); opacity: .3; }
          55% { transform: scale(.85); opacity: .45; }
          80% { transform: scale(.7); opacity: .35; }
        }
        .city-roll-dice-tumble { animation: cityRollDiceTumble 1.35s cubic-bezier(.3,.1,.7,.9) infinite; }
        .city-roll-dice-bounce { animation: cityRollDiceBounce .8s ease-in-out infinite; }
        .city-roll-dice-settle { animation: cityRollDiceSettle .55s cubic-bezier(.2,.7,.3,1) both; }
        .city-roll-dice-shadow { animation: cityRollDiceShadow .8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .city-roll-dice-tumble, .city-roll-dice-bounce, .city-roll-dice-settle, .city-roll-dice-shadow { animation: none; }
        }
      `}</style>
      <div
        style={{ gridTemplateColumns: "1.28fr repeat(6, 1fr) 1.28fr", gridTemplateRows: "1.28fr repeat(6, 1fr) 1.28fr" }}
        className="grid aspect-square w-full max-w-[min(100%,calc(100dvh-205px))] gap-[1px] overflow-hidden rounded-xl border border-white/10 bg-[#060b15] p-[2px] shadow-[0_14px_45px_rgba(0,0,0,0.35)]"
      >
        {fields.map((field) => {
          const pos = getPosition(field.id);
          const owner = properties.find((p) => p.field_id === field.id);
          const ownerPlayer = players.find((p) => p.player_id === owner?.owner_id);
          const pawns = players.filter((player) => !player.is_bankrupt && (animatedPositions[player.player_id] ?? gameState.positions?.[player.player_id] ?? 0) === field.id);
          // Nie podświetlaj docelowego pola, dopóki pionek nie zakończy ruchu.
          const isPawnMoving = currentPlayer != null && animatedPositions[currentPlayer.player_id] !== undefined;
          const isActive = !diceRolling && !isPawnMoving && activePosition === field.id;
          const isSpecial = field.price === null;
          const canPreview = field.price !== null && !!onSelectProperty;
          const tileEdge = isSpecial ? "#64748b" : field.color;
          const level = Math.max(0, Math.min(3, owner?.building_level ?? 0));
          const utilityIds = [4, 11, 18, 25];
          const isUtility = utilityIds.includes(field.id);
          const utilityCount = owner ? properties.filter((p) => utilityIds.includes(p.field_id) && p.owner_id === owner.owner_id).length : 0;
          const currentRent = owner ? (isUtility ? utilityCount * 40 : getCityRent(field.id, level)) : null;
          const ownerIsHere = pawns.some((player) => player.player_id === owner?.owner_id);
          return (
            <button
              key={field.id}
              type="button"
              disabled={!canPreview}
              onClick={() => onSelectProperty?.(field.id)}
              style={{
                gridRow: pos.row,
                gridColumn: pos.col,
                backgroundColor: isSpecial ? "#40546e" : !owner ? "#416078" : "#354b66",
                borderColor: isActive ? "#fbbf24" : !isSpecial && !owner ? "#78a99e" : "#7186a3",
                boxShadow: isActive ? "inset 0 0 0 2px #fbbf24" : "none",
              }}
              title={`${field.name}${field.price !== null ? owner ? ` • czynsz: $${currentRent ?? "?"}` : ` • cena zakupu: $${field.price}` : ""}${ownerPlayer ? ` • właściciel: ${ownerPlayer.nickname}` : ""}`}
              className={`relative flex min-h-0 min-w-0 flex-col items-center justify-between overflow-hidden rounded-[4px] border px-[2px] pb-[2px] pt-[7px] text-center disabled:cursor-default ${canPreview ? "cursor-pointer hover:bg-[#304159]" : ""}`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[6px]"
                style={{ backgroundColor: tileEdge }}
              />
              {/* Nazwa ma własny obszar u góry pola. */}
              <span className="absolute inset-x-[2px] top-[8px] z-10 max-h-[34%] overflow-hidden break-words text-center text-[clamp(7px,1.7vw,10px)] font-black leading-[1.05] tracking-[-0.025em] text-white">
                {field.name}
              </span>

              {/* Czynsz jest na stałe w środku i nie przesuwa się przez pionki. */}
              {field.price !== null ? (
                <span className="absolute left-1/2 top-[51%] z-20 max-w-[calc(100%-4px)] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[3px] border border-white/15 bg-[#0b1628] px-[2px] py-[2px] text-[clamp(7px,1.6vw,10px)] font-black leading-none text-amber-100 shadow-sm">
                  {owner ? `💸 $${currentRent ?? "?"}` : `$${field.price}`}
                </span>
              ) : field.icon ? (
                <span className="absolute left-1/2 top-[51%] z-10 -translate-x-1/2 -translate-y-1/2 text-[clamp(10px,2.5vw,16px)] leading-none">
                  {field.icon}
                </span>
              ) : null}

              {/* Domki tuż nad dolną krawędzią, bez przesuwania czynszu. */}
              {!isUtility && level > 0 && (
                <span className="absolute bottom-[2px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-[2px]" title={`Budynki: ${level}/3`}>
                  {Array.from({ length: level }, (_, i) => (
                    <span key={i} className="h-[3px] w-[5px] rounded-[1px] bg-emerald-300" />
                  ))}
                </span>
              )}

              {/* Pionki w oddzielnej dolnej strefie, niezależnej od czynszu. */}
              {pawns.length > 0 && (
                <div className="absolute bottom-[7px] right-[2px] z-20 grid max-w-[75%] grid-cols-2 justify-items-end gap-[1px]">
                  {pawns.map((player) => (
                    <span
                      key={`${player.player_id}-${animatedPositions[player.player_id] ?? "idle"}`}
                      title={`Pionek na polu: ${player.nickname}${player.player_id === owner?.owner_id ? " (właściciel)" : ""}`}
                      style={{ borderColor: pawnColor(player.pawn_id), boxShadow: "0 0 0 1px #fff, 0 2px 5px #0009" }}
                      className={`inline-flex h-[clamp(14px,3.3vw,20px)] w-[clamp(14px,3.3vw,20px)] shrink-0 items-center justify-center rounded-full border-[2px] bg-[#08111f] text-[clamp(9px,2.1vw,13px)] leading-none ${animatedPositions[player.player_id] !== undefined ? "bankroll-pawn-hop" : ""}`}
                    >
                      {pawnIcon(player.pawn_id)}
                    </span>
                  ))}
                </div>
              )}
              {ownerPlayer && (
                <span
                  className="absolute bottom-[2px] left-[2px] z-30 flex h-[clamp(12px,2.7vw,17px)] min-w-[clamp(12px,2.7vw,17px)] items-center justify-center rounded-[4px] border-[2px] bg-[#101b2d] px-[2px] text-[clamp(8px,1.9vw,12px)] leading-none "
                  title={`Właściciel: ${ownerPlayer.nickname} • ${isUtility ? `obiekty: ${utilityCount}/4, czynsz: $${currentRent}` : `zabudowa: ${level}`}${ownerIsHere ? " • stoi na tym polu" : ""}`}
                  style={{ borderColor: pawnColor(ownerPlayer.pawn_id) }}
                >
                  {pawnIcon(ownerPlayer.pawn_id)}
                </span>
              )}
            </button>
          );
        })}
        <div style={{ gridRow: "2 / 8", gridColumn: "2 / 8" }} className="relative flex min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-[#172438] p-2 text-center">
          {diceRolling ? (
            <div className="flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
              <p className="text-[11px] font-black uppercase tracking-[.2em] text-amber-200">{diceAnimating ? "🎲 Losowanie" : "🎲 Wylosowano"}</p>
              <div>
                <DiceFace value={rolledValue ?? gameState.dice_1} rolling={diceAnimating} />
              </div>
              {diceAnimating ? (
                <p className="text-sm font-semibold text-slate-200">Kostka się kręci...</p>
              ) : (
                <>
                  <p className="text-xs font-bold text-slate-200">Pionek rusza za chwilę!</p>
                </>
              )}
            </div>
          ) : idleNotice ? (
            <div className="flex max-w-full flex-col items-center gap-2 px-3 text-center" role="status" aria-live="assertive">
              <span className="text-4xl">{idleNotice.kind==="eliminated"?"🚫":idleNotice.kind==="warning"?"⚠️":"🎲"}</span>
              <p className="text-lg font-black text-white">{idleNotice.kind==="eliminated"?"Gracz wyrzucony z gry!":idleNotice.kind==="warning"?"Ostatnie ostrzeżenie!":"Automatyczny rzut"}</p>
              <p className="text-sm text-slate-200">{idleNotice.playerName}</p>
              <p className="text-xs font-semibold text-amber-200">{idleNotice.kind==="eliminated"?"Trzecia nieaktywna tura z rzędu — eliminacja.":idleNotice.kind==="warning"?"Druga nieaktywna tura. Kolejna oznacza eliminację.":`Minęło 60 sekund. Gra rzuca za gracza${idleNotice.dice?` — ${idleNotice.dice} oczek`:""}. Bez zakupu nieruchomości.`}</p>
            </div>
          ) : chanceNotice ? (
            <div className="flex max-w-full flex-col items-center gap-1 px-2" role="status" aria-live="polite">
              <span className="text-3xl">{chanceNotice.kind === "jail" ? "🚔" : "🎴"}</span>
              <p className="text-xs font-black uppercase tracking-widest text-violet-300">Karta losowa</p>
              <p className="text-xs font-semibold text-slate-200">{chanceNotice.playerName}</p>
              <p className="text-lg font-black text-white">{chanceNotice.title}</p>
              <p className="text-xs text-slate-200">{chanceNotice.description}</p>
              {chanceNotice.newPositionName && <p className="text-[10px] text-amber-200">Pole: {chanceNotice.newPositionName}</p>}
            </div>
          ) : ownFieldNotice && !diceRolling ? (
            <div className="flex max-w-full flex-col items-center gap-2 px-2" role="status" aria-live="polite">
              <span className="text-3xl">🏠</span>
              <p className="text-xs font-black uppercase tracking-widest text-emerald-300">Własna nieruchomość</p>
              <p className="text-lg font-black text-white">{ownFieldNotice.fieldName}</p>
              <p className="text-xs text-slate-200">{ownFieldNotice.playerName} stanął na swoim polu!</p>
              <p className="text-xs font-semibold text-emerald-200">Bez opłaty za czynsz</p>
            </div>
          ) : gameEvent && !diceRolling ? (
            <GameEventNotice event={gameEvent} />
          ) : saleNotice && !diceRolling ? (
            <div className="flex flex-col items-center gap-2 px-2" role="status" aria-live="polite">
              <span className="text-3xl">{isBuildingSale ? "🏗️" : "🏙️"}</span>
              <p className="text-xs font-black uppercase tracking-widest text-emerald-300">{isBuildingSale ? "Sprzedaż budynku" : "Sprzedaż miasta"}</p>
              <p className="text-xl font-black text-white">{saleNotice.fieldName}</p>
              <p className="text-xs text-slate-200">{saleNotice.playerName} {isBuildingSale ? "sprzedał(a) budynek" : "sprzedał(a) nieruchomość"}</p>
              <p className="text-2xl font-black text-emerald-300">+${saleNotice.amount.toLocaleString("en-US")}</p>
              <p className="text-[10px] text-slate-400">Do następnego rzutu</p>
            </div>
          ) : (
            <>
              <p className="max-w-full truncate text-[clamp(9px,2.5vw,13px)] font-semibold text-slate-300">{currentPlayer?.nickname ?? "Oczekiwanie"} • {gameState.turn_phase === "roll" ? "rzut kostką" : "decyzja"}</p>
              <div className="flex items-center justify-center gap-2"><DiceFace value={gameState.dice_1} /></div>
              <p className="text-[clamp(12px,3.3vw,20px)] font-black text-amber-200">{diceRolling ? "🎲 Rzut..." : hasDice ? (gameState.dice_1 === 6 ? "Dodatkowy rzut!" : "Ostatni rzut") : "Rzuć kostką"}</p>
              {gameState.turn_phase === "decision" && !diceRolling && <p className="max-w-full break-words text-[clamp(10px,2.7vw,15px)] font-bold text-white">{fields[activePosition]?.name ?? "Pole"}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
