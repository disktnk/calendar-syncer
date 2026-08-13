# AGENT.md

This repository implements a Google Apps Script project for mirroring Google Calendar availability between two accounts.

Follow `SPEC.md` as the authoritative implementation specification.

## Development instructions

- Use `uv` when running Python.
- Writing files and executing code under this repository directory is allowed without asking for additional permission.
- Chat with the user in Japanese.
- Write code, comments, identifiers, and committed documentation in English unless there is a product-specific reason to use Japanese text.

## Core goal

Read events from a source Google Calendar, filter them, anonymize them, send only availability blocks to the other side, and create private destination calendar blocks.

The implementation must prevent source event details from crossing the company/account boundary.

## Hard requirements

- Do not send source event titles to the other side.
- Do not send source event descriptions to the other side.
- Do not send source event locations to the other side.
- Do not send source event attendees to the other side.
- Do not send source event organizers or creators to the other side.
- Do not send Meet URLs, conference data, attachments, customer names, raw Calendar IDs, or raw Google Calendar event IDs to the other side.
- The destination event title must be `Busy`, or `Busy: <label>` when the source account label is configured.
- Timed source out-of-office events must be mirrored as `eventType: "outOfOffice"` with `outOfOfficeProperties.autoDeclineMode: "declineNone"`.
- All-day source out-of-office events must not be synced.
- Destination events must not have attendees.
- Destination events must not have descriptions, locations, conference data, or attachments.
- Destination events must set `transparency: "opaque"`.
- Destination events must set `visibility: "private"`.
- Destination events must set `reminders.useDefault: false`.
- Destination events must include `extendedProperties.private.busyMirror = "1"`.
- Events with `[nosync]` in the source title must not be synced.
- Events created by this sync tool, identified by `busyMirror = "1"`, must not be treated as source events.
- If the other-side account is already included as an attendee in the source event, the event must not be synced.
- Only accepted events should be synced by default.
- `tentative` events must be excluded by default and included only when explicitly configured.
- `declined` and `needsAction` events must be excluded.
- `transparent` events, meaning events marked as free, must be excluded.
- The same snapshot must be safely reprocessable without creating duplicate destination events.
- If a source event is deleted, excluded, or moved, the mirrored destination block must be deleted or updated on the next snapshot application.
- Secrets must never be committed to source code.
- HMAC secrets must be read from Apps Script `PropertiesService`.
- Logs must not contain source event titles, descriptions, locations, attendees, Meet URLs, customer names, raw Calendar IDs, or raw event IDs.

## Recommended file layout

```text
appsscript.json
Config.gs
Main.gs
Sender.gs
Receiver.gs
Filter.gs
CalendarEvent.gs
GmailTransport.gs
Crypto.gs
Triggers.gs
Tests.gs
README.md
SPEC.md
AGENT.md
```

## Implementation priorities

1. Implement pure functions first.
2. Add tests for filtering, payload generation, HMAC signing, and idempotent snapshot application.
3. Implement sender-side snapshot creation.
4. Implement receiver-side snapshot application.
5. Add Gmail transport.
6. Add trigger installation helpers.
7. Add setup documentation in `README.md`.

## Testing requirements

Implement `runTests()` in `Tests.gs`.

Tests should cover at least:

- `[nosync]` exclusion.
- Case-insensitive `[nosync]` matching.
- accepted / tentative / declined / needsAction attendee status handling.
- attendee-less self-created personal events.
- exclusion when the other-side account is already an attendee.
- exclusion of `transparent` events.
- exclusion of `birthday` and `workingLocation` event types.
- inclusion of `default`, `focusTime`, and `outOfOffice` event types according to config.
- all-day event handling.
- `busyMirror = "1"` exclusion.
- stable anonymous `sourceKey` generation.
- absence of raw event IDs and titles from payloads.
- HMAC verification success and failure.
- idempotent application of the same snapshot.
- update when block time changes.
- delete when a block disappears from the latest snapshot.
- rejection of stale snapshots.
- rejection of invalid signatures.

## Security and privacy rules

Treat all source calendar event fields as sensitive by default.

The only fields allowed to cross the boundary are:

- anonymous `sourceKey`
- start time
- end time
- all-day flag
- mirror event type, limited to `default` or `outOfOffice`
- payload metadata such as version, direction, generatedAt, windowStart, and windowEnd

Do not add convenience debugging that prints event summaries.
Do not add fallback behavior that sends raw event objects.
Do not store payloads containing source titles.
Do not include real account emails, secrets, calendar IDs, or customer names in committed config files.
Use placeholders in committed examples.

## Expected public functions

Implement these functions for manual execution and triggers:

```javascript
function send() {}
function receive() {}
function installTriggers() {}
function deleteTriggers() {}
function runTests() {}
```

## Done definition

The implementation is done when:

- All public functions above exist.
- `runTests()` passes.
- Sender produces signed anonymous snapshots.
- Receiver verifies signatures before applying snapshots.
- Receiver creates private `Busy` blocks, with timed source out-of-office events mirrored as out-of-office status events.
- Existing mirror events are updated instead of duplicated.
- Mirror events missing from the latest snapshot are deleted within the snapshot window.
- Source event details never appear in outbound payloads, destination events, or logs.
