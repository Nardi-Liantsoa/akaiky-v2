<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'
import { useT } from '../composables/useT'

// QR d'enrôlement généré dans le navigateur : le secret ne transite jamais
// par un service d'image externe.
const props = defineProps<{ secret: string, account: string, issuer: string }>()
const src = ref('')
const t = useT()
watchEffect(async () => {
  const label = encodeURIComponent(`${props.issuer}:${props.account}`)
  const uri = `otpauth://totp/${label}?secret=${props.secret}&issuer=${encodeURIComponent(props.issuer)}&algorithm=SHA1&digits=6&period=30`
  src.value = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
})
</script>

<template>
  <img v-if="src" :src="src" width="220" height="220" :alt="t.mfa.qrAlt" />
</template>
