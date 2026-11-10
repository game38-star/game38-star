
import { supabase } from "@/src/lib/supabase/client";

// Pobiera obecnego gracza lub tworzy anonimowe konto
export async function getOrCreatePlayer() {
  // Sprawdzamy istniejącą sesję
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.warn("Brak aktywnej sesji:", userError.message);
  }

  // Jeżeli gracz już istnieje, zwracamy jego dane
  if (user) {
    return user;
  }

  // Tworzymy anonimowego gracza
  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    throw new Error("Błąd logowania: " + error.message);
  }

  if (!data.user) {
    throw new Error("Nie udało się utworzyć gracza.");
  }

  return data.user;
}

export async function setPlayerReady(
  roomId: string,
  isReady: boolean
) {
  await getOrCreatePlayer();

  const { data, error } = await supabase.rpc(
    "set_player_ready",
    {
      p_room_id: roomId,
      p_is_ready: isReady,
    }
  );

  if (error) {
    throw new Error(
      "Nie udało się zmienić gotowości: " + error.message
    );
  }

  return data;
}
