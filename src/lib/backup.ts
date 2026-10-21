/* The installed app's backup and restore, reached through the Electron
   bridge (electron/preload.cjs -> main.cjs -> server/desktop.ts).

   Only the installed app has a database on this machine to copy. In a plain
   browser tab, or the dev window, `backupBridge` is undefined and the screen
   says where the feature works instead of offering a button that cannot. */

export interface RestoreOutcome {
  ok: boolean
  at: string
  from: string
  backupDate: string | null
  message?: string
}

export type BackupResult =
  | { ok: true; folder: string; createdAt: string; learners: number; measurements: number }
  | { ok: false; reason: 'canceled' | 'unavailable' | 'error'; message?: string }

export type RestoreResult =
  | { ok: true }
  | { ok: false; reason: 'canceled' | 'unavailable' | 'error'; message?: string }

/** The newest automatic backup, made when CHAS last closed. */
export interface AutomaticBackup {
  createdAt: string
  learners: number
  measurements: number
}

interface BackupBridge {
  status: () => Promise<{
    available: boolean
    lastRestore: RestoreOutcome | null
    lastAutomatic: AutomaticBackup | null
  }>
  create: () => Promise<BackupResult>
  restore: () => Promise<RestoreResult>
}

export const backupBridge: BackupBridge | undefined =
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { chas?: { backup?: BackupBridge } }).chas?.backup
