<script setup lang="ts">
import { ref } from 'vue'
import { inviteMember, type InviteRole } from '../../api/families'
import { useT } from '../../composables/useT'
import { familyErrorText } from '../../lib/familyErrors'
import AppButton from '../ui/AppButton.vue'
import FormField from '../ui/FormField.vue'

const emit = defineEmits<{ sent: [] }>()
const t = useT()
const email = ref('')
const role = ref<InviteRole>('member')
const busy = ref(false)
const error = ref('')
const done = ref('')

async function submit() {
  if (busy.value || !email.value.trim()) return
  busy.value = true
  error.value = ''
  done.value = ''
  try {
    const invitation = await inviteMember(email.value.trim(), role.value)
    done.value = t.value.family.invited(invitation.email)
    email.value = ''
    emit('sent')
  } catch (e) {
    error.value = familyErrorText(e, t.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="card" @submit.prevent="submit">
    <h2>{{ t.family.inviteTitle }}</h2>
    <p class="lead">{{ t.family.inviteLead }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="done" class="done" role="status">{{ done }}</p>
    <FormField id="invite-email" :label="t.family.emailLabel" v-slot="{ control }">
      <input v-bind="control" v-model="email" class="input" type="email" autocomplete="off" required data-selectable />
    </FormField>
    <FormField id="invite-role" :label="t.family.roleLabel" v-slot="{ control }">
      <select v-bind="control" v-model="role" class="input">
        <option value="member">{{ t.family.roles.member }}</option>
        <option value="manager">{{ t.family.roles.manager }}</option>
      </select>
    </FormField>
    <AppButton type="submit" :disabled="busy || !email.trim()">{{ t.family.invite }}</AppButton>
  </form>
</template>

<style scoped>
h2 {
  margin: 0 0 6px;
}
.lead {
  margin: 0 0 16px;
  color: var(--text-soft);
}
.done {
  margin: 0 0 16px;
  font-weight: 700;
  color: var(--accent);
}
</style>
