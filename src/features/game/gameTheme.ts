/** Jeden zestaw kolorów dla paneli graczy, pionków i zakupionych pól. */
export const gameTheme = {
  pageBackground: "#ffffff",
  frameBackground: "#ffffff",
  frameBorder: "#d8e1e9",
  text: "#172033",
} as const;

export const PLAYER_COLORS = ["#E83E8C", "#00A8C6", "#76B900", "#8B5CF6"] as const;
export const PLAYER_FIELD_COLORS = ["#FFE1EE", "#D9F7FC", "#EAF8CF", "#EDE2FF"] as const;

/** Kolejność graczy pochodzi z zapytania room_players (joined_at, player_id). */
export function getPlayerColor(playerId: string | undefined, playerIds: string[]) {
  const index = playerIds.indexOf(playerId ?? "");
  return PLAYER_COLORS[(index < 0 ? 0 : index) % PLAYER_COLORS.length];
}

export function getPlayerFieldColor(playerId: string | undefined, playerIds: string[]) {
  const index = playerIds.indexOf(playerId ?? "");
  return PLAYER_FIELD_COLORS[(index < 0 ? 0 : index) % PLAYER_FIELD_COLORS.length];
}
