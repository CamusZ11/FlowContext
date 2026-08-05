import { useCallback, useEffect, useRef, useState } from "react";
import { isoDateSchema } from "@flowcontext/domain";
import type { PlatformPort } from "../../platform/PlatformPort";

function validDate(value: string | null, fallback: string): string {
  return value && isoDateSchema.safeParse(value).success ? value : fallback;
}

function queryDate(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("date");
}

function replaceQueryDate(value: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("date", value);
  window.history.replaceState({}, "", url);
}

export function useSelectedDate(mode: "web" | "desktop", platform: PlatformPort): [string, (value: string) => void] {
  const observedToday = platform.today();
  const [today, setToday] = useState(observedToday);
  const [selectedDate, setSelectedDate] = useState(() => validDate(queryDate(), observedToday));
  const todayRef = useRef(observedToday);
  const selectedDateRef = useRef(selectedDate);

  const refreshToday = useCallback(() => {
    const nextToday = platform.today();
    const previousToday = todayRef.current;
    if (nextToday === previousToday) return;
    todayRef.current = nextToday;
    setToday(nextToday);
    if (selectedDateRef.current === previousToday) {
      selectedDateRef.current = nextToday;
      setSelectedDate(nextToday);
      if (mode === "web") replaceQueryDate(nextToday);
    }
  }, [mode, platform]);

  useEffect(() => {
    refreshToday();
  }, [observedToday, refreshToday]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshToday();
    };
    const interval = window.setInterval(refreshToday, 60_000);
    window.addEventListener("focus", refreshToday);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshToday);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshToday]);

  useEffect(() => {
    if (mode === "desktop") return;
    const handlePopState = () => {
      const next = validDate(queryDate(), today);
      selectedDateRef.current = next;
      setSelectedDate(next);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [mode, today]);

  function changeDate(value: string) {
    const next = validDate(value, today);
    selectedDateRef.current = next;
    setSelectedDate(next);
    if (mode === "web") replaceQueryDate(next);
  }

  return [selectedDate, changeDate];
}
