# Calendar Busy Mirror Sync Specification

## 1. Purpose

Mirror availability between two Google Calendar accounts without exposing event details across the account/company boundary.

The system reads source calendar events, applies filtering rules, converts eligible events into anonymous busy blocks, sends those blocks by email, and creates private `Busy` events in the destination calendar.

The destination side should see only blocked time, not the original title, customer name, attendees, description, location, Meet URL, or other sensitive details.

## 2. Background

There are two Google accounts and two calendar environments:

- Primary Google account / calendar
- Secondary Google account / calendar

Employees on each side should be able to see when the user is busy across both environments.

Adding both accounts as attendees to every event is not acceptable because it may expose event titles and customer names.

Therefore, this project creates anonymous busy blocks instead of sharing event details.

## 3. Architecture

Use Google Apps Script.

The same codebase should be deployable on both sides. Behavior is controlled by configuration.

The synchronization method is email-based snapshot sync.

```text
Primary Calendar
  -> Primary-side sender script
  -> filtered and anonymized JSON snapshot
  -> email
  -> Secondary-side receiver script
  -> Secondary Calendar private busy blocks
```

Reverse direction:

```text
Secondary Calendar
  -> Secondary-side sender script
  -> filtered and anonymized JSON snapshot
  -> email
  -> Primary-side receiver script
  -> Primary Calendar private busy blocks
```

## 4. Platform

Use:

- Google Apps Script
- V8 runtime
- Advanced Google Calendar API
- GmailApp or Gmail API equivalent
- PropertiesService
- LockService

## 5. Non-goals

Do not implement:

- Source event title sync
- Source event description sync
- Source event location sync
- Source event attendee sync
- Meet URL sync
- Attachment sync
- Adding both accounts as event attendees
- A large multi-user admin UI
- True real-time sync
- Workspace-wide domain administration

## 6. Repository layout

Recommended layout:

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

## 7. Sync directions

There are two supported directions:

```text
PRIMARY_TO_SECONDARY
SECONDARY_TO_PRIMARY
```

Each direction has its own configuration.

Example committed configuration should use placeholders only.
Do not commit real account emails, calendar IDs, or secrets.

```javascript
const CONFIGS = {
  PRIMARY_TO_SECONDARY: {
    direction: 'PRIMARY_TO_SECONDARY',
    sourceAccountEmail: 'primary.user@example.com',
    sourceAccountEmailPropertyName: 'PRIMARY_EMAIL',
    otherAccountEmail: 'secondary.user@example.com',
    otherAccountEmailPropertyName: 'SECONDARY_EMAIL',
    sourceCalendarIds: ['primary'],
    destinationCalendarId: 'primary',
    recipientEmail: 'secondary.user@example.com',
    recipientEmailPropertyName: 'SECONDARY_EMAIL',
    allowedSenderEmails: ['primary.user@example.com'],
    allowedSenderEmailsPropertyName: 'PRIMARY_EMAIL',
    subjectPrefix: '[calendar-busy-sync]',
    windowDays: 35,
    timezone: 'Asia/Tokyo',
    manualNoSyncTokens: ['[nosync]'],
    includeTentative: false,
    includeEventTypes: ['default', 'focusTime', 'outOfOffice'],
    excludeEventTypes: ['birthday', 'workingLocation', 'fromGmail'],
    includeAllDayDefault: false,
    includeAllDayOutOfOffice: true,
    scriptPropertySecretName: 'SYNC_SECRET_PRIMARY_TO_SECONDARY',
    sourceLabelPropertyName: 'PRIMARY_LABEL',
    lastSentHashPropertyName: 'LAST_SENT_HASH_PRIMARY_TO_SECONDARY',
    lastSentAtPropertyName: 'LAST_SENT_AT_PRIMARY_TO_SECONDARY',
    lastAppliedGeneratedAtPropertyName: 'LAST_APPLIED_GENERATED_AT_PRIMARY_TO_SECONDARY'
  },

  SECONDARY_TO_PRIMARY: {
    direction: 'SECONDARY_TO_PRIMARY',
    sourceAccountEmail: 'secondary.user@example.com',
    sourceAccountEmailPropertyName: 'SECONDARY_EMAIL',
    otherAccountEmail: 'primary.user@example.com',
    otherAccountEmailPropertyName: 'PRIMARY_EMAIL',
    sourceCalendarIds: ['primary'],
    destinationCalendarId: 'primary',
    recipientEmail: 'primary.user@example.com',
    recipientEmailPropertyName: 'PRIMARY_EMAIL',
    allowedSenderEmails: ['secondary.user@example.com'],
    allowedSenderEmailsPropertyName: 'SECONDARY_EMAIL',
    subjectPrefix: '[calendar-busy-sync]',
    windowDays: 35,
    timezone: 'Asia/Tokyo',
    manualNoSyncTokens: ['[nosync]'],
    includeTentative: false,
    includeEventTypes: ['default', 'focusTime', 'outOfOffice'],
    excludeEventTypes: ['birthday', 'workingLocation', 'fromGmail'],
    includeAllDayDefault: false,
    includeAllDayOutOfOffice: true,
    scriptPropertySecretName: 'SYNC_SECRET_SECONDARY_TO_PRIMARY',
    sourceLabelPropertyName: 'SECONDARY_LABEL',
    lastSentHashPropertyName: 'LAST_SENT_HASH_SECONDARY_TO_PRIMARY',
    lastSentAtPropertyName: 'LAST_SENT_AT_SECONDARY_TO_PRIMARY',
    lastAppliedGeneratedAtPropertyName: 'LAST_APPLIED_GENERATED_AT_SECONDARY_TO_PRIMARY'
  }
};
```

