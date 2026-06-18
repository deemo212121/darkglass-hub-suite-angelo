/**
 * Visit time frames. Replaces the old AM/PM/ANYTIME slots.
 * A ticket's time_slot now holds one of these frame labels (e.g. "8-12").
 * "ANYTIME" is kept as a catch-all bucket for tickets not yet assigned a frame.
 */
export const TIME_FRAMES = [
  "8-12",
  "9-1",
  "10-2",
  "11-3",
  "12-4",
  "1-5",
  "2-6",
  "3-7",
  "4-8",
] as const;

export type TimeFrame = (typeof TIME_FRAMES)[number] | "ANYTIME";

// Representative start time (24h "HH:MM") for each frame — used for map/sort.
export const FRAME_START_TIME: Record<string, string> = {
  "8-12": "08:00",
  "9-1": "09:00",
  "10-2": "10:00",
  "11-3": "11:00",
  "12-4": "12:00",
  "1-5": "13:00",
  "2-6": "14:00",
  "3-7": "15:00",
  "4-8": "16:00",
  ANYTIME: "17:30",
};
