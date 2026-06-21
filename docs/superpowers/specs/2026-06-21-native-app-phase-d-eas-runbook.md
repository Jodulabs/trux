# Native App (Expo) — Phase D runbook: ship via EAS

**Status:** scaffolding complete; cloud execution gated on accounts/credentials
**Date:** 2026-06-21
**Scope:** Phase D of the [native-app-expo migration](./2026-06-21-native-app-expo-migration-design.md) — produce installable iOS/Android builds via EAS, get them onto TestFlight / Play internal track, and make the Phase C2 push round-trip real. Embedded `tsnet` transport is a *separate later phase*, out of scope here.

What's already in the repo (no account needed):
- `apps/mobile/eas.json` — build profiles (`development`, `preview`, `production`) + submit skeleton.
- `apps/mobile/app.json` — `version` 1.0.0, `runtimeVersion` policy, `scheme` `trux`, bundle id / package `com.trux.mobile`, `expo-notifications` plugin, iOS `UIBackgroundModes: [remote-notification]`, Android `VIBRATE` permission.
- `src/notifications.ts` already reads `Constants.expoConfig.extra.eas.projectId` — so once `eas init` writes that id, native push token registration lights up automatically.

Everything below needs **your** credentials and runs against Expo's cloud, so it is not automatable from here.

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
