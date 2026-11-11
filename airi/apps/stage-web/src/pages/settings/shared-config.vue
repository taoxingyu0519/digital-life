<script setup lang="ts">
import { useSharedSettingsStore } from '@proj-airi/stage-ui/stores/shared-settings'
import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settings = useSharedSettingsStore()
</script>

<template>
  <div flex="~ col gap-5">
    <p text="sm neutral-600 dark:neutral-300">
      {{ t('settings.shared-config.scope') }}
    </p>
    <div border="1 neutral-200 dark:neutral-700" rounded-xl p-5 flex="~ col gap-3">
      <strong role="status">{{ t(`settings.shared-config.states.${settings.state}`) }}</strong>
      <span text-sm>{{ t('settings.shared-config.revision', { revision: settings.revision }) }}</span>
      <p v-if="settings.conflicting" text-sm>
        {{ t('settings.shared-config.conflict-help') }}
      </p>
      <div flex="~ wrap gap-3">
        <template v-if="settings.conflicting">
          <Button @click="settings.useHost()">
            {{ t('settings.shared-config.use-host') }}
          </Button>
          <Button @click="settings.useLocal()">
            {{ t('settings.shared-config.use-local') }}
          </Button>
        </template>
        <Button v-else @click="settings.refresh()">
          {{ t('settings.shared-config.refresh') }}
        </Button>
        <Button v-if="settings.state === 'empty' && !settings.conflicting" @click="settings.useLocal()">
          {{ t('settings.shared-config.use-local') }}
        </Button>
      </div>
    </div>
    <p text-sm>
      {{ t('settings.shared-config.device-help') }}
    </p>
    <div v-if="settings.backupAt" border="1 neutral-200 dark:neutral-700" rounded-xl p-5 flex="~ col gap-3">
      <span text-sm>{{ t('settings.shared-config.backup', { date: new Date(settings.backupAt).toLocaleString() }) }}</span>
      <p text-sm>
        {{ t('settings.shared-config.backup-help') }}
      </p>
      <Button @click="settings.restoreBackup()">
        {{ t('settings.shared-config.restore') }}
      </Button>
    </div>
    <p text-sm>
      {{ t('settings.shared-config.old-origin') }}
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  settingsEntry: true
  titleKey: settings.shared-config.title
  descriptionKey: settings.shared-config.description
  icon: i-solar:refresh-circle-bold-duotone
  order: 15
</route>