Email addresses are deployment-specific and must be supplied through Apps Script script properties. The committed values above are placeholders only. Required email properties are:

```text
PRIMARY_EMAIL
SECONDARY_EMAIL
```

The selected direction uses these properties for account emails. Both deployments read from and write to their own primary calendar, so no calendar ID properties are required.

## 8. Secret management

HMAC secrets must not be hardcoded.

Read them from Apps Script `PropertiesService.getScriptProperties()`.

Required script properties:

```text
SYNC_SECRET_PRIMARY_TO_SECONDARY
SYNC_SECRET_SECONDARY_TO_PRIMARY
```

Use separate secrets per direction.

Secrets are used for:

1. Signing outbound snapshot emails.
2. Generating anonymous `sourceKey` values from source event identity.

## 9. Sync window

Synchronization uses complete snapshots over a future window.

Default:

```text
windowStart: today at 00:00:00 in Asia/Tokyo
windowEnd: windowStart + 35 days
```

`windowDays` must be configurable.

For short validation runs, script properties may override the configured window:

```text
SYNC_WINDOW_DAYS=1
```

If `SYNC_WINDOW_DAYS` is absent, use the configured default of `35`.

The sender must send all busy blocks that should exist during the window, not only differences from the previous run.

This makes the system self-healing after missed emails or temporary failures.

## 10. Snapshot email format

### 10.1 Subject

Subject format:

```text
[calendar-busy-sync] PRIMARY_TO_SECONDARY 2026-07-30T01:00:00.000Z
```

General format:

```text
{subjectPrefix} {direction} {generatedAt}
```

### 10.2 Body

The email body must be JSON only.

Do not include a human-readable schedule list.

Use an envelope object:

```json
{
  "payloadJson": "{...stringified SnapshotPayload...}",
  "signature": "hex_hmac_sha256_of_payloadJson"
}
```

The signature target is exactly the `payloadJson` string.

This avoids JSON canonicalization problems.

## 11. Snapshot payload format

### 11.1 SnapshotPayload

```typescript
type SnapshotPayload = {
  version: 1;
  direction: 'PRIMARY_TO_SECONDARY' | 'SECONDARY_TO_PRIMARY';
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  blocks: BusyBlock[];
};
```

All datetime strings must be ISO 8601 strings.

### 11.2 BusyBlock

```typescript
type BusyBlock = {
  sourceKey: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  allDay: boolean;
};
```

### 11.3 CalendarDateTime

Timed event example:

```json
{
  "dateTime": "2026-08-03T13:00:00+09:00",
  "timeZone": "Asia/Tokyo"
}
```

All-day event example:

```json
{
  "date": "2026-08-03"
}
```

## 12. Data that must never be sent

Outbound payloads must not contain:

