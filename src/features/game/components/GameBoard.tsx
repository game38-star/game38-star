"use client";

import type { Player, Property, GameState } from "../types";
import { fields, getPosition, pawnIcon } from "../config";
import { Dice3D } from "./Dice3D";

export function GameBoard({ players, properties, gameState, animatedPositions, currentPlayer, activePosition, diceRolling, hasDice, onSelectProperty }: {
  players: Player[]; properties: Property[]; gameState: GameState; animatedPositions: Record<string, number>;
  currentPlayer: Player | undefined; activePosition: number; diceRolling: boolean; hasDice: boolean;
  onSelectProperty?: (fieldId: number) => void;
}) {
  const nameOf = (id: string) => players.find(p => p.player_id === id)?.nickname ?? "Gracz";
  const events: { text: string; amount?: string }[] = [];
  if (gameState.last_rent) {
    const rent = gameState.last_rent;
    events.push({ text: `💸 ${nameOf(rent.from_player)} zapłacił(a) ${nameOf(rent.to_player)} za ${fields[rent.field_id]?.name ?? "nieruchomość"}`, amount: `−$${rent.amount}` });
  }
  if (gameState.last_start_bonus) {
    events.push({ text: `💰 ${nameOf(gameState.last_start_bonus.player_id)} otrzymał(a) premię START`, amount: `+$${gameState.last_start_bonus.amount}` });
  }

  return (
    <div className="px-1 sm:px-2">
      <div className="grid aspect-square grid-cols-8 grid-rows-8 gap-[1px] overflow-hidden rounded-xl border border-white/10 bg-[#060b15] p-[2px] shadow-[0_14px_45px_rgba(0,0,0,0.35)]">
        {fields.map((field) => {
          const pos = getPosition(field.id);
          const owner = properties.find((p) => p.field_id === field.id);
          const ownerPlayer = players.find((p) => p.player_id === owner?.owner_id);
          const pawns = players.filter((player) => !player.is_bankrupt && (animatedPositions[player.player_id] ?? gameState.positions?.[player.player_id] ?? 0) === field.id);
          const isActive = activePosition === field.id;
          const isSpecial = field.price === null;
          return (
            <button key={field.id} type="button" disabled={!owner || !onSelectProperty} onClick={() => onSelectProperty?.(field.id)}
              style={{ gridRow: pos.row, gridColumn: pos.col, borderTopColor: isSpecial ? "#fbbf24" : field.color }}
              title={`${field.name}${field.price !== null ? ` • $${field.price}` : ""}${ownerPlayer ? ` • właściciel: ${ownerPlayer.nickname}` : ""}`}
              className={`relative flex min-h-0 min-w-0 flex-col items-center justify-between overflow-hidden rounded-[5px] border border-t-[4px] px-[1px] py-[2px] text-center disabled:cursor-default ${owner ? "cursor-pointer" : ""} ${isActive ? "border-x-amber-300/70 border-b-amber-300/70 bg-[#34435a]" : "border-x-white/5 border-b-white/5 bg-[#1a283b]"}`}>
              <span className="w-full break-words text-center text-[clamp(6px,1.8vw,11px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-100">{field.name}</span>
              <div className="flex min-h-0 flex-col items-center justify-end gap-0">
                {field.icon && <span className="text-[clamp(10px,2.8vw,17px)] leading-none">{field.icon}</span>}
                {field.price !== null && <span className="text-[clamp(7px,1.9vw,11px)] font-black leading-none text-amber-200">${field.price}</span>}
                {ownerPlayer && <span className="rounded bg-black/35 px-[2px] text-[clamp(9px,2.3vw,14px)] leading-none" title={`Właściciel: ${ownerPlayer.nickname} • zabudowa: ${owner?.building_level ?? 0}`}>
                  {pawnIcon(ownerPlayer.pawn_id)}
                </span>}
                {pawns.length > 0 && <div className="flex max-w-full flex-wrap justify-center gap-0 leading-none">{pawns.map((player) => <span key={`${player.player_id}-${animatedPositions[player.player_id] ?? "idle"}`} title={player.nickname} className={`inline-block origin-bottom text-[clamp(13px,3.3vw,21px)] leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)] ${animatedPositions[player.player_id] !== undefined ? "bankroll-pawn-hop" : ""}`}>{pawnIcon(player.pawn_id)}</span>)}</div>}
              </div>
            </button>
          );
        })}
        <div style={{ gridRow: "2 / 8", gridColumn: "2 / 8" }} className="relative flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-sky-200/10 bg-[radial-gradient(circle_at_50%_20%,#2d4663_0%,#18263c_50%,#101b2e_100%)] p-2 text-center">
          <h2 className="text-[clamp(10px,3.3vw,15px)] font-black tracking-wide text-amber-200">📣 WYDARZENIA</h2>
          <div className="w-full max-w-[95%] space-y-1">
            {events.length ? events.map((event, index) => <div key={index} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[clamp(8px,2.1vw,11px)] text-slate-100"><span>{event.text}</span> <strong className="text-amber-200">{event.amount}</strong></div>) : <p className="text-[clamp(8px,2.1vw,11px)] text-slate-400">Czekamy na wydarzenia w grze</p>}
          </div>
          <p className="max-w-[95%] truncate text-[clamp(8px,2.1vw,11px)] text-slate-300">{currentPlayer?.nickname ?? "Oczekiwanie"} • {gameState.turn_phase === "roll" ? "rzut kostkami" : "decyzja"}</p>
          <div className="flex items-center gap-2">{[gameState.dice_1, gameState.dice_2].map((die, i) => <Dice3D key={i} value={die} rolling={diceRolling} />)}</div>
          <p className="text-[clamp(9px,2.3vw,12px)] font-bold text-amber-200">{diceRolling ? "🎲 Kostki się toczą..." : hasDice ? `Wynik: ${gameState.dice_1! + gameState.dice_2!}` : "Czekamy na pierwszy rzut"}</p>
        </div>
      </div>
    </div>
  );
}
