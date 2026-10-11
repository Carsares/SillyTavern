# TTS Provider Contract

This document describes the contract consumed by `public/scripts/extensions/tts/index.js`. That module is the source of truth when the provider API changes.

## Registration

Built-in providers are imported and added to the `ttsProviders` map in `index.js`.

Runtime providers can call:

```js
registerTtsProvider('Provider name', YourTtsProvider);
```

The registered value must be a constructible class. Provider names must be unique.

## Required fields

### `settings`

An object containing provider state that should persist. The extension stores it under `extension_settings.tts[providerName]` when settings are saved or refreshed.

### `settingsHtml`

An HTML string inserted into `#tts_provider_settings` before `loadSettings()` is called.

## Required methods

### `loadSettings(settingsObject)`

Load persisted settings and initialize provider controls. The extension awaits this method, so it may be synchronous or asynchronous.

### `checkReady()`

Resolve when the provider is ready. Throw or reject with a user-facing reason when it is unavailable. The extension catches the error and displays it in the TTS status area.

### `onRefreshClick()`

Apply current UI settings or reconnect the provider. The extension awaits it, persists `settings`, and then rebuilds the voice map.

### `fetchTtsVoiceObjects()`

Return an array of voice objects. The method may be synchronous or asynchronous.

Each voice object must contain:

- `name`: user-facing name used by the voice map;
- `voice_id`: provider-specific identifier passed to `generateTts()`.

Optional voice fields:

- `preview_url`: directly playable audio URL;
- `lang`: language label displayed in the voice browser.

### `getVoice(voiceName)`

Return the voice object selected by its saved user-facing name. The extension awaits this method and reads `voice_id`; therefore both synchronous and asynchronous implementations are supported.

If a saved voice no longer exists, either return a deliberate provider fallback or throw a useful error.

### `generateTts(text, voiceId, voiceMapKey)`

Generate audio for the supplied text and voice.

- `text`: normalized text after extension-level filtering and optional `processText()`.
- `voiceId`: value returned by `getVoice()`.
- `voiceMapKey`: full character/segment key. It can include qualifiers such as `Character ("Quotes")`. Providers that do not need it may ignore it.

Return one of:

- a Fetch `Response` whose body produces an `audio/*` Blob;
- a string that can be assigned to an audio element as its source;
- an async iterable yielding either supported value for chunked playback.

Do not return `null` or `undefined`. HTTP responses with non-audio Blob types are rejected.

## Optional members

### `previewTtsVoice(voiceId)`

Play or generate a preview when a voice has no `preview_url`. A provider whose voices always expose directly playable preview URLs does not need this method.

### `processText(text)`

Perform provider-specific text transformation before generation. The extension awaits this method.

### `separator`

A string used to join extracted quoted blocks. The default is ` ... `.

### `dispose()`

Release workers, sockets, audio resources, or other provider state when the user switches providers. The current caller invokes it synchronously, so start any asynchronous cleanup internally.

## Lifecycle

1. The extension constructs the selected provider.
2. It inserts `settingsHtml`.
3. It awaits `loadSettings(savedSettings)`.
4. When TTS is enabled, it awaits `checkReady()` and `fetchTtsVoiceObjects()`.
5. For each segment, it awaits `getVoice()` and then `generateTts()`.
6. It processes a single result or each chunk of an async iterable.
7. On refresh, it awaits `onRefreshClick()` and persists `settings`.
8. On provider change, it calls `dispose()` when present.

Keep provider errors actionable and never log API keys, cookies, bearer tokens, or generated private text unnecessarily.
