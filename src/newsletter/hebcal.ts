/**
 * Shabbat and Yom Tov detection for readers who asked to hold those issues.
 * Date-based on the civil date (the site's convention throughout); a Friday
 * evening send is not held. Israel keeps one day of Yom Tov, the diaspora two;
 * the subscriber's timezone decides which calendar applies.
 */
import { HebrewCalendar, flags } from "@hebcal/core";

export function isIsraelTz(tz: string): boolean {
  return tz === "Asia/Jerusalem" || tz === "Asia/Tel_Aviv" || tz === "Israel";
}

/** True on Shabbat and on days of Yom Tov (the festival days on which work is forbidden), for the given calendar. */
export function isRestDay(date: Date, israel: boolean): boolean {
  if (date.getDay() === 6) return true;
  const events = HebrewCalendar.getHolidaysOnDate(date, israel) ?? [];
  return events.some((e) => (e.getFlags() & flags.CHAG) !== 0);
}
