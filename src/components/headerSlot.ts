import { createContext } from 'react'

/* Where the work area's header is rendered.

   By default the header sits above the screen, in the shell's own column, and
   the screen scrolls underneath it. The bento screens want it inside their
   scrolling column instead: their rail runs the full height beside the cards,
   so the header cannot span the width, and a header that stayed put while the
   cards moved under it would read as a sticky bar the app has nowhere else.

   A screen claims the header by handing this a node to render it into. Nobody
   claims it and the shell keeps it where it was. */
export const HeaderSlot = createContext<((el: HTMLElement | null) => void) | null>(null)