- Source event title
- Source event description
- Source event location
- Source event attendees
- Source event organizer
- Source event creator
- Meet URL
- Conference data
- Attachment data
- Raw Google Calendar event ID
- Raw Calendar ID
- Customer name
- Project name contained in a source event
- Company confidential details contained in a source event

## 13. Anonymous sourceKey

`sourceKey` is an anonymous stable identifier for a source event or source event instance.

Do not send raw Google Calendar event IDs.

### 13.1 Input fields

Use these fields to build the HMAC input:

```text
direction
sourceCalendarId
event.recurringEventId
event.id
event.originalStartTime
event.start
```

### 13.2 Generation rule

Pseudocode:

```javascript
function buildSourceKey(event, sourceCalendarId, direction, secret) {
  const stableInput = [
    direction,
    sourceCalendarId,
    event.recurringEventId || '',
    event.id || '',
    JSON.stringify(event.originalStartTime || {}),
    JSON.stringify(event.start || {})
  ].join('\n');

  return hmacSha256Hex(secret, stableInput);
}
```

The returned value must be hex HMAC-SHA256.

## 14. Filtering rules

Apply the following rules in order.

### 14.1 Source calendar allowlist

Only calendars listed in `sourceCalendarIds` are scanned.

No other calendars are synced.

### 14.2 Cancelled events

Exclude:

```javascript
event.status === 'cancelled'
```

### 14.3 Events created by this sync tool

Exclude:

```javascript
event.extendedProperties?.private?.busyMirror === '1'
```

This prevents sync loops.

### 14.4 Manual exclusion token

If the source event title contains `[nosync]`, exclude it.

Matching is case-insensitive.

Examples to exclude:

```text
[nosync] Customer meeting
Customer meeting [nosync]
[NOSYNC] Internal strategy meeting
```

Implementation example:

```javascript
function hasNoSyncToken(summary, tokens) {
  const s = String(summary || '').toLowerCase();
  return tokens.some(token => s.includes(String(token).toLowerCase()));
}
```

The `[nosync]` token is used only on the source side.
It must not be sent to the destination side.

### 14.5 Other-side account is already an attendee

Exclude if the other-side account is already included as an attendee.

Example:

```javascript
hasAttendeeEmail(event, config.otherAccountEmail) === true
```

Reason:

- The other-side account probably already sees the event.
- Creating another anonymous block would create duplicate busy time.

### 14.6 Free events

Exclude events marked as free:

```javascript
event.transparency === 'transparent'
```

### 14.7 eventType

Default included types:

```text
default
focusTime
outOfOffice
```

Default excluded types:

```text
birthday
workingLocation
fromGmail
```

The implementation should use config lists:

```javascript
includeEventTypes
excludeEventTypes
```

If an event type is explicitly excluded, exclusion wins.
If `event.eventType` is missing, treat it as `default`.

### 14.8 Attendance status

By default, sync only events accepted by the source user.

Pseudocode:

```javascript
function isAcceptedBySourceUser(event, config) {
  const attendees = event.attendees || [];

  const selfAttendee = attendees.find(a =>
    a.self === true ||
    normalizeEmail(a.email) === normalizeEmail(config.sourceAccountEmail)
  );

  if (selfAttendee) {
    if (selfAttendee.responseStatus === 'accepted') return true;
    if (selfAttendee.responseStatus === 'tentative') return config.includeTentative === true;
    return false;
  }

  if (attendees.length === 0) {
    if (event.creator?.self === true) return true;
    if (event.organizer?.self === true) return true;
    if (normalizeEmail(event.creator?.email) === normalizeEmail(config.sourceAccountEmail)) return true;
    if (normalizeEmail(event.organizer?.email) === normalizeEmail(config.sourceAccountEmail)) return true;
  }

  return false;
}
```

Default behavior:

- `accepted`: include
- `tentative`: exclude unless `includeTentative === true`
- `declined`: exclude
- `needsAction`: exclude

Attendee-less self-created personal events should be included.

### 14.9 All-day events

All-day events are excluded by default.

All-day `outOfOffice` events are included by default.

Config:

```javascript
includeAllDayDefault: false
includeAllDayOutOfOffice: true
```

Pseudocode:

