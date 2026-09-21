/** A short list for the form's <select>; the browser's own zone is added when it is not here. Any IANA zone Intl accepts is stored. */
export const TIMEZONES: string[] = [
  "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Vancouver", "America/Denver", "America/Phoenix", "America/Chicago",
  "America/Mexico_City", "America/New_York", "America/Toronto", "America/Detroit", "America/Bogota", "America/Lima", "America/Caracas",
  "America/Halifax", "America/Santiago", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/St_Johns",
  "Atlantic/Azores", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Brussels", "Europe/Amsterdam",
  "Europe/Berlin", "Europe/Zurich", "Europe/Rome", "Europe/Madrid", "Europe/Stockholm", "Europe/Warsaw", "Europe/Budapest", "Europe/Vienna",
  "Europe/Athens", "Europe/Kiev", "Europe/Istanbul", "Europe/Moscow", "Asia/Jerusalem", "Africa/Johannesburg", "Africa/Cairo",
  "Asia/Dubai", "Asia/Tehran", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong",
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney",
  "Australia/Melbourne", "Pacific/Auckland", "UTC",
];

/** True when Intl knows the zone (the same test the site uses for ?tz=). */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}
