import { useEffect, useState } from "react";
import { isoDateSchema } from "@flowcontext/domain";
import type { PlatformPort } from "../../platform/PlatformPort";

function validDate(value: string | null, fallback: string): string {
  return value && isoDateSchema.safeParse(value).success ? value : fallback;
}

function queryDate(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("date");
}

export function useSelectedDate(mode: "web" | "desktop", platform: PlatformPort): [string, (value: string) => void] {
  const today = platform.today();
  const [selectedDate, setSelectedDate] = useState(() => mode === "web" ? validDate(queryDate(), today) : today);

  useEffect(() => {
    if (mode === "desktop") {
      setSelectedDate(today);
      return;
    }
    const handlePopState = () => setSelectedDate(validDate(queryDate(), today));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [mode, today]);

  function changeDate(value: string) {
    const next = validDate(value, today);
    setSelectedDate(mode === "desktop" ? today : next);
    if (mode === "web" && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("date", next);
      window.history.replaceState({}, "", url);
    }
  }

  return [mode === "desktop" ? today : selectedDate, changeDate];
}
