import { useEffect, useState } from "react";

/**
 * Parses typed time into 24-hour "HH:MM" / "HH:MM:SS". Accepts "13:39",
 * "13:39:45", "1339", "133945", "9", "9:5", and 12-hour forms like "1:39pm"
 * / "1:39 PM". Returns "" for empty input and null when it isn't a valid time.
 */
export function parseTime24(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  const ampm = /\s*([ap])\.?\s*m?\.?$/.exec(s);
  const body = ampm ? s.slice(0, ampm.index).trim() : s;

  let parts: string[];
  if (/^\d{1,6}$/.test(body)) {
    // Digits only: 9 → 9, 930 → 9:30, 1339 → 13:39, 133945 → 13:39:45.
    if (body.length <= 2) parts = [body];
    else if (body.length <= 4) parts = [body.slice(0, -2), body.slice(-2)];
    else parts = [body.slice(0, -4), body.slice(-4, -2), body.slice(-2)];
  } else {
    parts = body.split(/[:.]/);
    if (parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  }

  let h = Number(parts[0]);
  const m = parts[1] !== undefined ? Number(parts[1]) : 0;
  const sec = parts[2] !== undefined ? Number(parts[2]) : null;
  if (m > 59 || (sec !== null && sec > 59)) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm[1] === "p" && h < 12) h += 12;
    if (ampm[1] === "a" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return sec !== null ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}`;
}

/**
 * Live input mask: digits only, colons inserted automatically, at most
 * HH:MM:SS. A digit that would make hours > 23 or minutes/seconds > 59 is
 * dropped, and a first digit that can't start a 2-digit value (3-9 for hours,
 * 6-9 for minutes/seconds) gets a leading 0 — so "9" becomes "09".
 */
export function maskTime24(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const maxes = [23, 59, 59];
  const segs: string[] = [];
  let seg = "";
  for (const d of digits) {
    if (segs.length === 3) break;
    const max = maxes[segs.length];
    if (seg === "") {
      if (Number(d) > Math.floor(max / 10)) segs.push(`0${d}`);
      else seg = d;
    } else if (Number(seg + d) <= max) {
      segs.push(seg + d);
      seg = "";
    }
  }
  if (seg && segs.length < 3) segs.push(seg);
  return segs.join(":");
}

/** 24-hour time text input — no AM/PM picker. Typing is masked to a valid
 *  HH:MM:SS as you go; each valid value is passed up immediately (so a Save
 *  click never misses it) and tidied to HH:MM / HH:MM:SS on blur. */
export function TimeInput24({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const invalid = parseTime24(draft) === null;

  const commitDraft = () => {
    const parsed = parseTime24(draft);
    if (parsed === null) {
      setDraft(value);
      return;
    }
    setDraft(parsed);
    if (parsed !== value) onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={8}
      placeholder="HH:MM"
      value={draft}
      title="24-hour time — type digits, e.g. 1339 → 13:39 or 133945 → 13:39:45"
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => {
        const masked = maskTime24(e.target.value);
        setDraft(masked);
        const parsed = parseTime24(masked);
        if (parsed !== null && parsed !== value) onChange(parsed);
      }}
      onBlur={() => {
        setFocused(false);
        commitDraft();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
      }}
      className={`${className} ${invalid ? "border-red-500 focus:border-red-500" : ""}`}
    />
  );
}
