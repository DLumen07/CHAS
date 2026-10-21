/* The audit trail's writer.

   One function, used by every route that changes anything. It is deliberately
   fire-and-forget: an audit write that fails must not roll back the
   measurement the nurse just typed. Losing a log line is bad; losing a child's
   weight because the log table was locked is worse.

   THE PRIVACY RULE, and it is the reason this is a function rather than an
   inline db.auditEntry.create() at each call site: `detail` may carry ids,
   counts and enum values, and never a learner's name, LRN, birth date, height
   or weight. Logs get copied into tickets, pasted into chat and shipped to
   whatever aggregates the host's stdout - they must not become a second place
   minors' identifying data lives. Passing a whole learner object here is the
   easy mistake, so the type does not allow one. */

import { db } from '../db.js'

/** Values an audit detail is allowed to hold. Not `any`, on purpose. */
type Scalar = string | number | boolean | null

export interface AuditInput {
  actorId: string | null
  action: string
  targetType?: string
  targetId?: string
  detail?: Record<string, Scalar>
  ipAddress?: string
}

export function audit(entry: AuditInput): void {
  void db.auditEntry
    .create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        detail: entry.detail ?? undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    })
    .catch((err: unknown) => {
      /* Logged, not thrown. See above. */
      console.error('[chas] audit write failed:', err instanceof Error ? err.message : err)
    })
}
