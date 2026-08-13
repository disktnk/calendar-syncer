# Calendar Busy Mirror Sync

This Google Apps Script project mirrors busy time between two Google Calendar accounts without sending calendar event details across the account boundary.

The sender reads source calendar events, filters out events that should not be synced, converts eligible events into anonymous availability blocks, signs the snapshot with HMAC-SHA256, and sends it by email. The receiver verifies the signature and creates, updates, or deletes private destination events.

## Privacy Model

Only these fields are sent:

- Anonymous `sourceKey`
- Start time
- End time
- All-day flag
- Mirror event type, limited to `default` or `outOfOffice`
- Snapshot metadata

The payload must never include source titles, descriptions, locations, attendees, organizer, creator, Meet URLs, attachments, calendar IDs, event IDs, customer names, or project names.

Destination mirror events are private busy blocks with:

- `summary: 'Busy'` or `summary: 'Busy: <label>'`
- `visibility: 'private'`
- `transparency: 'opaque'`
- `extendedProperties.private.busyMirror: '1'`

Timed source out-of-office events are mirrored as Google Calendar `outOfOffice` events with `outOfOfficeProperties.autoDeclineMode: 'declineNone'`, so they show as out of office without automatically declining destination-side invitations. All-day out-of-office source events are ignored.

## Setup

1. Create an Apps Script project for the primary side.
2. Create another Apps Script project for the secondary side.
3. Copy the same source files into both projects.
4. Enable the Advanced Google Calendar API in each Apps Script project.
5. Set the account email script properties described below.
6. Set script properties in each deployment.
7. Run `runTests()` manually.
8. Run `installTriggers()` manually.

## Required Script Properties

Set both secrets where needed:

```text
SYNC_SECRET_PRIMARY_TO_SECONDARY
SYNC_SECRET_SECONDARY_TO_PRIMARY
```

Use different strong random values per direction.

Set the deployment side:

```text
DEPLOYMENT_SIDE=PRIMARY
```

or:

```text
DEPLOYMENT_SIDE=SECONDARY
```

Set the email script properties in each deployment:

```text
PRIMARY_EMAIL=primary.user@example.com
SECONDARY_EMAIL=secondary.user@example.com
```

These values are used for source accounts, the other account, recipients, and sender allowlists. Do not commit real email addresses. Both deployments use their own primary calendar for reading and writing; no calendar ID property is required.

Primary-side deployment sends `PRIMARY_TO_SECONDARY` and receives `SECONDARY_TO_PRIMARY`.
Secondary-side deployment sends `SECONDARY_TO_PRIMARY` and receives `PRIMARY_TO_SECONDARY`.

For a short test run, set this optional script property:

```text
SYNC_WINDOW_DAYS=1
```

Remove these properties, or set them back to `35`, before using the normal one-month sync window.

To show a source account label in destination event titles, set the corresponding optional `PRIMARY_LABEL` or `SECONDARY_LABEL` script property. If it is unset, the title is `Busy`.

## Trigger Schedule

`installTriggers()` creates managed triggers for the configured deployment side:

- Send snapshots around 9:00, 12:00, and 18:00 in the configured timezone.
- Receive snapshots around 9:10, 12:10, and 18:10 in the configured timezone.

`deleteTriggers()` removes only this project's managed send and receive triggers.

## Manual Execution

Run the same functions on either deployment. `DEPLOYMENT_SIDE` decides the direction.

```javascript
send();
receive();
```

## Tests

Run:

```javascript
runTests();
```

Tests use mocks and do not call Gmail or Calendar APIs.

## `[nosync]`

To exclude one source event from sync, add `[nosync]` to the source event title. Matching is case-insensitive.

Examples:

```text
[nosync] Customer meeting
Customer meeting [nosync]
[NOSYNC] Internal meeting
```

The token is used only on the source side and is never sent to the destination side.

## Operational Notes

- If any source calendar fails to load, no partial snapshot is sent.
- Processed, ignored, and error-labeled sync emails are not searched again.
- If the same snapshot is processed twice, the receiver does not create duplicate events.
- If a source event disappears from the latest snapshot, the matching mirror event is deleted within the snapshot window.
- If a mirror event is manually edited, the next successful sync restores the managed fields.

## Troubleshooting

- Missing secret: set the required `SYNC_SECRET_*` script property.
- No triggers installed: verify `DEPLOYMENT_SIDE` is set to `PRIMARY` or `SECONDARY`, then run `installTriggers()`.
- Invalid incoming messages: check the `calendar-busy-sync/error` Gmail label.
- Stale incoming messages: check the `calendar-busy-sync/ignored` Gmail label.
- No destination updates: verify sender allowlist, recipient email, subject prefix, and matching direction-specific secrets.
