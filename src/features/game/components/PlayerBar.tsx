
"use client";

import { useState } from "react";
import type { Player } from "../types";
import { pawnIcon } from "../config";
import { getPlayerColor, getPlayerFieldColor } from "../gameTheme";

type PlayerBarProps = {
  players: Player[];
  currentPlayerId?: string | null;
  myId?: string | null;
  balances: Record<string, number>;
  netWorthByPlayer: Record<string, number>;
};

export function PlayerBar({
  players,
  currentPlayerId,
  myId,
  balances,
  netWorthByPlayer,
}: PlayerBarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const playerIds = players.map((p) => p.player_id);

  return (
    <div className="w-full px-2 py-1">
      <div className="grid grid-cols-4 gap-1">
        {players.map((player) => {
          const color = getPlayerColor(player.player_id, playerIds);
          const background = getPlayerFieldColor(player.player_id, playerIds);
          const active = currentPlayerId === player.player_id;
          const expanded = expandedId === player.player_id;
          const cash = Number(balances[player.player_id] ?? 0);
          const netWorth = Number(netWorthByPlayer[player.player_id] ?? 0);

          return (
            <button
              key={player.player_id}
              type="button"
              onClick={() => setExpandedId(expanded ? null : player.player_id)}
              className="flex min-w-0 flex-col items-center gap-1 rounded-lg border-2 px-1 py-1.5 text-center"
              style={{
                borderColor: color,
                background,
                boxShadow: active ? `0 0 0 2px ${color}55` : undefined,
              }}
              title={player.nickname}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-lg"
                style={{ backgroundColor: color }}
              >
                {pawnIcon(player.pawn_id)}
              </span>

              <span className="w-full truncate text-[10px] font-black text-slate-900">
                {player.nickname}
                {player.player_id === myId ? " (Ty)" : ""}
              </span>

              <span className="text-[11px] font-bold text-emerald-900">
                ${cash.toLocaleString("en-US")}
              </span>

              {player.is_bankrupt && <span className="text-xs">💀</span>}
            </button>
          );
        })}
      </div>

      {expandedId && (() => {
        const player = players.find((p) => p.player_id === expandedId);
        if (!player) return null;

        return (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">
            <div className="font-bold">{player.nickname}</div>
            <div>Gotówka: ${Number(balances[player.player_id] ?? 0).toLocaleString("en-US")}</div>
            <div>Majątek: ${Number(netWorthByPlayer[player.player_id] ?? 0).toLocaleString("en-US")}</div>
          </div>
        );
      })()}
    </div>
  );
}
