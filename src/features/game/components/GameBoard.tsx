"use client";

import type { Player, Property, GameState } from "../types";
import { fields, getPosition, playerAccents, pawnIcon } from "../config";
import { Dice3D } from "./Dice3D";

export function GameBoard({ players, properties, gameState, animatedPositions, currentPlayer, activePosition, diceRolling, hasDice }: {
  players: Player[]; properties: Property[]; gameState: GameState; animatedPositions: Record<string, number>; currentPlayer: Player | undefined; activePosition: number; diceRolling: boolean; hasDice: boolean;
}) {
return (
<>

        <div className="px-2 sm:px-3">
          <div className="grid aspect-square grid-cols-8 grid-rows-8 gap-[2px] overflow-hidden rounded-2xl border border-white/10 bg-[#060b15] p-[3px] shadow-[0_14px_45px_rgba(0,0,0,0.35)]">
            {fields.map((field) => {
              const pos = getPosition(field.id);
              const owner = properties.find((p) => p.field_id === field.id);
              const ownerIndex = players.findIndex((p) => p.player_id === owner?.owner_id);
              const pawns = players.map((p) => ({ player: p })).filter(({ player }) => !player.is_bankrupt && (animatedPositions[player.player_id] ?? gameState.positions?.[player.player_id] ?? 0) === field.id);
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
                    {pawns.length > 0 && <div className="flex max-w-full flex-wrap justify-center gap-0 leading-none">{pawns.map(({ player }) => <span key={`${player.player_id}-${animatedPositions[player.player_id] ?? "idle"}`} title={player.nickname} className={`inline-block origin-bottom text-[clamp(12px,3vw,19px)] leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)] ${animatedPositions[player.player_id] !== undefined ? "bankroll-pawn-hop" : ""}`}>{pawnIcon(player.pawn_id)}</span>)}</div>}
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

</>
);
}
