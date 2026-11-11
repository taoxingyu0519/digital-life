import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { createStorage } from 'unstorage'

export const storage = createStorage({
  driver: memoryDriver(),
})

function indexedDbNamespace(base: string) {
  const driver = indexedDbDriver({ base })
  const prefix = `${base}:`
  return {
    ...driver,
    // NOTICE:
    // The installed IndexedDB driver returns physical keys, including its base and other namespaces.
    // unstorage expects relative keys. Strip this namespace before its mount filtering.
    // Source: unstorage/drivers/indexedb.mjs. Remove when the driver returns scoped, relative keys.
    async getKeys() {
      const keys = await driver.getKeys!('', {})
      return keys.filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))
    },
  }
}

storage.mount('local', indexedDbNamespace('airi-local'))
storage.mount('outbox', indexedDbNamespace('airi-sync-queue'))
