"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase/client";

export type GameEvent = {
  id: number;
  room_id: string;
  player_id: string | null;
  event_type: string;
  field_id: number | null;
  amount: number | null;
  description: string | null;
  created_at: string;
};

// PostgreSQL przechowuje mikrosekundy, a Date.parse() je ucina.
// Porównujemy więc znaczniki ISO z pełną precyzją, bez Date.parse().
function timestampMicros(value: string): bigint | null {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i
  );
  if (!match) return null;

  const [, date, time, fraction = "", zone = "Z"] = match;
  const normalizedZone = zone.toUpperCase() === "Z"
    ? "Z"
    : /^[-+]\d{2}$/.test(zone)
      ? `${zone}:00`
      : /^[-+]\d{4}$/.test(zone)
        ? `${zone.slice(0, 3)}:${zone.slice(3)}`
        : zone;

  const seconds = Date.parse(`${date}T${time}${normalizedZone}`);
  if (!Number.isFinite(seconds)) return null;
return BigInt(seconds) * BigInt(1000000) + BigInt((fraction + "000000").slice(0, 6));}

export function useGameEvents(roomId: string) {
  const [event, setEvent] = useState<GameEvent | null>(null);

  useEffect(() => {
    let active = true;
    let requestId = 0;
    setEvent(null);

    async function loadEvent() {
      const currentRequest = ++requestId;
      const [eventsResult, stateResult] = await Promise.all([
        supabase
          .from("game_events")
          .select("id, room_id, player_id, event_type, field_id, amount, description, created_at")
          .eq("room_id", roomId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(30),
        supabase
          .from("game_states")
          .select("notice_cleared_at")
          .eq("room_id", roomId)
          .single(),
      ]);

      if (!active || currentRequest !== requestId) return;
      if (eventsResult.error || stateResult.error) {
        console.error("CITY ROLL — błąd pobierania powiadomień:", {
          eventsError: eventsResult.error,
          stateError: stateResult.error,
        });
        return;
      }

      const clearedAt = stateResult.data?.notice_cleared_at as string | null | undefined;
      const clearedMicros = clearedAt ? timestampMicros(clearedAt) : null;
      const events = (eventsResult.data ?? []) as GameEvent[];
      const visible = events.filter((item) => {
        if (!clearedAt) return true;
        const eventMicros = timestampMicros(item.created_at);
        return eventMicros !== null && clearedMicros !== null && eventMicros > clearedMicros;
      });

      const rentEvent = visible.find((item) => item.event_type === "rent_paid");
      const selectedEvent = rentEvent ?? visible[0] ?? null;

      console.log("CITY ROLL — powiadomienie:", {
        roomId,
        noticeClearedAt: clearedAt,
        visibleEvents: visible,
        rentEvent,
        selectedEvent,
      });
      setEvent(selectedEvent);
    }

    void loadEvent();

    const eventsChannel = supabase.channel(`game-events-${roomId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "game_events", filter: `room_id=eq.${roomId}`,
      }, () => { void loadEvent(); })
      .subscribe();

    const stateChannel = supabase.channel(`game-notice-state-${roomId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_states", filter: `room_id=eq.${roomId}`,
      }, () => { void loadEvent(); })
      .subscribe();

    const interval = setInterval(() => { void loadEvent(); }, 1500);

    return () => {
      active = false;
      clearInterval(interval);
      void supabase.removeChannel(eventsChannel);
      void supabase.removeChannel(stateChannel);
    };
  }, [roomId]);

  return event;
}
