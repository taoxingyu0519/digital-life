<script setup lang="ts">
import { Button, FieldInput } from '@proj-airi/ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDeveloperAccessStore } from '../../stores/developer-access'

const access = useDeveloperAccessStore()
const { t } = useI18n()
const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
const prefix = 'settings.memory-admin.'

async function perform(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  }
  catch (reason) {
    error.value = reason instanceof Error && reason.message === 'developer-429'
      ? t(`${prefix}rate-limit`)
      : t(`${prefix}login-error`)
  }
  finally {
    password.value = ''
    busy.value = false
  }
}

onMounted(() => {
  void perform(access.refresh)
})
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <template v-if="access.ready && access.authenticated">
      <div :class="['flex items-center justify-between gap-3']">
        <p>{{ t(`${prefix}authorized`) }}</p>
        <Button :disabled="busy" @click="perform(access.logout)">
          {{ t(`${prefix}logout`) }}
        </Button>
      </div>
      <slot />
    </template>
    <form v-else :class="['flex max-w-lg flex-col gap-4']" @submit.prevent="perform(() => access.login(username, password))">
      <p>{{ t(`${prefix}restricted`) }}</p>
      <FieldInput v-model="username" autocomplete="username" :label="t(`${prefix}username`)" />
      <FieldInput v-model="password" type="password" autocomplete="current-password" :label="t(`${prefix}password`)" />
      <Button type="submit" color="primary" variant="primary" :disabled="busy || !username || !password" :loading="busy">
        {{ t(`${prefix}login`) }}
      </Button>
    </form>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </div>
</template>
