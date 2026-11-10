export type Player = { player_id: string; nickname: string; color: string; joined_at: string; is_bankrupt: boolean; pawn_id: number | null };
export type RoomStatus = { status: string; winner_id: string | null };
export type Property = { field_id: number; owner_id: string; building_level: number };
export type GameState = {
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
