export const clinicTimeZone = "Asia/Kolkata";
export function clinicDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: clinicTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function dayRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid clinic date");
  const start = new Date(`${day}T00:00:00+05:30`);
  if (!Number.isFinite(start.getTime()) || clinicDate(start) !== day)
    throw new Error("Invalid clinic date");
  return { start, end: new Date(start.getTime() + 86400000) };
}
export function displayTime(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: clinicTimeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
export function localInput(date: Date) {
  return new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 16);
}
export function fromLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Invalid clinic date/time");
  const [day, time] = value.split("T");
  dayRange(day);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Invalid clinic date/time");
  return `${value}:00+05:30`;
}
