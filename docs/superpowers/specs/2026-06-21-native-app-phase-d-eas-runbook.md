# Native App (Expo) — Phase D runbook: ship via EAS

**Status:** scaffolding complete; cloud execution gated on accounts/credentials
**Date:** 2026-06-21
**Scope:** Phase D of the [native-app-expo migration](./2026-06-21-native-app-expo-migration-design.md) — produce installable iOS/Android builds via EAS, get them onto TestFlight / Play internal track, and make the Phase C2 push round-trip real. Embedded `tsnet` transport is a *separate later phase*, out of scope here.

What's already in the repo (no account needed):
- `apps/mobile/eas.json` — build profiles (`development`, `preview`, `production`) + submit skeleton.
- `apps/mobile/app.json` — `version` 1.0.0, `runtimeVersion` policy, `scheme` `trux`, bundle id / package `com.trux.mobile`, `expo-notifications` plugin, iOS `UIBackgroundModes: [remote-notification]`, Android `VIBRATE` permission.
- `src/notifications.ts` already reads `Constants.expoConfig.extra.eas.projectId` — so once `eas init` writes that id, native push token registration lights up automatically.

> **Two build paths.** You do **not** need EAS cloud to produce binaries.
> - **Local builds** (§A below) — compile on your own machine with `expo run:android` / `expo run:ios`. No Expo cloud, no per-build cost. **This is the chosen path for trux.**
> - **EAS cloud builds** (§§0–6 below) — Expo's hosted build/sign/submit. Kept as reference; use only if you later want hosted CI or don't have a Mac for iOS.
>
> The `eas init` step (§1) is still worth doing once regardless: it mints the `projectId` that native push needs — already linked here as `e628dfbb-…`.

---

## A. Local builds (no EAS cloud) — the chosen path

