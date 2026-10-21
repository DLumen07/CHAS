Ships to the user: public/logo.png

512x512, transparent, ~265KB. Referenced by src/components/Seal.tsx via
BASE_URL, so it is copied to the dist root and resolves under file:// in the
packaged Electron build.

Not shipped, kept here as source:
  logo-master.png    6250x6250 transparent master
  logo-original.jpg  the earlier opaque-background export

If you replace the seal, regenerate public/logo.png from the master at 512px.
Do not put the 6250px file in public/: it is 23MB on disk and rasterizes to
about 156MB of memory on a school workstation.


CHAS app logo (separate from the school seal):
  public/chas-logo.png         512x512, transparent background.
                                Used by src/components/AppLogo.tsx in the
                                sidebar and on the sign-in screen.
  brand/chas-logo-master.png   the 1254px source it was cleaned from.
The school seal (public/logo.png) stays on the printed invitation slip and the
registration dialog.


App icon (2026-10-15): the CHAS logo, not the school seal.
  brand/icon.ico      used by electron-builder for CHAS.exe, the installer
                      and the shortcuts (electron-builder.config.cjs).
  electron/icon.ico   the same file, for the window and taskbar icon.
  brand/icon-previous.ico  the icon before this change, kept for reference.
Both .ico files hold 16-256px PNG entries made from public/chas-logo.png:
  npx electron scripts/make-icon.cjs public/chas-logo.png brand/icon.ico <preview-dir>
then copy brand/icon.ico to electron/icon.ico.

The school logo is no longer only this file: the head can upload the
school's own in School settings. public/logo.png is the default shown until
one is uploaded.
