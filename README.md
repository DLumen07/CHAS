# CHAS – Child Health Assessment System

Nutritional status monitoring and parent meeting invitations for Detailen Elementary School, Maria Aurora, Aurora. Capstone project, 2026.

## Download

**[Download the latest installer (CHAS-Setup.exe)](https://github.com/DLumen07/CHAS/releases/latest)**

Open the link, then under **Assets** click `CHAS-Setup-<version>.exe`.

## Install

1. Run the downloaded `CHAS-Setup-<version>.exe`.
2. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. The installer is not code-signed yet, so Windows does not recognise the publisher.
3. Follow the setup steps. CHAS opens when it finishes; the first start takes a little longer while the database is created.

**Requirements:** Windows 10 or 11 (64-bit). No internet connection is needed after installing. Everything, including the database, runs on this one computer.

## First sign-in

| Account | Username | Password |
|---|---|---|
| School head | `admin` | `admin12345678` |
| School nurse | `s.nurse` | `nurse12345678` |

Change both passwords on the **Roles** screen after the first sign-in.

## Upgrading from an older CHAS

Close CHAS, then run the new installer over it. All records are kept. If the head account was never changed from the old default (`a.bantolo`), it becomes `admin` / `admin12345678`; a head who set their own password keeps it.
