
"use client";

import type { Player, Property, GameState } from "../types";
import { fields, getPosition, pawnIcon } from "../config";
import { GameEventNotice } from "./GameEventNotice";
import { getCityRent } from "../cityEconomy";
import type { GameEvent } from "../gameEvents";
import { getPlayerColor, getPlayerFieldColor } from "../gameTheme";

// ==========================================
// KOSTKA 3D — ZACHOWANA MECHANIKA
// ==========================================

const DICE_PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
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

function DiceFace({
  value,
  rolling = false,
}: {
  value: number | null | undefined;
  rolling?: boolean;
}) {
  const face =
    value != null && value >= 1 && value <= 6 ? value : 1;

  return (
    <div
      className="relative flex h-[136px] w-[136px] items-center justify-center"
      role="img"
      aria-label={
        rolling
          ? "Trwa rzut trójwymiarową kostką"
          : `Kostka: ${face} oczek`
      }
    >
      <div
        className={`absolute bottom-[8px] h-[19px] w-[88px] rounded-full bg-black/45 blur-[9px] ${
          rolling ? "city-roll-dice-shadow" : ""
        }`}
      />

      <div
        className={
          rolling
            ? "city-roll-dice-bounce"
            : "city-roll-dice-settle"
        }
      >
        <div
          style={{ perspective: "650px" }}
          className="h-[84px] w-[84px]"
        >
          <div
            className={`relative h-[84px] w-[84px] ${
              rolling ? "city-roll-dice-tumble" : ""
            }`}
            style={{
              transformStyle: "preserve-3d",
              ...(!rolling
                ? { transform: DICE_LANDING[face] }
                : {}),
            }}
          >
            {DICE_FACES.map(({ number, transform }) => (
              <div
                key={number}
                style={{
                  transform,
                  backfaceVisibility: "hidden",
                }}
                className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-[4px] rounded-[14px] border-[2px] border-slate-300 bg-gradient-to-br from-white via-slate-50 to-slate-200 p-[13px] shadow-[inset_-5px_-5px_10px_rgba(100,116,139,.22),inset_3px_3px_6px_white]"
              >
                {Array.from({ length: 9 }, (_, i) => (
                  <span
                    key={i}
                    className={`self-center justify-self-center rounded-full ${
                      DICE_PIPS[number].includes(i)
                        ? "h-[12px] w-[12px] bg-[#101827] shadow-[inset_1px_1px_2px_#0009]"
                        : "h-0 w-0"
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// IKONY I WYGLĄD PÓL
// ==========================================

function getFieldIcon(
  name: string,
  originalIcon?: string | null
) {
  if (originalIcon) return originalIcon;

  const n = name.toLocaleLowerCase("pl");

  if (n.includes("start")) return "🚀";
  if (n.includes("lotnisk") || n.includes("airport")) return "✈️";
  if (n.includes("lotnik")) return "🧑‍✈️";
  if (n.includes("więzien") || n.includes("wiezien")) return "🚔";
  if (n.includes("policj")) return "🚓";
  if (n.includes("szans") || n.includes("losow")) return "🎴";
  if (n.includes("podat")) return "💸";
  if (n.includes("parking")) return "🅿️";
  if (n.includes("elektrown")) return "⚡";
  if (n.includes("wodoci")) return "💧";
  if (n.includes("kolej") || n.includes("dworzec")) return "🚆";
  if (n.includes("port")) return "🚢";
  if (n.includes("bank")) return "🏦";
  if (n.includes("szpital")) return "🏥";
  if (n.includes("hotel")) return "🏨";
  if (n.includes("bonus") || n.includes("premi")) return "🎁";

  return "🏙️";
}

// Wspólna paleta z panelami graczy (gameTheme.ts).
function playerVisualColor(playerId: string | undefined, players: Player[]) {
  return getPlayerColor(playerId, players.map((player) => player.player_id));
}

function playerFieldColor(playerId: string | undefined, players: Player[]) {
  return getPlayerFieldColor(playerId, players.map((player) => player.player_id));
}

function fieldBackground(isSpecial: boolean, ownerColor?: string) {
  if (isSpecial) return "#FFFFFF";
  return ownerColor ?? "#FFFFFF";
}


type SaleNotice = {
  playerName: string;
  fieldName: string;
  amount: number;
  eventType?: "property_sale" | "building_sale";
};

type IdleNotice = {
  playerName: string;
  kind: string;
  misses: number;
  dice: number | null;
};

type ChanceNotice = {
  playerName: string;
  title: string;
  description: string;
  kind: string;
  newPositionName?: string;
};

// ==========================================
// GŁÓWNY KOMPONENT PLANSZY
// ==========================================

export function GameBoard({
  players,
  properties,
  gameState,
  animatedPositions,
  currentPlayer,
  activePosition,
  diceRolling,
  diceAnimating = false,
  rolledValue = null,
  hasDice,
  onSelectProperty,
  saleNotice,
  gameEvent,
  chanceNotice,
  ownFieldNotice,
  idleNotice,
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
  gameEvent?: GameEvent | null;
  chanceNotice?: ChanceNotice | null;
  ownFieldNotice?: {
    playerName: string;
    fieldName: string;
    key: string;
  } | null;
  idleNotice?: IdleNotice | null;
}) {
  const isBuildingSale =
    saleNotice?.eventType === "building_sale";

  const utilityIds = [4, 11, 18, 25];

  return (
    <div className="flex min-h-0 w-full justify-center px-1 sm:px-2">
      <style>{`
        @keyframes cityRollDiceTumble {
          0% {
            transform: rotateX(15deg) rotateY(-20deg) rotateZ(0deg);
          }
          25% {
            transform: rotateX(390deg) rotateY(240deg) rotateZ(85deg);
          }
          50% {
            transform: rotateX(770deg) rotateY(510deg) rotateZ(160deg);
          }
          75% {
            transform: rotateX(1110deg) rotateY(850deg) rotateZ(240deg);
          }
          100% {
            transform: rotateX(1455deg) rotateY(1110deg) rotateZ(360deg);
          }
        }

        @keyframes cityRollDiceBounce {
          0%, 100% { transform: translateY(7px); }
          30% { transform: translateY(-28px); }
          55% { transform: translateY(-10px); }
          80% { transform: translateY(-20px); }
        }

        @keyframes cityRollDiceSettle {
          0% {
            transform: translateY(-22px) scale(1.07);
          }
          55% {
            transform: translateY(5px) scale(.97);
          }
          75% {
            transform: translateY(-5px) scale(1.02);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }

        @keyframes cityRollDiceShadow {
          0%, 100% {
            transform: scale(1);
            opacity: .65;
          }
          30% {
            transform: scale(.65);
            opacity: .3;
          }
          55% {
            transform: scale(.85);
            opacity: .45;
          }
          80% {
            transform: scale(.7);
            opacity: .35;
          }
        }

        @keyframes cityRollPawnHop {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }

        @keyframes cityRollActiveGlow {
          0%, 100% {
            box-shadow:
              inset 0 0 0 2px #fbbf24,
              0 0 8px rgba(251,191,36,.25);
          }
          50% {
            box-shadow:
              inset 0 0 0 2px #fde68a,
              0 0 17px rgba(251,191,36,.55);
          }
        }

        .city-roll-dice-tumble {
          animation: cityRollDiceTumble 1.35s
            cubic-bezier(.3,.1,.7,.9) infinite;
        }

        .city-roll-dice-bounce {
          animation: cityRollDiceBounce .8s ease-in-out infinite;
        }

        .city-roll-dice-settle {
          animation: cityRollDiceSettle .55s
            cubic-bezier(.2,.7,.3,1) both;
        }

        .city-roll-dice-shadow {
          animation: cityRollDiceShadow .8s ease-in-out infinite;
        }

        .city-roll-pawn-hop,
        .bankroll-pawn-hop {
          animation: cityRollPawnHop .35s ease-in-out;
        }

        .city-roll-active-tile {
          animation: cityRollActiveGlow 1.7s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .city-roll-dice-tumble,
          .city-roll-dice-bounce,
          .city-roll-dice-settle,
          .city-roll-dice-shadow,
          .city-roll-pawn-hop,
          .bankroll-pawn-hop,
          .city-roll-active-tile {
            animation: none;
          }
        }
      `}</style>

      <div
        style={{
          gridTemplateColumns:
            "1.28fr repeat(6, minmax(0,1fr)) 1.28fr",
          gridTemplateRows:
            "1.28fr repeat(6, minmax(0,1fr)) 1.28fr",
        }}
        className="relative grid aspect-square w-full max-w-[min(100%,calc(100dvh-205px))] gap-[2px] overflow-hidden rounded-2xl border-2 border-[#b8c8d8] bg-white p-[3px] shadow-[0_20px_65px_rgba(0,0,0,.55),inset_0_0_25px_rgba(58,113,157,.12)]"
      >
        {/* POLA DOOKOŁA PLANSZY */}
        {fields.map((field) => {
          const pos = getPosition(field.id);

          const owner = properties.find(
            (p) => p.field_id === field.id
          );

          const ownerPlayer = players.find(
            (p) => p.player_id === owner?.owner_id
          );

          const pawns = players.filter((player) => {
            if (player.is_bankrupt) return false;

            const position =
              animatedPositions[player.player_id] ??
              gameState.positions?.[player.player_id] ??
              0;

            return position === field.id;
          });

          const isPawnMoving =
            currentPlayer != null &&
            animatedPositions[currentPlayer.player_id] !==
              undefined;

          const isActive =
            !diceRolling &&
            !isPawnMoving &&
            activePosition === field.id;

          const isSpecial = field.price === null;
          const canPreview =
            field.price !== null && !!onSelectProperty;

          const tileEdge = isSpecial
            ? "#7c9bb7"
            : field.color;

          const level = Math.max(
            0,
            Math.min(3, owner?.building_level ?? 0)
          );

          const isUtility = utilityIds.includes(field.id);

          const utilityCount = owner
            ? properties.filter(
                (p) =>
                  utilityIds.includes(p.field_id) &&
                  p.owner_id === owner.owner_id
              ).length
            : 0;

          const currentRent = owner
            ? isUtility
              ? utilityCount * 40
              : getCityRent(field.id, level)
            : null;

          const icon = getFieldIcon(
            field.name,
            field.icon
          );

          return (
            <button
              key={field.id}
              type="button"
              disabled={!canPreview}
              onClick={() => onSelectProperty?.(field.id)}
              title={[
                field.name,
                field.price !== null
                  ? owner
                    ? `Czynsz: $${currentRent ?? "?"}`
                    : `Cena: $${field.price}`
                  : "",
                ownerPlayer
                  ? `Właściciel: ${ownerPlayer.nickname}`
                  : "",
              ]
                .filter(Boolean)
                .join(" • ")}
              style={{
                gridRow: pos.row,
                gridColumn: pos.col,
                background: fieldBackground(
                  isSpecial,
                  owner ? playerFieldColor(owner.owner_id, players) : undefined
                ),
                borderColor: isActive
                  ? "#fbbf24"
                  : owner
                    ? playerVisualColor(owner.owner_id, players)
                    : "#a6b5c7",
              }}
              className={`group relative flex min-h-0 min-w-0 flex-col items-center overflow-hidden rounded-[6px] border text-center transition-[filter,box-shadow] duration-200 ${
                canPreview
                  ? "cursor-pointer hover:brightness-125"
                  : "cursor-default"
              } ${
                isActive ? "city-roll-active-tile z-10" : ""
              }`}
            >
              {/* KOLOR GRUPY NIERUCHOMOŚCI */}
              <div
                className="absolute inset-x-0 top-0 h-[7px] border-b border-black/20"
                style={{
                  background: tileEdge,
                  boxShadow: `0 2px 8px ${tileEdge}55`,
                }}
              />

              {/* NUMER POLA */}
              <span className="absolute left-[2px] top-[8px] z-10 text-[clamp(5px,1vw,7px)] font-bold text-slate-700/70">
                {field.id}
              </span>

              {/* NAZWA */}
              <div className="absolute inset-x-[2px] top-[15%] z-10 flex h-[27%] items-start justify-center overflow-hidden">
                <span className="rounded-[3px] bg-white/70 px-[2px] break-words text-[clamp(6px,1.35vw,10px)] font-black leading-[1.05] tracking-tight text-[#111827]">
                  {field.name}
                </span>
              </div>

              {/* IKONA POLA / CENA */}
              <div className="absolute inset-x-[2px] top-[42%] flex h-[30%] flex-col items-center justify-center gap-[1px]">
                {isSpecial ? (
                  <span
                    aria-hidden="true"
                    className="text-[clamp(13px,3vw,27px)] leading-none drop-shadow-[0_2px_5px_#0008]"
                  >
                    {icon}
                  </span>
                ) : (
                  <>
                    <span className="text-[clamp(10px,2.1vw,17px)] leading-none opacity-90 drop-shadow-[0_2px_3px_#000]">
                      {isUtility ? icon : "🏙️"}
                    </span>

                    <span
                      className={`max-w-full whitespace-nowrap rounded-[4px] border px-[3px] py-[2px] text-[clamp(7px,1.4vw,10px)] font-black leading-none shadow-sm ${
                        owner
                          ? "border-slate-800/20 bg-white/85 text-slate-950"
                          : "border-slate-400/40 bg-[#e6f5eb] text-slate-900"
                      }`}
                    >
                      {owner
                        ? `$${currentRent ?? "?"}`
                        : `$${field.price}`}
                    </span>
                  </>
                )}
              </div>

              {/* DOMKI */}
              {!isUtility && level > 0 && (
                <div
                  className="absolute bottom-[3px] left-[3px] z-20 flex gap-[1px]"
                  title={`Budynki: ${level}/3`}
                >
                  {Array.from(
                    { length: level },
                    (_, i) => (
                      <span
                        key={i}
                        className="text-[clamp(7px,1.5vw,11px)] leading-none drop-shadow-[0_1px_2px_#000]"
                      >
                        🏠
                      </span>
                    )
                  )}
                </div>
              )}

              {/* PIONKI — IKONY Z CONFIG.TS */}
              {pawns.length > 0 && (
                <div className="absolute bottom-[3px] right-[2px] z-30 grid max-w-[85%] grid-cols-2 justify-items-end gap-[2px]">
                  {pawns.map((player) => {
                    const moving =
                      animatedPositions[player.player_id] !==
                      undefined;

                    return (
                      <span
                        key={`${player.player_id}-${
                          animatedPositions[player.player_id] ??
                          "idle"
                        }`}
                        title={`Gracz: ${player.nickname}`}
                        style={{
                          backgroundColor: playerVisualColor(player.player_id, players),
                          borderColor: "#ffffff",
                          boxShadow: `0 0 0 2px #07111e, 0 0 11px ${playerVisualColor(player.player_id, players)}, 0 3px 9px #000c`,
                        }}
                        className={`inline-flex h-[clamp(17px,3.5vw,26px)] w-[clamp(17px,3.5vw,26px)] shrink-0 items-center justify-center rounded-full border-[2px] text-[clamp(11px,2.2vw,17px)] leading-none ${
                          moving ? "city-roll-pawn-hop" : ""
                        }`}
                      >
                        {pawnIcon(player.pawn_id)}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* WŁAŚCICIEL POLA */}
              {ownerPlayer && (
                <span
                  className="absolute bottom-[2px] left-[2px] z-20 flex h-[clamp(13px,2.5vw,19px)] min-w-[clamp(13px,2.5vw,19px)] items-center justify-center rounded-[4px] border-[2px] bg-white px-[2px] text-[clamp(9px,1.8vw,13px)] leading-none"
                  style={{
                    borderColor: playerVisualColor(ownerPlayer.player_id, players),
                  }}
                  title={`Właściciel: ${ownerPlayer.nickname}`}
                >
                  {pawnIcon(ownerPlayer.pawn_id)}
                </span>
              )}
            </button>
          );
        })}

        {/* CENTRALNY PANEL PLANSZY */}
        <div
          style={{
            gridRow: "2 / 8",
            gridColumn: "2 / 8",
          }}
          className="relative flex min-h-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-[#c4d0dd] bg-white p-2 text-center shadow-[inset_0_0_35px_#a8bdd333]"
        >
          {/* OZDOBNE NAROŻNIKI */}
          <span className="pointer-events-none absolute left-3 top-3 h-6 w-6 border-l-2 border-t-2 border-amber-400/40" />
          <span className="pointer-events-none absolute right-3 top-3 h-6 w-6 border-r-2 border-t-2 border-amber-400/40" />
          <span className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 border-b-2 border-l-2 border-amber-400/40" />
          <span className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 border-b-2 border-r-2 border-amber-400/40" />

          {/* DELIKATNA SIATKA MIASTA */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[.07]"
            style={{
              backgroundImage:
                "linear-gradient(#94a3b8 1px,transparent 1px),linear-gradient(90deg,#94a3b8 1px,transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />

       <div className="relative z-10 flex h-full w-full min-h-0 max-w-full flex-col items-center justify-center gap-1">
            {diceRolling ? (
              <div
                className="flex flex-col items-center justify-center gap-2"
                role="status"
                aria-live="polite"
              >
                <p className="text-[11px] font-black uppercase tracking-[.2em] text-amber-800">
                  {diceAnimating
                    ? "🎲 Losowanie"
                    : "🎲 Wylosowano"}
                </p>

                <DiceFace
                  value={
                    rolledValue ?? gameState.dice_1
                  }
                  rolling={diceAnimating}
                />

                <p className="text-xs font-bold text-slate-700">
                  {diceAnimating
                    ? "Kostka się kręci..."
                    : "Pionek rusza za chwilę!"}
                </p>
              </div>
            ) : idleNotice ? (
              <div
                className="flex max-w-full flex-col items-center gap-2 px-3"
                role="status"
                aria-live="assertive"
              >
                <span className="text-4xl">
                  {idleNotice.kind === "eliminated"
                    ? "🚫"
                    : idleNotice.kind === "warning"
                      ? "⚠️"
                      : "🎲"}
                </span>

                <p className="text-lg font-black text-slate-900">
                  {idleNotice.kind === "eliminated"
                    ? "Gracz wyrzucony z gry!"
                    : idleNotice.kind === "warning"
                      ? "Ostatnie ostrzeżenie!"
                      : "Automatyczny rzut"}
                </p>

                <p className="text-sm text-slate-700">
                  {idleNotice.playerName}
                </p>

                <p className="text-xs font-semibold text-amber-800">
                  {idleNotice.kind === "eliminated"
                    ? "Trzecia nieaktywna tura z rzędu — eliminacja."
                    : idleNotice.kind === "warning"
                      ? "Druga nieaktywna tura. Kolejna oznacza eliminację."
                      : `Minęło 60 sekund. Gra rzuca za gracza${
                          idleNotice.dice
                            ? ` — ${idleNotice.dice} oczek`
                            : ""
                        }. Bez zakupu nieruchomości.`}
                </p>
              </div>
            ) : chanceNotice ? (
              <div
                className="flex max-w-full flex-col items-center gap-1 px-2"
                role="status"
                aria-live="polite"
              >
                <span className="text-4xl">
                  {chanceNotice.kind === "jail"
                    ? "🚔"
                    : "🎴"}
                </span>

                <p className="text-xs font-black uppercase tracking-widest text-violet-800">
                  Karta losowa
                </p>

                <p className="text-xs font-semibold text-slate-700">
                  {chanceNotice.playerName}
                </p>

                <p className="text-lg font-black text-slate-900">
                  {chanceNotice.title}
                </p>

                <p className="text-xs text-slate-700">
                  {chanceNotice.description}
                </p>

                {chanceNotice.newPositionName && (
                  <p className="text-[10px] text-amber-800">
                    Pole: {chanceNotice.newPositionName}
                  </p>
                )}
              </div>
            ) : ownFieldNotice ? (
              <div
                className="flex max-w-full flex-col items-center gap-2 px-2"
                role="status"
                aria-live="polite"
              >
                <span className="text-4xl">🏠</span>

                <p className="text-xs font-black uppercase tracking-widest text-emerald-800">
                  Własna nieruchomość
                </p>

                <p className="text-lg font-black text-slate-900">
                  {ownFieldNotice.fieldName}
                </p>

                <p className="text-xs text-slate-700">
                  {ownFieldNotice.playerName} stanął na
                  swoim polu!
                </p>

                <p className="text-xs font-semibold text-emerald-800">
                  Bez opłaty za czynsz
                </p>
              </div>
            ) : gameEvent ? (
              <GameEventNotice event={gameEvent} />
            ) : saleNotice ? (
              <div
                className="flex flex-col items-center gap-2 px-2"
                role="status"
                aria-live="polite"
              >
                <span className="text-4xl">
                  {isBuildingSale ? "🏗️" : "🏙️"}
                </span>

                <p className="text-xs font-black uppercase tracking-widest text-emerald-800">
                  {isBuildingSale
                    ? "Sprzedaż budynku"
                    : "Sprzedaż miasta"}
                </p>

                <p className="text-xl font-black text-slate-900">
                  {saleNotice.fieldName}
                </p>

                <p className="text-xs text-slate-700">
                  {saleNotice.playerName}{" "}
                  {isBuildingSale
                    ? "sprzedał(a) budynek"
                    : "sprzedał(a) nieruchomość"}
                </p>

                <p className="text-2xl font-black text-emerald-800">
                  +$
                  {saleNotice.amount.toLocaleString(
                    "en-US"
                  )}
                </p>
              </div>
            ) : (
              <>
              
{/* AKTUALNY GRACZ */}
                <div className="flex max-w-full items-center gap-2 rounded-full border border-slate-300 bg-white/85 px-3 py-1">
                  {currentPlayer && (
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white text-lg"
                      style={{
                        borderColor: playerVisualColor(currentPlayer.player_id, players),
                      }}
                    >
                      {pawnIcon(currentPlayer.pawn_id)}
                    </span>
                  )}

                  <span className="max-w-[170px] truncate text-[clamp(9px,2vw,13px)] font-bold text-slate-900">
                    {currentPlayer?.nickname ??
                      "Oczekiwanie"}
                  </span>
                </div>

                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                  {gameState.turn_phase === "roll"
                    ? "Rzut kostką"
                    : "Podejmowanie decyzji"}
                </p>

                {/* KOSTKA */}
              
<div className="flex h-[100px] w-[136px] shrink-0 items-center justify-center sm:h-[136px]">
  <div className="origin-center scale-[0.72] sm:scale-100">
    <DiceFace value={gameState.dice_1} />
  </div>
</div>


                <p className="text-[clamp(12px,3vw,20px)] font-black text-amber-800">
                  {hasDice
                    ? gameState.dice_1 === 6
                      ? "Dodatkowy rzut!"
                      : "Ostatni rzut"
                    : "Rzuć kostką"}
                </p>

                {gameState.turn_phase ===
                  "decision" && (
                  <p className="max-w-full shrink-0 break-words rounded-lg border border-slate-300 bg-white/90 px-3 py-1 text-[clamp(10px,2.5vw,15px)] font-bold leading-tight text-slate-900">
                    {fields[activePosition]?.name ??
                      "Pole"}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
