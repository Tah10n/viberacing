"use client";

import { useEffect, useState } from "react";

export type UserLocalTimeFormat = "race-end" | "timestamp";

interface UserLocalTimeProps {
  readonly dateTime: string;
  readonly fallback: string;
  readonly format: UserLocalTimeFormat;
}

interface LocalTimeDisplay {
  readonly label: string;
  readonly timeZone: string;
}

export function formatUserLocalTime(
  dateTime: string,
  format: UserLocalTimeFormat,
  timeZone: string,
): string {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
    ...(format === "race-end" ? { weekday: "short" as const } : {}),
  };
  const label = new Intl.DateTimeFormat("en-GB", options).format(new Date(dateTime));
  return format === "race-end" ? `Ends ${label}` : label;
}

export function UserLocalTime({ dateTime, fallback, format }: UserLocalTimeProps) {
  const [display, setDisplay] = useState<LocalTimeDisplay | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDisplay({
      label: formatUserLocalTime(dateTime, format, timeZone),
      timeZone,
    });
  }, [dateTime, format]);

  return (
    <time dateTime={dateTime} title={display?.timeZone}>
      {display?.label ?? fallback}
    </time>
  );
}
