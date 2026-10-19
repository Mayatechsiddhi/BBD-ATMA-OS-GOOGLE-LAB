export function Message({ error }: { error?: string }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-red-50 p-3 text-sm text-destructive"
    >
      {error.slice(0, 200)}
    </p>
  ) : null;
}
