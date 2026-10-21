import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SERVER_BACKED } from './lib/backend'
/* The app typeface, bundled with the build: CHAS runs offline, so a font
   fetched from a CDN would silently fall back on a school laptop. */
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'

/* Which store this bundle was built against, stated on the document itself.

   `dist/` holds one build at a time and the two are mutually exclusive: an
   offline artifact talks to a JSON file, a server artifact talks to an API.
   Handed the wrong one, a harness sees nine routes redirect to the door and
   reports nine broken chunks - a diagnosis that sends whoever reads it
   looking for a code-splitting bug that does not exist.

   The smoke tests used to tell them apart by matching a sentence on the
   sign-in screen. That worked until the screen was redesigned and the
   sentence was rewritten, at which point the check silently stopped
   detecting anything: a test whose guard depends on prose is a test that
   breaks when a writer changes a word. This attribute is the fact itself.

   Also genuinely useful in a browser: open the dev tools on a machine at a
   school and the first question is always which build is on it. */
document.documentElement.dataset.backend = SERVER_BACKED ? 'server' : 'local'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
