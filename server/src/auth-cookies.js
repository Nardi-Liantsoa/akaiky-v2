// Cookies d'authentification : préfixe __Host- en production (Secure, Path=/,
// sans Domain), HttpOnly, SameSite=Strict. Le nom n'est jamais lu ailleurs.
export const cookieName = (config, kind) => `${config.production ? '__Host-' : ''}app-${kind}`
// Une requête en transport Bearer (app native, en-tête Authorization) ne lit
// jamais un cookie, quel qu'il soit : elle a échappé au contrôle CSRF.
export function readAuthCookie(req, config, kind) {
  if (req.authTransport === 'bearer') return null
  const name = cookieName(config, kind)
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1)
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null
}
export function appendCookie(reply, value) {
  const current = reply.getHeader('set-cookie')
  reply.header('set-cookie', [...(current ? [].concat(current) : []), value])
}
export function authCookie(reply, config, kind, token, seconds) {
  appendCookie(reply, `${cookieName(config, kind)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.round(seconds)}${config.production ? '; Secure' : ''}`)
}