```javascript
function shouldIncludeAllDayEvent(event, config) {
  const isAllDay = !!event.start?.date;

  if (!isAllDay) return true;

  if ((event.eventType || 'default') === 'outOfOffice') {
    return config.includeAllDayOutOfOffice === true;
  }

  return config.includeAllDayDefault === true;
}
```

## 15. Sender algorithm

Public function example:

```javascript
function sendOutgoingSnapshot(direction) {}
```

Deployment-side entry point:

```javascript
function send() {}
```

Algorithm:

1. Acquire script lock with `LockService`.
2. Load config by direction.
3. Read HMAC secret from `PropertiesService`.
4. Compute `windowStart` and `windowEnd`.
5. For each `sourceCalendarId`, list events with Calendar API.
6. Use `singleEvents: true` to expand recurring event instances.
7. Use `orderBy: 'startTime'`.
8. Handle pagination with `nextPageToken`.
9. Apply filtering rules to each event.
10. Convert remaining events to `BusyBlock` objects.
11. Generate anonymous `sourceKey` for each block.
12. Sort blocks by `sourceKey`, `start`, and `end` for stable output.
13. Build `SnapshotPayload`.
14. Serialize payload to `payloadJson`.
15. Compute HMAC signature over `payloadJson`.
16. Compare current payload hash with last sent hash.
17. Send email only when the payload changed or a periodic full send is due.
18. Store last sent hash and last sent timestamp in `PropertiesService`.
19. Log only metadata and counts.

Calendar list pseudocode:

```javascript
const response = Calendar.Events.list(calendarId, {
  timeMin: windowStartIso,
  timeMax: windowEndIso,
  singleEvents: true,
  orderBy: 'startTime',
  maxResults: 2500,
  pageToken: pageToken || undefined
});
```

If any configured source calendar fails to load, do not send a partial snapshot.

Periodic full sends are due three times per day by default:

- Around 9:00 in the configured timezone.
- Around 12:00 in the configured timezone.
- Around 18:00 in the configured timezone.

The implementation may send at the first trigger run after those target times.

## 16. Receiver algorithm

Public function example:

```javascript
function processIncomingSnapshots(direction) {}
```

Deployment-side entry point:

```javascript
function receive() {}
```

Algorithm:

1. Acquire script lock with `LockService`.
2. Load config by direction.
3. Read HMAC secret from `PropertiesService`.
4. Search Gmail for unprocessed sync emails matching the subject prefix and direction.
5. Verify sender email is in `allowedSenderEmails`.
6. Parse email body as envelope JSON.
7. Verify HMAC signature before parsing payload semantics.
8. Parse `payloadJson` as `SnapshotPayload`.
9. Check `payload.version === 1`.
10. Check `payload.direction` equals expected direction.
11. Check `payload.generatedAt` is newer than last applied generatedAt.
12. If multiple valid unprocessed snapshots exist, apply only the newest one.
13. Fetch existing destination mirror events in the payload window.
14. Identify mirror events by `extendedProperties.private.busyMirror === '1'` and matching direction.
15. Build a map by `extendedProperties.private.sourceKey`.
16. For each block in payload:
    - Insert if no existing mirror event exists.
    - Update if an existing mirror event differs.
    - Leave unchanged if identical.
17. Delete existing mirror events in the window whose `sourceKey` is missing from the payload.
18. Mark successfully applied emails as processed.
19. Store `lastAppliedGeneratedAt` in `PropertiesService`.
20. Log only metadata and counts.

If applying the snapshot fails, do not mark the email as processed.
The same snapshot must be safely reprocessable.

Processed, ignored, and error-labeled messages do not need to be searched again.

## 17. Destination event format

Create destination mirror events as follows:

```javascript
{
  summary: getMirrorEventSummary(config),
  start: block.start,
  end: block.end,
  transparency: 'opaque',
  visibility: 'private',
  attendees: [],
  reminders: {
    useDefault: false
  },
  extendedProperties: {
    private: {
      busyMirror: '1',
      direction: direction,
      sourceKey: block.sourceKey
    }
  }
}
```

Do not set:

- `description`
- `location`
- `conferenceData`
- `attachments`
- source event title
- source event attendee list

## 18. Mirror event identification

A destination event is managed by this sync tool if:

