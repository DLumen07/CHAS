/* Prisma's own configuration.

   The `prisma` key in package.json is deprecated and removed in Prisma 7, so
   the seed command lives here instead. Doing it now rather than at the
   upgrade means one less thing that breaks on a major bump. */

import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    /* `prisma migrate dev` and `migrate reset` run this. It is idempotent, so
       re-running is safe. */
    seed: 'tsx prisma/seed.ts',
  },
})