Build on your own machine; nothing runs against Expo's cloud and no build quota
is consumed. **Android only for now — iOS is deferred** (iOS binaries require
macOS, which we don't have; revisit via EAS cloud once an Apple account exists).
You do **not** need the React Native Community CLI — Expo CLI / EAS CLI wrap the
native build. Run from `apps/mobile`.

**Prerequisites (Android)**
- JDK 17 + Android Studio (Android SDK + platform-tools), `ANDROID_HOME` set.
- An emulator or a USB device with USB debugging. No paid account to build; the
  Play Console account is only needed to *upload* (in progress).

**Two local options**

1. **`npx expo run:android`** — Expo CLI. Local prebuild (`ios/`+`android/` from
   `app.json` + plugins) → Gradle → installs a **debug** APK. Best for
   day-to-day iteration; afterwards iterate JS over Metro
   (`pnpm --filter @trux/mobile dev`) and only re-run when native deps/config
   change.
   ```bash
   cd apps/mobile
   npx expo run:android
   ```

2. **`eas build --local`** — EAS CLI building **on your machine** (the `--local`
   flag; *does not* use the cloud or burn build quota). Reads `eas.json` and
   produces a signed, release-grade artifact — the one you upload to Play.
   ```bash
   cd apps/mobile
   eas build --local --profile preview    --platform android   # → installable .apk
   eas build --local --profile production --platform android   # → store .aab
   ```
   Needs the same JDK + Android SDK. Signing: on first run it can generate an
   upload keystore (or pull EAS-managed credentials if logged in / use a local
   `credentials.json`). Keep the keystore safe — Play requires the same one for
   every update.

**Play Store path (account in progress)**
1. `eas build --local --profile production --platform android` → `.aab`.
2. Upload to the Play Console internal track manually, or `eas submit
   --profile production --platform android` (that's a Google upload, not an EAS
   cloud build).

**iOS (deferred).** When ready: EAS **cloud** build (§§2–4) is the no-Mac route,
or a borrowed Mac with `npx expo run:ios`. Needs the $99/yr Apple membership.

**Native push, locally.** A local debug build can receive push: it uses the
`projectId` already in `app.json`, and `getExpoPushTokenAsync` mints a token if
the device has network + permission. Delivery still needs FCM credentials —
drop the Firebase `google-services.json` in and register the FCM key (see §5);
the Expo Push Service relays once the token is registered.

**`.gitignore`.** Prebuild writes `ios/` and `android/`; both are already
ignored (`apps/mobile/.gitignore` lines 8–9), so the generated native projects
won't land in git — they're regenerated on demand.

> ⚠️ **Version alignment still applies to local builds.** Prebuild + autolinking
> use the **Expo SDK 56** templates (RN 0.85.3 + its module set). The repo
> currently runs ahead (RN 0.86, gesture-handler 3, async-storage 3 — see
> expo-doctor). If `expo run:android` / `eas build --local` fails at the
> Gradle/native step, that mismatch is the first suspect; align with
> `npx expo install --check` (downgrades to the SDK 56 matrix) and re-run the
> JS suite.

---

## EAS cloud reference (optional — not the chosen path)

Everything below runs against Expo's cloud and needs **your** credentials. Skip if building locally; kept for reference / future hosted CI.

---

## 0. Prerequisites (one-time)

- An **Expo account** (free): <https://expo.dev>. Decide a personal account vs an org/team — that becomes the `owner` in `app.json`.
- For iOS: an **Apple Developer Program** membership ($99/yr) and the bundle id `com.trux.mobile` registered (EAS can create it for you during the first build).
- For Android: a **Google Play Console** account ($25 one-time) for store submission. (Internal APKs from the `preview` profile install directly without Play.)
- Install the CLI: `npm i -g eas-cli` (or use `npx eas-cli@latest`).

```bash
eas login           # authenticate the CLI to your Expo account
eas whoami          # confirm
```

---

## 1. Initialize the EAS project (writes projectId)

From `apps/mobile`:

```bash
eas init
```

This creates the project on Expo's servers and writes two things into `app.json`:
- `extra.eas.projectId` — a UUID. **This is what `getExpoPushTokenAsync` needs**; until it exists, `src/notifications.ts` no-ops by design.
- `owner` — your account/org slug.

Commit the resulting `app.json` change.

> If you use an org, set `owner` to the org slug before `eas init` (or pass `--id`).

---

## 2. Development build (dev client on a real device)

The dev client is a custom build of the app that loads JS from the Metro bundler — like Expo Go, but with our native modules (camera, secure-store, notifications) compiled in.

```bash
eas build --profile development --platform ios      # or android, or all
```

- Install the resulting build on a device/simulator (EAS prints a QR / install link).
- Run `pnpm --filter @trux/mobile dev` and connect the dev client to Metro.
- This is the first build that can exercise **native push end to end** (see §5).

---

## 3. Preview build (shareable internal binary)

For sharing with testers without a store. The `preview` profile builds an installable `.apk` (Android) and an internal-distribution `.ipa` (iOS, requires the device UDIDs be registered in your Apple account — `eas device:create`).

```bash
eas build --profile preview --platform all
```

Distribute via the EAS install link.

---

## 4. Production build + store submission

```bash
eas build --profile production --platform all
```

`production` uses `autoIncrement` with `appVersionSource: remote`, so EAS owns the build number / version code — bump the marketing `version` in `app.json` when you want a new public version.

Submit to the stores:

```bash
eas submit --profile production --platform ios       # → TestFlight
eas submit --profile production --platform android    # → Play internal track
```

First submit will prompt for store credentials (App Store Connect API key; Google Play service-account JSON). EAS stores them for next time. Fill the `submit.production` block in `eas.json` with `ascAppId` / `track` once known to make submits non-interactive.

---

## 5. Native push credentials (makes the C2 round-trip real)

The app + backend push code is done and unit-tested (`src/notifications.ts`, backend `ExpoPushNotifier`). Delivery to a device needs OS-level credentials registered with Expo so the Expo Push Service can relay to APNs/FCM:

**iOS (APNs):**
```bash
eas credentials --platform ios
# → choose "Push Notifications: Manage your Apple Push Notifications Key"
# → let EAS create/upload an APNs key (.p8)
```

**Android (FCM):**
1. Create a Firebase project, add an Android app with package `com.trux.mobile`.
2. Get the **FCM V1 service-account JSON** (Firebase console → Project settings → Service accounts).
3. Upload it: `eas credentials --platform android` → "Google Service Account" → "FCM V1".

**Verify the round-trip** (after a `development` or `production` build is on a device and `eas init` has set `projectId`):
1. Open the app, pair to the box — `registerForPushAsync()` posts the Expo token to `/push/subscribe` (→ `registry.addExpoPushToken`).
2. From the box, trigger an approval or finish a turn → backend `ExpoPushNotifier` calls the Expo Push Service.
3. Confirm on the device: banner appears when backgrounded; **suppressed** when foregrounded on that conversation; **tap deep-links** to `/session/:id`.
   - Quick sanity check independent of the box: `curl -H 'content-type: application/json' https://exp.host/--/api/v2/push/send -d '{"to":"ExponentPushToken[...]","title":"trux","body":"test","data":{"conversationId":"abc"}}'`

---

## 6. Mobile-viewport screenshots (the deferred C3 verification)

With a `development` build running on a simulator/emulator, capture the project-standard mobile screenshots of each surface (list, new conversation, transcript + tool cards, approval, git panel, command palette, settings) for the phase record.

---

## Notes / decisions

- **`appVersionSource: remote`** — EAS manages build numbers; don't hand-edit `ios.buildNumber` / `android.versionCode`. Bump marketing `version` in `app.json` for public releases.
- **Channels** (`development`/`preview`/`production`) are wired for a later **EAS Update** (OTA JS) setup; not required to build.
- **Notification icon/color** — the `expo-notifications` plugin currently uses defaults. To brand the Android small-icon, add `["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#<copper>" }]` once an asset exists.
- **`tsnet`** embedded transport (roadmap line 117) remains a separate later phase; Phase D is only packaging/shipping.
