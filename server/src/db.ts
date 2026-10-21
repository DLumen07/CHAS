/* One Prisma client for the process.

   Instantiated at module scope rather than per request. Each client holds its
   own connection pool, and a new one per request exhausts Postgres's
   max_connections in a few seconds under any real load - which on a managed
   host is a hard limit measured in tens, not thousands.

   `tsx watch` reloads this module on every save in development and would leak
   a pool each time, so the client is stashed on globalThis there. In
   production the module is loaded once and the guard costs nothing. */

import { PrismaClient } from '@prisma/client'
import { isProd } from './env.js'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    /* Queries are logged in development only. A query log in production would
       put learner ids - and, on a bad WHERE clause, values - into whatever
       aggregates the host's stdout. */
    log: isProd ? ['warn', 'error'] : ['query', 'warn', 'error'],
  })

if (!isProd) globalForPrisma.prisma = db
