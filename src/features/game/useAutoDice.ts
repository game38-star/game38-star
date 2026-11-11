"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/src/lib/supabase/client";

type EventRow = {
  id: number;
  player_id: string;
  kind: "auto_roll" | "warning" | "eliminated";
  consecutive_misses: number;
  dice: number | null;
};
type Notice = { playerName: string; kind: string; misses: number; dice: number | null };
type Props = {
  roomId: string;
  enabled: boolean;
  players: { player_id: string; nickname: string }[];
  manualRolling: boolean;
  onGameChanged: () => Promise<void>;
};
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function useAutoDice({ roomId, enabled, players, manualRolling, onGameChanged }: Props) {
  const [autoDiceRolling, setAutoDiceRolling] = useState(false);
  const [autoDiceAnimating, setAutoDiceAnimating] = useState(false);
  const [autoRolledValue, setAutoRolledValue] = useState<number | null>(null);
  const [autoIdleNotice, setAutoIdleNotice] = useState<Notice | null>(null);
  const lastId = useRef<number | null>(null);
  const eventBusy = useRef(false);
  const tickBusy = useRef(false);
  const mounted = useRef(false);
  const manualRef = useRef(manualRolling);
  const playersRef = useRef(players);
  const reloadRef = useRef(onGameChanged);
  useEffect(() => { manualRef.current = manualRolling; }, [manualRolling]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { reloadRef.current = onGameChanged; }, [onGameChanged]);

  const processEvents = useCallback(async () => {
    if (lastId.current === null || eventBusy.current || manualRef.current) return;
    eventBusy.current = true;
    try {
      const { data, error } = await supabase.from("city_roll_inactivity_events")
        .select("id,player_id,kind,consecutive_misses,dice")
        .eq("room_id", roomId).gt("id", lastId.current)
        .order("id", { ascending: true }).limit(20);
      if (error) throw error;
      for (const event of (data ?? []) as EventRow[]) {
        if (!mounted.current) break;
        lastId.current = event.id;
        const value = event.dice;
        const name = playersRef.current.find(p => p.player_id === event.player_id)?.nickname ?? "Gracz";
        if (value !== null && Number.isInteger(value) && value >= 1 && value <= 6) {
          setAutoRolledValue(value);
          setAutoDiceRolling(true);
          setAutoDiceAnimating(true);
          await pause(1400);
          if (!mounted.current) break;
          setAutoDiceAnimating(false);
          await pause(800);
          if (!mounted.current) break;
          setAutoDiceRolling(false);
        }
        setAutoIdleNotice({ playerName: name, kind: event.kind, misses: event.consecutive_misses, dice: value });
        await reloadRef.current();
        await pause(1900);
        if (!mounted.current) break;
        setAutoIdleNotice(null);
        setAutoRolledValue(null);
      }
    } catch (err) {
      console.error("CITY ROLL auto dice:", err);
    } finally {
      eventBusy.current = false;
      if (mounted.current) {
        setAutoDiceRolling(false);
        setAutoDiceAnimating(false);
      }
    }
  }, [roomId]);

  const checkDeadline = useCallback(async () => {
    if (tickBusy.current || manualRef.current) return;
    tickBusy.current = true;
    try {
      const { data: clock, error: clockError } = await supabase.from("city_roll_turn_clock")
        .select("deadline_at").eq("room_id", roomId).maybeSingle();
      if (clockError) throw clockError;
      if (!clock?.deadline_at || Date.now() < Date.parse(clock.deadline_at)) return;
      const { data, error } = await supabase.rpc("city_roll_tick_turn", { p_room_id: roomId });
      if (error) throw error;
      if (data?.changed) {
        await processEvents();
        await reloadRef.current();
      }
    } catch (err) {
      console.error("CITY ROLL timeout:", err);
    } finally {
      tickBusy.current = false;
    }
  }, [roomId, processEvents]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    mounted.current = true;
    lastId.current = null;
    async function initialize() {
      try {
        const { data, error } = await supabase.from("city_roll_inactivity_events")
          .select("id").eq("room_id", roomId).order("id", { ascending: false }).limit(1);
        if (error) throw error;
        if (active) lastId.current = data?.[0]?.id ?? 0;
      } catch (err) {
        console.error("CITY ROLL auto dice init:", err);
        if (active) lastId.current = 0;
      }
    }
    void initialize();
    const eventsTimer = window.setInterval(() => { void processEvents(); }, 850);
    const tickTimer = window.setInterval(() => { void checkDeadline(); }, 1500);
    return () => {
      active = false;
      mounted.current = false;
      clearInterval(eventsTimer);
      clearInterval(tickTimer);
      setAutoDiceRolling(false);
      setAutoDiceAnimating(false);
    };
  }, [enabled, roomId, processEvents, checkDeadline]);

  return { autoDiceRolling, autoDiceAnimating, autoRolledValue, autoIdleNotice };
}
