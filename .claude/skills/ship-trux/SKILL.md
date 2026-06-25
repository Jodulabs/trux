---
name: ship-trux
description: >-
  How to get trux changes live where they need to be — the three surfaces
  (native app for Firebase testers, web served by the backend, the backend
  itself) each ship differently. Use this WHENEVER the user wants changes to
  reach testers or the running app: "ship it", "distribute", "push a new build",
  "send it to the testers", "update Firebase", "cut a release", "get this on my
  phone", "rebuild and deploy", or any "I changed X, now make it live". The key
  thing Claude keeps getting wrong without this: Firebase App Distribution never
  auto-updates, backend changes do NOT need a new APK, and a naive restart
  rotates the auth token. Read this before rebuilding or distributing anything.
---

# Shipping trux changes

trux has **three surfaces**, and what you rebuild depends entirely on which one
changed. The whole point of this skill is to route correctly instead of
rebuilding everything (slow) or the wrong thing (no effect).

```
apps/backend   → Node/Fastify + SQLite (~/.trux/trux.db), runs on :4317 via tsx
apps/mobile    → one Expo/RN codebase that ships as BOTH:
                   • the native Android app (APK → Firebase testers)
                   • the web bundle the backend serves at localhost:4317
packages/*     → protocol + client spine, consumed by both above
```

**The architecture fact that decides everything:** the native app and the web
UI are *thin clients*. They talk to the backend over HTTP/WS. So **logic that
lives in the backend reaches every already-installed client the moment the
backend restarts** — no new APK, no web rebuild. Only code that runs *inside*
the client (RN/React UI, client spine) needs a rebuild to take effect.

## Step 1 — Figure out what changed

Check `git status` / the diff and map files to surfaces. The user often won't
say which surface — infer it:

| Files touched | Surface | What's needed |
|---|---|---|
| `apps/backend/**`, `packages/protocol`, `packages/client` (used by backend) | Backend | Restart only |
| `apps/mobile/**` (UI, screens, components) **and** the user is on **web** (`localhost:4317`) | Web | Rebuild web + restart |
| `apps/mobile/**` **and** testers need it on their **phones** | Native app | New APK → Firebase |

If a change spans surfaces (e.g. a client-spine change used by both backend and
mobile), do the backend restart **and** the relevant client rebuild.

When genuinely ambiguous whether the user wants it on the web surface vs the
testers' phones, ask that one question — it's the only fork that matters.

## Step 2 — Ship it

### Backend changed → restart (no build)
The backend runs from source via `tsx`; there is nothing to compile. Restart it
**without rotating the token** using the bundled helper:

```bash
.claude/skills/ship-trux/scripts/restart-backend.sh
```

It captures the live `TRUX_*` env (incl. `TRUX_SECRET`, which is the `#token` in
the user's browser URL) from the running process before killing it, so the URL
and workspaces survive. Never plain `pnpm restart` for a running instance — it
inherits an empty env and breaks every open client. After it's up, the user just
refreshes; installed apps pick the change up on their next request.

### Web UI changed → rebuild the bundle, then restart
The backend serves `apps/mobile/dist`. Rebuild it, then restart so the new bundle
is served:

```bash
pnpm build                                   # = expo export -p web → apps/mobile/dist
.claude/skills/ship-trux/scripts/restart-backend.sh
```

### Native app changed → new APK → Firebase (the manual one)
**Firebase App Distribution never auto-updates.** Testers only get a new build
when you build an APK and `distribute` it — every single time. Three steps, and
the version bump is mandatory:

1. **Bump `versionCode`** in `apps/mobile/android/app/build.gradle` (line ~95).
   App Distribution rejects an upload whose `versionCode` matches an existing
   release. Increment it (and `versionName` if it's a user-facing version).

2. **Build the release APK** (needs JDK 17; the build is ~45 min cold):
   ```bash
   cd apps/mobile/android
   JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleRelease
   # → app/build/outputs/apk/release/app-release.apk  (~136 MB universal APK)
   ```

3. **Distribute to testers:**
   ```bash
   firebase appdistribution:distribute \
     apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
     --app 1:674532113962:android:f6c6187edccaf193f44d53 \
     --release-notes "<what changed>" \
     --testers "guruprasad.hegde@jodulabs.com"
   ```
   Identical APK bytes → Firebase attaches to the existing release instead of
   making a new one; that's expected, not an error.

Run a long build in the background (`run_in_background`) and report the APK path
+ the console/tester links when it finishes. The user installs via the **Firebase
App Tester** app on the device.

## Constants (this project)

- Package / `applicationId`: `com.trux.mobile`
- Firebase app id: `1:674532113962:android:f6c6187edccaf193f44d53` (project `trux-ceeed`)
- Default tester: `guruprasad.hegde@jodulabs.com`
- Backend port: `4317`; DB: `~/.trux/trux.db`
- Release APK is currently **debug-keystore signed** — fine for App Distribution,
  but a real release keystore is needed before Play Store, and the *same* key must
  be reused forever for `com.trux.mobile`.

## Don't

- Don't rebuild/redistribute an APK for a backend-only change — wasted ~45 min,
  and the installed app already gets it on restart.
- Don't forget the `versionCode` bump before a real new APK — the upload fails.
- Don't assume Firebase pulls from git/CI — it has only what you last uploaded.
- Don't plain-`pnpm restart` a running backend — use the helper so the token holds.
