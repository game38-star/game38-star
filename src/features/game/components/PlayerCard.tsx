import type { Player, GameState, Property } from "../types";
import { pawnIcon, playerAccents } from "../config";

export function PlayerCard({ player, index, gameState, myId, properties }: { player: Player; index: number; gameState: GameState; myId: string | null; properties: Property[] }) {
    const isCurrent = gameState.current_turn === player.player_id;
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
          <span className="text-lg font-black tracking-tight" style={{ color: playerAccents[index] ?? "#fff" }}>${(gameState.balances?.[player.player_id] ?? 1500).toLocaleString("en-US")}</span>
          {player.is_bankrupt && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[9px] font-black text-rose-300">BANKRUT</span>}
          {isCurrent && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-black text-[#151b2b]">TURA</span>}
        </div>
      </div>
    );
}
