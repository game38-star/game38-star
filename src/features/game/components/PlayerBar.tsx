
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
  turnSeconds?: number;
  timerActive?: boolean;
};

export function PlayerBar({
  players,
  currentPlayerId,
  myId,
  balances,
  netWorthByPlayer,
  turnSeconds = 60,
  timerActive = false,
}: PlayerBarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const ids = players.map((p) => p.player_id);
  const selected = players.find((p) => p.player_id === expandedId);
  const money = (value: number) => `$${value.toLocaleString("en-US")}`;

  return (
    <div className="w-full px-2 py-1">
      <div className="grid grid-cols-4 gap-1.5">
        {players.map((p) => {
          const color = getPlayerColor(p.player_id, ids);
          const bg = getPlayerFieldColor(p.player_id, ids);
          const active = currentPlayerId === p.player_id;
          const showTimer = active && timerActive;
          const cash = Number(balances[p.player_id] ?? 0);

          return (
            <button
              key={p.player_id}
              type="button"
              onClick={() =>
                setExpandedId(expandedId === p.player_id ? null : p.player_id)
              }
              className="flex min-w-0 flex-col items-center rounded-xl border-2 px-1 py-1.5 text-center transition-all"
              style={{
                background: bg,
                borderColor: color,
                boxShadow: active ? `0 0 0 1px ${color}` : undefined,
              }}
            >
              <span className="relative grid h-10 w-10 shrink-0 place-items-center">
                {showTimer && (
                  <svg
                    className="absolute inset-0 h-10 w-10 -rotate-90"
                    viewBox="0 0 40 40"
                    aria-label={`Pozostało ${turnSeconds} sekund`}
                  >
                    <circle cx="20" cy="20" r="17" fill="none"
                      stroke="#ffffff80" strokeWidth="3" />
                    <circle cx="20" cy="20" r="17" fill="none"
                      stroke={turnSeconds <= 10 ? "#fb7185" : turnSeconds <= 20 ? "#fbbf24" : "#34d399"}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 17}
                      strokeDashoffset={
                        2 * Math.PI * 17 *
                        (1 - Math.max(0, Math.min(60, turnSeconds)) / 60)
                      }
                      style={{ transition: "stroke-dashoffset 250ms linear" }}
                    />
                  </svg>
                )}
                <span
                  className="relative grid h-8 w-8 place-items-center rounded-full border-2 border-white text-lg shadow-sm"
                  style={{ backgroundColor: color }}
                >
                  {pawnIcon(p.pawn_id)}
                </span>
              </span>

              <span className="w-full truncate text-[10px] font-black text-slate-950">
                {p.nickname}
              </span>
              <span className="text-[11px] font-black text-emerald-900">
                {money(cash)}
              </span>
              {p.is_bankrupt && <span className="text-xs">💀</span>}
            </button>
          );
        })}
      </div>

      {selected && (() => {
        const color = getPlayerColor(selected.player_id, ids);
        const bg = getPlayerFieldColor(selected.player_id, ids);
        const cash = Number(balances[selected.player_id] ?? 0);
        const worth = Number(netWorthByPlayer[selected.player_id] ?? 0);
        const assets = worth - cash;
        const progress = Math.max(0, Math.min(100, (worth / 7000) * 100));

        return (
          <section
            className="mt-2 overflow-hidden rounded-xl border-2 shadow-sm"
            style={{ borderColor: color, background: bg }}
          >
            <div className="flex items-center gap-3 border-b border-black/10 p-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-white text-2xl shadow-sm"
                style={{ backgroundColor: color }}
              >
                {pawnIcon(selected.pawn_id)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-950">
                  {selected.nickname}
                  {selected.player_id === myId ? " (Ty)" : ""}
                </p>
                <p className="text-[10px] font-bold text-slate-700">
                  {selected.is_bankrupt
                    ? "💀 Bankrut"
                    : selected.player_id === currentPlayerId
                      ? "🎲 Aktualna tura"
                      : "Gracz CITY ROLL"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                className="rounded-lg bg-white/70 px-2.5 py-1 text-sm font-bold text-slate-800"
                aria-label="Zamknij szczegóły"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3">
              {[
                ["GOTÓWKA", cash],
                ["NIERUCHOMOŚCI", assets],
                ["MAJĄTEK", worth],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0 rounded-lg bg-white/75 px-1 py-2 text-center shadow-sm">
                  <p className="text-[8px] font-extrabold text-slate-600">
                    {label}
                  </p>
                  <p className="mt-1 text-[11px] font-black text-slate-950">
                    {money(Number(value))}
                  </p>
                </div>
              ))}
            </div>

            <div className="px-3 pb-3">
              <div className="mb-1 flex justify-between text-[10px] font-bold text-slate-800">
                <span>Postęp do $7,000</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full bg-amber-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
