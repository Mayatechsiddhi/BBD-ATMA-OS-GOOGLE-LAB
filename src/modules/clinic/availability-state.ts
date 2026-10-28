export type AvailabilityState = {
  error?: string;
  slots?: { startsAt: string; endsAt: string; resource: string }[];
};