```javascript
event.extendedProperties?.private?.busyMirror === '1'
```

For a specific direction, also check:

```javascript
event.extendedProperties?.private?.direction === direction
```

The event's source identity is:

```javascript
event.extendedProperties?.private?.sourceKey
```

## 19. Update rules

If an existing mirror event is found for a `sourceKey`, compare and update if needed.

Fields to enforce:

- `summary` must be `Busy`, or `Busy: <label>` when the source account label is configured
- `start` must match block start
- `end` must match block end
- `transparency` must be `opaque`
- `visibility` must be `private`
- `attendees` must be empty or absent
- `description` must be absent
- `location` must be absent
- `conferenceData` must be absent
- `reminders.useDefault` must be `false`
- `extendedProperties.private.busyMirror` must be `1`
- `extendedProperties.private.direction` must match direction
- `extendedProperties.private.sourceKey` must match sourceKey

If the user manually edits a mirror event, the next sync should restore it to the managed state.

## 20. Delete rules

Delete mirror events in the destination calendar when:

- They are managed by this tool.
- Their direction matches the applied payload direction.
- Their start/end overlaps the payload window.
- Their `sourceKey` is not present in the latest payload.

Do not delete unrelated events.
Do not delete mirror events outside the current payload window as part of normal snapshot application.

Optional cleanup function:

```javascript
function cleanupOldMirrorEvents(direction, olderThanDays) {}
```

## 21. Gmail labels

Use labels:

```text
calendar-busy-sync/processed
calendar-busy-sync/error
calendar-busy-sync/ignored
```

Behavior:

- Successfully applied snapshot: add `processed`.
- Invalid JSON, invalid signature, or unexpected payload: add `error`.
- Sender not in `allowedSenderEmails`: add `error`.
- Valid but stale snapshot: add `ignored`.

## 22. Trigger functions

Provide:

```javascript
function installTriggers() {}
function deleteTriggers() {}
```

Default trigger cadence:

- On each deployed side, install triggers only for the directions configured for that side.
- Send snapshots three times per day, targeting 9:00, 12:00, and 18:00 in the configured timezone.
- Receive snapshots three times per day, targeting 5-10 minutes after the send times, for example 9:10, 12:10, and 18:10 in the configured timezone.

The implementation should create triggers for `send()` and `receive()`. `DEPLOYMENT_SIDE` (`PRIMARY` or `SECONDARY`) decides the active send and receive directions for each deployed side.

Primary-side and secondary-side Apps Script deployments are configured separately. Both deployments use their own `primary` calendar for source and destination operations. Mirror events created by this tool must not be treated as source events, so blocks produced by one deployment are not re-synced back by the other deployment.

## 23. Required public functions

Implement:

```javascript
function send() {}
function receive() {}
function installTriggers() {}
function deleteTriggers() {}
function runTests() {}
```

## 24. appsscript.json

Example:

```json
{
  "timeZone": "Asia/Tokyo",
  "runtimeVersion": "V8",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Calendar",
        "serviceId": "calendar",
        "version": "v3"
      }
    ]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
```

Scopes may be narrowed if implementation allows.

## 25. Logging policy

Allowed logs:

- direction
- windowStart
- windowEnd
- number of source events scanned
- number of blocks generated
- number of emails processed
- number of events created
- number of events updated
- number of events deleted
- error class or message without sensitive event details
- first 6 characters of `sourceKey`, if needed

Forbidden logs:

- source event title
- source event description
- source event location
- source event attendee list
- source event organizer
- source event creator
- Meet URL
- conference data
- attachments
- customer names
- raw event ID
- raw Calendar ID

## 26. Error handling

### 26.1 Sender

- If Calendar API listing fails for any source calendar, do not send a snapshot.
- Do not send partial snapshots.
- If HMAC secret is missing, fail closed.
- If Gmail send fails, do not update last sent hash or timestamp.
- Log only non-sensitive metadata.

### 26.2 Receiver

- If sender is not allowlisted, ignore or mark as error.
- If JSON parsing fails, do not apply.
- If signature verification fails, do not apply.
- If payload direction is unexpected, do not apply.
- If payload version is unsupported, do not apply.
- If payload is stale, do not apply.
- If Calendar API update fails mid-application, do not mark the email as processed.
- Reprocessing the same valid snapshot must not create duplicate events.

