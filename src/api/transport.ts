// Choix du transport à l'exécution : cookie sur la même origine dans un
// navigateur, jeton Bearer dans l'application native (la WebView bloquerait
// le cookie d'une API sur un autre domaine).
import { Capacitor } from '@capacitor/core'
import * as web from './transport-web'
import * as app from './transport-native'

const impl = Capacitor.isNativePlatform() ? app : web

export const native = impl.native
export const send = impl.send
export const login = impl.login
export const logout = impl.logout
