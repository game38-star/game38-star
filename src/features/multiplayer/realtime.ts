import { supabase } from "@/src/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RoomPlayer = {
  id: string;
  room_id: string;
  player_id: string;
  nickname: string;
  color: string;
  pawn_id: number | null;
  is_ready: boolean;
  joined_at: string;
};

// Pobiera również pawn_id, aby lobby mogło pokazać wybraną figurkę.
export async function getRoomPlayers(roomId: string): Promise<RoomPlayer[]> {
  const { data, error } = await supabase
    .from("room_players")
    .select("id, room_id, player_id, nickname, color, pawn_id, is_ready, joined_at")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (error) {
    throw new Error("Nie udało się pobrać graczy: " + error.message);
  }

  return (data ?? []) as RoomPlayer[];
}

export function subscribeToRoomPlayers(
  roomId: string,
  onPlayersChanged: (players: RoomPlayer[]) => void,
  onError?: (message: string) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`room-players-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_players",
        filter: `room_id=eq.${roomId}`,
      },
      async () => {
        try {
          const players = await getRoomPlayers(roomId);
          onPlayersChanged(players);
        } catch (error) {
          onError?.(
            error instanceof Error ? error.message : "Błąd aktualizacji graczy"
          );
        }
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onError?.("Utracono połączenie Realtime");
      }
    });

  return channel;
}

export async function unsubscribeFromRoom(channel: RealtimeChannel) {
  await supabase.removeChannel(channel);
}

export function subscribeToRoomStatus(
  roomId: string,
  onGameStarted: () => void,
  onError?: (message: string) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`room-status-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rooms",
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        const room = payload.new as { id: string; status: string };
        if (room.status === "playing") onGameStarted();
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onError?.("Błąd synchronizacji pokoju");
      }
    });

  return channel;
}