## 27. Locking

Use `LockService` to prevent concurrent runs.

Pseudocode:

```javascript
function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Could not acquire lock');
  }

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
```

## 28. Helper functions

Recommended helpers:

```javascript
function getConfig(direction) {}
function getSecret(config) {}
function normalizeEmail(email) {}
function hasAttendeeEmail(event, email) {}
function hasNoSyncToken(summary, tokens) {}
function shouldSyncEvent(event, sourceCalendarId, config) {}
function isAcceptedBySourceUser(event, config) {}
function shouldIncludeAllDayEvent(event, config) {}
function buildSourceKey(event, sourceCalendarId, direction, secret) {}
function hmacSha256Hex(secret, message) {}
function sha256Hex(message) {}
function buildSnapshotPayload(direction) {}
function signPayload(payloadJson, secret) {}
function verifyEnvelope(envelope, secret) {}
function blockFromEvent(event, sourceCalendarId, config, secret) {}
function createMirrorEventResource(block, config) {}
function isMirrorEvent(event, direction) {}
function eventsEqualManagedState(event, block, config) {}
function applySnapshotPayload(payload, config) {}
```

## 29. Tests

Implement `runTests()`.

Use simple assertions and mocks. Avoid external API calls in unit tests.

### 29.1 Filter tests

Test:

- `[nosync]` event is excluded.
- `[NOSYNC]` event is excluded.
- accepted event is included.
- tentative event is excluded by default.
- tentative event is included when `includeTentative === true`.
- declined event is excluded.
- needsAction event is excluded.
- attendee-less self-created personal event is included.
- event with other-side account attendee is excluded.
- transparent event is excluded.
- birthday event is excluded.
- workingLocation event is excluded.
- fromGmail event is excluded by default.
- outOfOffice event is included.
- focusTime event is included.
- normal all-day event is excluded by default.
- all-day outOfOffice event is included by default.
- `busyMirror = "1"` event is excluded.

### 29.2 sourceKey tests

Test:

- Same event produces same sourceKey.
- Different event ID produces different sourceKey.
- Different direction produces different sourceKey.
- Raw event ID is not visible in sourceKey.
- Recurring event instances produce stable keys.

### 29.3 Payload tests

Test:

- Payload does not contain source summary.
- Payload does not contain source description.
- Payload does not contain source location.
- Payload does not contain attendees.
- Payload does not contain raw event ID.
- Signature verification succeeds for unchanged payloadJson.
- Signature verification fails after payloadJson modification.

### 29.4 Receiver tests

Using a mock destination calendar, test:

- New block inserts one event.
- Same snapshot applied twice does not duplicate.
- Changed block time updates existing event.
- Missing block deletes old mirror event.
- Stale generatedAt is rejected.
- Invalid signature is rejected.
- Non-mirror destination events are never deleted.

## 30. README requirements

`README.md` should be written in English and include:

1. Overview
2. Privacy model
3. Setup steps
4. How to enable Advanced Google Calendar API
5. Required script properties
6. Config examples using placeholders
7. Trigger installation
8. Manual execution
9. Test execution
10. Operational notes
11. How to use `[nosync]`
12. Troubleshooting

## 31. `[nosync]` operation

To manually exclude a single source event from sync, add `[nosync]` to the source event title.

Examples:

```text
[nosync] Customer A meeting
Customer A meeting [nosync]
```

Matching is case-insensitive.

The `[nosync]` token must not appear in outbound payloads or destination events.

Calendar-level inclusion/exclusion must be controlled by `sourceCalendarIds`, not by title tokens.

## 32. Completion criteria

Implementation is complete when:

- `send()` works on both deployment sides.
- `receive()` works on both deployment sides.
- Destination events are created as private `Busy` busy blocks only.
- Destination events have no attendees.
- Source titles never appear in payloads, destination events, or logs.
- `[nosync]` events are excluded.
- Non-accepted events are excluded according to config.
- Events already containing the other-side account as attendee are excluded.
- Same snapshot can be processed repeatedly without duplicates.
- Source event deletion removes the destination mirror block on the next snapshot.
- Source event time change updates the destination mirror block on the next snapshot.
- `runTests()` passes.
