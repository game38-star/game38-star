
import { supabase } from "@/src/lib/supabase/client";
import { getOrCreatePlayer } from "./players";

// Tworzenie pokoju razem z gospodarzem
export async function createRoom(nickname: string) {
  await getOrCreatePlayer();

  const { data, error } = await supabase.rpc(
    "create_game_room",
    {
      p_nickname: nickname.trim(),
    }
  );

  if (error) {
    throw new Error(
      "Nie udało się utworzyć pokoju: " + error.message
    );
  }

  return data;
}

// Wyszukiwanie pokoju po kodzie

export async function findRoom(code: string) {
  // Najpierw zapewnij aktywną sesję gracza
  await getOrCreatePlayer();

  const normalizedCode = code.trim().toUpperCase();

  if (!normalizedCode) {
    throw new Error("Wpisz kod pokoju.");
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("id, code, host_id, status, max_players")
    .eq("code", normalizedCode)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Błąd wyszukiwania pokoju: " + error.message
    );
  }

  if (!data) {
    throw new Error(
      "Nie znaleziono pokoju o kodzie: " + normalizedCode
    );
  }

  return data;
}

// Dołączanie do pokoju
export async function joinRoom(
  code: string,
  nickname: string
) {
  await getOrCreatePlayer();

  const { data, error } = await supabase.rpc(
    "join_game_room",
    {
      p_code: code.trim().toUpperCase(),
      p_nickname: nickname.trim(),
    }
  );

  if (error) {
    throw new Error(
      "Nie udało się dołączyć: " + error.message
    );
  }

  return data;
}

// Rozpoczynanie gry
export async function startRoom(roomId: string) {
  await getOrCreatePlayer();

  const { data, error } = await supabase.rpc(
    "start_game_room",
    {
      p_room_id: roomId,
    }
  );

  if (error) {
    throw new Error(
      "Nie udało się rozpocząć gry: " + error.message
    );
  }

  return data;
}

// Opuszczanie pokoju
export async function leaveRoom(roomId: string) {
  await getOrCreatePlayer();

  const { error } = await supabase.rpc(
    "leave_game_room",
    {
      p_room_id: roomId,
    }
  );

  if (error) {
    throw new Error(
      "Nie udało się opuścić pokoju: " + error.message
    );
  }
}
