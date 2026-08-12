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

function blockFromEvent(event, sourceCalendarId, config, secret) {
  return {
    sourceKey: buildSourceKey(event, sourceCalendarId, config.direction, secret),
    start: copyCalendarDateTime(event.start),
    end: copyCalendarDateTime(event.end),
    allDay: !!(event.start && event.start.date)
  };
}

function copyCalendarDateTime(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function compareBlocks(a, b) {
  return String(a.sourceKey).localeCompare(String(b.sourceKey)) ||
    JSON.stringify(a.start).localeCompare(JSON.stringify(b.start)) ||
    JSON.stringify(a.end).localeCompare(JSON.stringify(b.end));
}

function createMirrorEventResource(block, config) {
  return {
    summary: getMirrorEventSummary(config),
    start: copyCalendarDateTime(block.start),
    end: copyCalendarDateTime(block.end),
    transparency: 'opaque',
    visibility: 'private',
    attendees: [],
    reminders: {
      useDefault: false
    },
    extendedProperties: {
      private: {
        busyMirror: '1',
        direction: config.direction,
        sourceKey: block.sourceKey
      }
    }
  };
}

function privatePropsOf(event) {
  return event && event.extendedProperties && event.extendedProperties.private || {};
}

function calendarDateTimesEqual(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function eventsEqualManagedState(event, block, config) {
  const props = privatePropsOf(event);
  const attendees = event.attendees || [];
  return event.summary === getMirrorEventSummary(config) &&
    calendarDateTimesEqual(event.start, block.start) &&
    calendarDateTimesEqual(event.end, block.end) &&
    event.transparency === 'opaque' &&
    event.visibility === 'private' &&
    attendees.length === 0 &&
    !event.description &&
    !event.location &&
    !event.conferenceData &&
    (!event.reminders || event.reminders.useDefault === false) &&
    props.busyMirror === '1' &&
    props.direction === config.direction &&
    props.sourceKey === block.sourceKey;
}

function eventOverlapsWindow(event, windowStart, windowEnd) {
  const start = event.start && (event.start.dateTime || event.start.date);
  const end = event.end && (event.end.dateTime || event.end.date);
  if (!start || !end) return false;
  return String(start) < String(windowEnd) && String(end) > String(windowStart);
}

function buildSnapshotPayload(direction, now) {
  const config = getConfig(direction);
  const secret = getSecret(config);
  const window = computeSyncWindow(config, now || new Date());
  const blocks = [];
  let scanned = 0;

  config.sourceCalendarIds.forEach(function(calendarId) {
    const events = listSourceEvents(calendarId, window.windowStart, window.windowEnd);
    scanned += events.length;
    events.forEach(function(event) {
      if (shouldSyncEvent(event, calendarId, config)) {
        blocks.push(blockFromEvent(event, calendarId, config, secret));
      }
    });
  });

  blocks.sort(compareBlocks);

  return {
    payload: {
      version: 1,
      direction: direction,
      generatedAt: (now || new Date()).toISOString(),
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      blocks: blocks
    },
    stats: {
      scanned: scanned,
      blocks: blocks.length
    }
  };
}

function computeSyncWindow(config, now) {
  const dateText = Utilities.formatDate(now, config.timezone, 'yyyy-MM-dd');
  const windowStart = dateText + 'T00:00:00';
  const startDate = new Date(dateText + 'T00:00:00Z');
  const endDate = new Date(startDate.getTime() + getConfiguredWindowDays(config) * 24 * 60 * 60 * 1000);
  const endText = Utilities.formatDate(endDate, 'UTC', 'yyyy-MM-dd');
  return {
    windowStart: windowStart + formatTimezoneOffset(now, config.timezone),
    windowEnd: endText + 'T00:00:00' + formatTimezoneOffset(now, config.timezone)
  };
}

function formatTimezoneOffset(date, timezone) {
  const value = Utilities.formatDate(date, timezone, 'Z');
  return value.slice(0, 3) + ':' + value.slice(3);
}

function listSourceEvents(calendarId, windowStartIso, windowEndIso) {
  const events = [];
  let pageToken = null;
  do {
    const response = Calendar.Events.list(calendarId, {
      timeMin: windowStartIso,
      timeMax: windowEndIso,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken: pageToken || undefined
    });
    (response.items || []).forEach(function(event) {
      events.push(event);
    });
    pageToken = response.nextPageToken;
  } while (pageToken);
  return events;
}

function listDestinationMirrorEvents(config, windowStart, windowEnd, calendarApi) {
  const api = calendarApi || Calendar.Events;
  const events = [];
  let pageToken = null;
  do {
    const response = api.list(config.destinationCalendarId, {
      timeMin: windowStart,
      timeMax: windowEnd,
      singleEvents: true,
      maxResults: 2500,
      pageToken: pageToken || undefined,
      privateExtendedProperty: 'busyMirror=1'
    });
    (response.items || []).forEach(function(event) {
      if (isMirrorEvent(event, config.direction) && eventOverlapsWindow(event, windowStart, windowEnd)) {
        events.push(event);
      }
    });
    pageToken = response.nextPageToken;
  } while (pageToken);
  return events;
}

function applySnapshotPayload(payload, config, calendarApi) {
  if (!payload || payload.version !== 1) {
    throw new Error('Unsupported or missing payload version');
  }
  if (payload.direction !== config.direction) {
    throw new Error('Unexpected payload direction');
  }

  const api = calendarApi || Calendar.Events;
  const existingEvents = listDestinationMirrorEvents(config, payload.windowStart, payload.windowEnd, api);
  const bySourceKey = {};
  existingEvents.forEach(function(event) {
    const sourceKey = privatePropsOf(event).sourceKey;
    if (sourceKey) {
      bySourceKey[sourceKey] = event;
    }
  });

  const seenKeys = {};
  const stats = {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0
  };

  (payload.blocks || []).forEach(function(block) {
    seenKeys[block.sourceKey] = true;
    const existing = bySourceKey[block.sourceKey];
    const resource = createMirrorEventResource(block, config);
    if (!existing) {
      api.insert(resource, config.destinationCalendarId);
      stats.created += 1;
    } else if (!eventsEqualManagedState(existing, block, config)) {
      api.update(resource, config.destinationCalendarId, existing.id);
      stats.updated += 1;
    } else {
      stats.unchanged += 1;
    }
  });

  existingEvents.forEach(function(event) {
    const sourceKey = privatePropsOf(event).sourceKey;
    if (!sourceKey || !seenKeys[sourceKey]) {
      api.remove(config.destinationCalendarId, event.id);
      stats.deleted += 1;
    }
  });

  return stats;
}
