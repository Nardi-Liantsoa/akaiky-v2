// Temps restant avant `expiresAt`, en « m:ss », et null une fois expiré (ou date illisible).
export function remaining(expiresAt: string, now: number): string | null {
  const end = Date.parse(expiresAt)
  if (Number.isNaN(end)) return null
  const seconds = Math.ceil((end - now) / 1000)
  if (seconds <= 0) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
