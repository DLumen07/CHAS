/* Which store the app is running on.

   Its own module, imported by both `records.ts` and `server-records.ts`.
   It lived in records.ts, which server-records.ts then had to import from -
   while records.ts imports the hook back out of server-records.ts. That is an
   import cycle carrying a VALUE, and ESM resolves those by handing whichever
   module evaluates second an `undefined` binding for a moment. A boolean that
   is briefly undefined here means the app briefly believes it has no server.
   One tiny leaf module both sides depend on, and there is no cycle to reason
   about.

   `VITE_CHAS_BACKEND=server` means PostgreSQL behind the API is the source of
   truth. Anything else - including unset - means the original local store:
   the Electron JSON file, or localStorage in a plain browser.

   An EXPLICIT flag rather than "is VITE_API_URL set" or "are we in dev".
   Both were tried and both are wrong. Keying on VITE_API_URL makes the
   same-origin deployment - where the API is served from the app's own origin
   and the variable is correctly empty - fall back to localStorage and
   silently lose every write. Keying on DEV makes `dev:renderer` demand a
   database, which is precisely what that command exists not to need.

   Read at BUILD time, never probed at runtime. A probe would mean the app
   boots not knowing what it is and behaves differently depending on whether
   the network happened to be up in that instant. A build is one thing or the
   other. */
export const SERVER_BACKED = import.meta.env.VITE_CHAS_BACKEND === 'server'
