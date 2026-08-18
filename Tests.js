function runTests() {
  const tests = [
    testNoSyncFiltering,
    testAttendanceFiltering,
    testOtherFilteringRules,
    testAllDayFiltering,
    testSourceKey,
    testPayloadPrivacyAndSignature,
    testApplySnapshotInsertIdempotentUpdateDelete,
    testOutOfOfficeMirrorEvents,
    testInvalidSignature,
    testStaleGeneratedAtComparison,
    testConfiguredWindowDaysOverride,
    testConfiguredEmailProperties,
    testMirrorEventSummaryLabel,
    testDeploymentSideEntryPoints,
    testWeekdayEntryPointGuard,
    testReceiveTimeWindowGuard
  ];

  tests.forEach(function(test) {
    test();
  });

  console.log('All tests passed: ' + tests.length);
}

function assertTrue(value, message) {
  if (value !== true) {
    throw new Error('Assertion failed: ' + message);
  }
}

function assertFalse(value, message) {
  if (value !== false) {
    throw new Error('Assertion failed: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error('Assertion failed: ' + message + '. Expected ' + expected + ', got ' + actual);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error('Assertion failed: ' + message + '. Expected ' + expectedJson + ', got ' + actualJson);
  }
}

function testConfig(overrides) {
  const base = JSON.parse(JSON.stringify(CONFIGS.PRIMARY_TO_SECONDARY));
  Object.keys(overrides || {}).forEach(function(key) {
    base[key] = overrides[key];
  });
  return base;
}

function baseEvent(overrides) {
  const event = {
    id: 'event-1',
    status: 'confirmed',
    summary: 'Planning',
    start: {
      dateTime: '2026-08-03T13:00:00+09:00',
      timeZone: 'Asia/Tokyo'
    },
    end: {
      dateTime: '2026-08-03T14:00:00+09:00',
      timeZone: 'Asia/Tokyo'
    },
    eventType: 'default',
    attendees: [
      {
        email: 'primary.user@example.com',
        self: true,
        responseStatus: 'accepted'
      }
    ],
    creator: {
      email: 'primary.user@example.com',
      self: true
    },
    organizer: {
      email: 'primary.user@example.com',
      self: true
    }
  };
  Object.keys(overrides || {}).forEach(function(key) {
    event[key] = overrides[key];
  });
  return event;
}

function testNoSyncFiltering() {
  const config = testConfig();
  assertFalse(shouldSyncEvent(baseEvent({ summary: '[nosync] Customer meeting' }), 'primary', config), 'lowercase nosync excludes event');
  assertFalse(shouldSyncEvent(baseEvent({ summary: 'Customer meeting [NOSYNC]' }), 'primary', config), 'uppercase nosync excludes event');
}

function testAttendanceFiltering() {
  const config = testConfig();
  assertTrue(shouldSyncEvent(baseEvent(), 'primary', config), 'accepted event is included');
  assertFalse(shouldSyncEvent(baseEvent({ attendees: [{ email: 'primary.user@example.com', self: true, responseStatus: 'tentative' }] }), 'primary', config), 'tentative event is excluded by default');
  assertTrue(shouldSyncEvent(baseEvent({ attendees: [{ email: 'primary.user@example.com', self: true, responseStatus: 'tentative' }] }), 'primary', testConfig({ includeTentative: true })), 'tentative event is included when configured');
  assertFalse(shouldSyncEvent(baseEvent({ attendees: [{ email: 'primary.user@example.com', self: true, responseStatus: 'declined' }] }), 'primary', config), 'declined event is excluded');
  assertFalse(shouldSyncEvent(baseEvent({ attendees: [{ email: 'primary.user@example.com', self: true, responseStatus: 'needsAction' }] }), 'primary', config), 'needsAction event is excluded');
  assertTrue(shouldSyncEvent(baseEvent({ attendees: [] }), 'primary', config), 'attendee-less self-created event is included');
  assertFalse(shouldSyncEvent(baseEvent({ attendees: [{ email: 'primary.user@example.com', self: true, responseStatus: 'accepted' }, { email: config.otherAccountEmail }] }), 'primary', config), 'event visible to other account is excluded');
}

function testOtherFilteringRules() {
  const config = testConfig();
  assertFalse(shouldSyncEvent(baseEvent({ transparency: 'transparent' }), 'primary', config), 'transparent event is excluded');
  assertFalse(shouldSyncEvent(baseEvent({ eventType: 'birthday' }), 'primary', config), 'birthday event is excluded');
  assertFalse(shouldSyncEvent(baseEvent({ eventType: 'workingLocation' }), 'primary', config), 'workingLocation event is excluded');
  assertFalse(shouldSyncEvent(baseEvent({ eventType: 'fromGmail' }), 'primary', config), 'fromGmail event is excluded');
  assertTrue(shouldSyncEvent(baseEvent({ eventType: 'outOfOffice' }), 'primary', config), 'outOfOffice event is included');
  assertTrue(shouldSyncEvent(baseEvent({ eventType: 'focusTime' }), 'primary', config), 'focusTime event is included');
  assertFalse(shouldSyncEvent(baseEvent({ extendedProperties: { private: { busyMirror: '1' } } }), 'primary', config), 'mirror event is excluded');
}

function testAllDayFiltering() {
  const config = testConfig();
  const allDayStart = { date: '2026-08-03' };
  const allDayEnd = { date: '2026-08-04' };
  assertFalse(shouldSyncEvent(baseEvent({ start: allDayStart, end: allDayEnd }), 'primary', config), 'normal all-day event is excluded');
  assertFalse(shouldSyncEvent(baseEvent({ start: allDayStart, end: allDayEnd, eventType: 'outOfOffice' }), 'primary', config), 'all-day outOfOffice event is excluded');
}

function testSourceKey() {
  const config = testConfig();
  const secret = 'test-secret';
  const event = baseEvent();
  const first = buildSourceKey(event, 'source-calendar', config.direction, secret);
  const second = buildSourceKey(event, 'source-calendar', config.direction, secret);
  const otherId = buildSourceKey(baseEvent({ id: 'event-2' }), 'source-calendar', config.direction, secret);
  const otherDirection = buildSourceKey(event, 'source-calendar', SYNC_DIRECTIONS.SECONDARY_TO_PRIMARY, secret);
  const recurring = buildSourceKey(baseEvent({
    id: 'instance-1',
    recurringEventId: 'series-1',
    originalStartTime: { dateTime: '2026-08-03T13:00:00+09:00' }
  }), 'source-calendar', config.direction, secret);

  assertEqual(first, second, 'same event produces stable sourceKey');
  assertTrue(first !== otherId, 'different event id changes sourceKey');
  assertTrue(first !== otherDirection, 'different direction changes sourceKey');
  assertTrue(first.indexOf('event-1') === -1, 'raw event id is not visible');
  assertEqual(recurring, buildSourceKey(baseEvent({
    id: 'instance-1',
    recurringEventId: 'series-1',
    originalStartTime: { dateTime: '2026-08-03T13:00:00+09:00' }
  }), 'source-calendar', config.direction, secret), 'recurring instance key is stable');
}

function testPayloadPrivacyAndSignature() {
  const config = testConfig();
  const event = baseEvent({
    id: 'raw-event-id',
    summary: 'Secret Customer Meeting',
    description: 'Sensitive description',
    location: 'Secret room'
  });
  const block = blockFromEvent(event, 'source-calendar-id', config, 'test-secret');
  const payloadJson = JSON.stringify({
    version: 1,
    direction: config.direction,
    generatedAt: '2026-07-30T03:00:00.000Z',
    windowStart: '2026-07-30T00:00:00+09:00',
    windowEnd: '2026-09-03T00:00:00+09:00',
    blocks: [block]
  });
  const envelope = {
    payloadJson: payloadJson,
    signature: signPayload(payloadJson, 'test-secret')
  };

  assertTrue(payloadJson.indexOf('Secret Customer Meeting') === -1, 'payload excludes source summary');
  assertTrue(payloadJson.indexOf('Sensitive description') === -1, 'payload excludes source description');
  assertTrue(payloadJson.indexOf('Secret room') === -1, 'payload excludes source location');
  assertTrue(payloadJson.indexOf('attendees') === -1, 'payload excludes attendees');
  assertTrue(payloadJson.indexOf('raw-event-id') === -1, 'payload excludes raw event id');
  assertTrue(verifyEnvelope(envelope, 'test-secret'), 'signature verifies');
}

function testApplySnapshotInsertIdempotentUpdateDelete() {
  const originalGetScriptProperties = getScriptProperties;
  const config = testConfig();
  const api = createMockCalendarApi([]);
  const payload = {
    version: 1,
    direction: config.direction,
    generatedAt: '2026-07-30T03:00:00.000Z',
    windowStart: '2026-07-30T00:00:00+09:00',
    windowEnd: '2026-09-03T00:00:00+09:00',
    blocks: [
      {
        sourceKey: 'key-1',
        start: { dateTime: '2026-08-03T13:00:00+09:00', timeZone: 'Asia/Tokyo' },
        end: { dateTime: '2026-08-03T14:00:00+09:00', timeZone: 'Asia/Tokyo' },
        allDay: false
      }
    ]
  };

  try {
    getScriptProperties = function() {
      return {
        getProperty: function() {
          return null;
        }
      };
    };

    let stats = applySnapshotPayload(payload, config, api);
    assertEqual(stats.created, 1, 'new block inserts event');
    assertEqual(api.events.length, 1, 'destination has one event');

    stats = applySnapshotPayload(payload, config, api);
    assertEqual(stats.created, 0, 'same snapshot does not insert again');
    assertEqual(stats.unchanged, 1, 'same snapshot is unchanged');
    assertEqual(api.events.length, 1, 'destination still has one event');

    const changedPayload = JSON.parse(JSON.stringify(payload));
    changedPayload.blocks[0].end = { dateTime: '2026-08-03T15:00:00+09:00', timeZone: 'Asia/Tokyo' };
    stats = applySnapshotPayload(changedPayload, config, api);
    assertEqual(stats.updated, 1, 'changed block updates existing event');
    assertDeepEqual(api.events[0].end, changedPayload.blocks[0].end, 'event end was updated');

    const emptyPayload = JSON.parse(JSON.stringify(payload));
    emptyPayload.blocks = [];
    stats = applySnapshotPayload(emptyPayload, config, api);
    assertEqual(stats.deleted, 1, 'missing block deletes old mirror event');
    assertEqual(api.events.length, 0, 'mirror event was deleted');

    const nonMirrorApi = createMockCalendarApi([
      {
        id: 'manual-1',
        summary: 'Manual',
        start: { dateTime: '2026-08-03T13:00:00+09:00' },
        end: { dateTime: '2026-08-03T14:00:00+09:00' }
      }
    ]);
    applySnapshotPayload(emptyPayload, config, nonMirrorApi);
    assertEqual(nonMirrorApi.events.length, 1, 'non-mirror destination event is never deleted');
  } finally {
    getScriptProperties = originalGetScriptProperties;
  }
}

function testOutOfOfficeMirrorEvents() {
  const originalGetScriptProperties = getScriptProperties;
  const config = testConfig();
  const event = baseEvent({ eventType: 'outOfOffice' });
  const block = blockFromEvent(event, 'source-calendar-id', config, 'test-secret');
  const payload = {
    version: 1,
    direction: config.direction,
    generatedAt: '2026-07-30T03:00:00.000Z',
    windowStart: '2026-07-30T00:00:00+09:00',
    windowEnd: '2026-09-03T00:00:00+09:00',
    blocks: [block]
  };

  try {
    getScriptProperties = function() {
      return {
        getProperty: function() {
          return null;
        }
      };
    };

    assertEqual(block.eventType, 'outOfOffice', 'outOfOffice event type is included in the block');

    const api = createMockCalendarApi([]);
    let stats = applySnapshotPayload(payload, config, api);
    assertEqual(stats.created, 1, 'outOfOffice block inserts event');
    assertEqual(api.events[0].eventType, 'outOfOffice', 'destination event is outOfOffice');
    assertEqual(api.events[0].outOfOfficeProperties.autoDeclineMode, 'declineNone', 'destination outOfOffice does not auto-decline');

    stats = applySnapshotPayload(payload, config, api);
    assertEqual(stats.unchanged, 1, 'same outOfOffice snapshot is unchanged');

    const existingDefaultApi = createMockCalendarApi([
      createMirrorEventResource({
        sourceKey: block.sourceKey,
        start: block.start,
        end: block.end,
        allDay: false
      }, config)
    ]);
    existingDefaultApi.events[0].id = 'existing-default';
    stats = applySnapshotPayload(payload, config, existingDefaultApi);
    assertEqual(stats.updated, 1, 'default mirror is recreated when it becomes outOfOffice');
    assertEqual(existingDefaultApi.events.length, 1, 'recreate leaves one mirror event');
    assertEqual(existingDefaultApi.events[0].eventType, 'outOfOffice', 'recreated event is outOfOffice');
  } finally {
    getScriptProperties = originalGetScriptProperties;
  }
}

function testInvalidSignature() {
  const payloadJson = JSON.stringify({ version: 1, direction: 'PRIMARY_TO_SECONDARY' });
  const envelope = {
    payloadJson: payloadJson,
    signature: signPayload(payloadJson, 'test-secret')
  };
  envelope.payloadJson = JSON.stringify({ version: 1, direction: 'SECONDARY_TO_PRIMARY' });
  assertFalse(verifyEnvelope(envelope, 'test-secret'), 'signature fails after payload modification');
}

function testStaleGeneratedAtComparison() {
  assertTrue(isGeneratedAtStale('2026-07-30T03:00:00.000Z', '2026-07-30T03:00:00.000Z'), 'same generatedAt is stale');
  assertTrue(isGeneratedAtStale('2026-07-30T02:59:59.000Z', '2026-07-30T03:00:00.000Z'), 'older generatedAt is stale');
  assertFalse(isGeneratedAtStale('2026-07-30T03:00:01.000Z', '2026-07-30T03:00:00.000Z'), 'newer generatedAt is not stale');
}

function testConfiguredWindowDaysOverride() {
  const originalGetScriptProperties = getScriptProperties;
  try {
    const values = {};
    getScriptProperties = function() {
      return {
        getProperty: function(name) {
          return values[name] || null;
        }
      };
    };

    assertEqual(getConfiguredWindowDays(testConfig()), 35, 'default window is used when property is missing');
    values.SYNC_WINDOW_DAYS = '1';
    assertEqual(getConfiguredWindowDays(testConfig()), 1, 'shared window override is used for tests');
  } finally {
    getScriptProperties = originalGetScriptProperties;
  }
}

function testConfiguredEmailProperties() {
  const originalGetScriptProperties = getScriptProperties;
  const values = {
    PRIMARY_EMAIL: 'sender@example.com',
    SECONDARY_EMAIL: 'recipient@example.com'
  };

  try {
    getScriptProperties = function() {
      return {
        getProperty: function(name) {
          return values[name] || null;
        }
      };
    };

    const config = getConfig(SYNC_DIRECTIONS.PRIMARY_TO_SECONDARY);
    assertEqual(config.sourceAccountEmail, 'sender@example.com', 'source email comes from script properties');
    assertEqual(config.otherAccountEmail, 'recipient@example.com', 'other account email comes from script properties');
    assertEqual(config.recipientEmail, 'recipient@example.com', 'recipient email comes from script properties');
    assertDeepEqual(config.allowedSenderEmails, ['sender@example.com'], 'sender allowlist comes from script properties');
    assertDeepEqual(config.sourceCalendarIds, ['primary'], 'source calendar uses the primary calendar');
    assertEqual(config.destinationCalendarId, 'primary', 'destination calendar uses the primary calendar');
  } finally {
    getScriptProperties = originalGetScriptProperties;
  }
}

function testMirrorEventSummaryLabel() {
  const originalGetScriptProperties = getScriptProperties;
  const config = testConfig({ sourceLabelPropertyName: 'PRIMARY_LABEL' });
  const block = {
    sourceKey: 'key-1',
    start: { dateTime: '2026-08-03T13:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-08-03T14:00:00+09:00', timeZone: 'Asia/Tokyo' },
    allDay: false
  };
  const values = {};

  try {
    getScriptProperties = function() {
      return {
        getProperty: function(name) {
          return values[name] || null;
        }
      };
    };

    assertEqual(createMirrorEventResource(block, config).summary, 'Busy', 'missing label uses Busy');
    values.PRIMARY_LABEL = 'Primary';
    assertEqual(createMirrorEventResource(block, config).summary, 'Busy: Primary', 'configured label is included');
  } finally {
    getScriptProperties = originalGetScriptProperties;
  }
}

function testDeploymentSideEntryPoints() {
  const originalGetDeploymentSide = getDeploymentSide;
  const originalIsWeekdayInTimezone = isWeekdayInTimezone;
  const originalIsReceiveWindowInTimezone = isReceiveWindowInTimezone;
  const originalSendOutgoingSnapshot = sendOutgoingSnapshot;
  const originalProcessIncomingSnapshots = processIncomingSnapshots;
  const calls = [];

  try {
    getDeploymentSide = function() {
      return DEPLOYMENT_SIDES.SECONDARY;
    };
    isWeekdayInTimezone = function() {
      return true;
    };
    isReceiveWindowInTimezone = function() {
      return true;
    };
    sendOutgoingSnapshot = function(direction) {
      calls.push({ type: 'send', direction: direction });
    };
    processIncomingSnapshots = function(direction) {
      calls.push({ type: 'receive', direction: direction });
    };

    send();
    receive();

    assertDeepEqual(calls, [
      { type: 'send', direction: SYNC_DIRECTIONS.SECONDARY_TO_PRIMARY },
      { type: 'receive', direction: SYNC_DIRECTIONS.PRIMARY_TO_SECONDARY }
    ], 'entry points use DEPLOYMENT_SIDE directions');
  } finally {
    getDeploymentSide = originalGetDeploymentSide;
    isWeekdayInTimezone = originalIsWeekdayInTimezone;
    isReceiveWindowInTimezone = originalIsReceiveWindowInTimezone;
    sendOutgoingSnapshot = originalSendOutgoingSnapshot;
    processIncomingSnapshots = originalProcessIncomingSnapshots;
  }
}

function testWeekdayEntryPointGuard() {
  const originalGetDeploymentSide = getDeploymentSide;
  const originalIsWeekdayInTimezone = isWeekdayInTimezone;
  const originalIsReceiveWindowInTimezone = isReceiveWindowInTimezone;
  const originalSendOutgoingSnapshot = sendOutgoingSnapshot;
  const originalProcessIncomingSnapshots = processIncomingSnapshots;
  const calls = [];

  try {
    getDeploymentSide = function() {
      return DEPLOYMENT_SIDES.PRIMARY;
    };
    isWeekdayInTimezone = function(timezone) {
      assertEqual(timezone, CONFIGS.PRIMARY_TO_SECONDARY.timezone, 'weekday guard uses configured timezone');
      return false;
    };
    isReceiveWindowInTimezone = function() {
      return true;
    };
    sendOutgoingSnapshot = function(direction) {
      calls.push({ type: 'send', direction: direction });
    };
    processIncomingSnapshots = function(direction) {
      calls.push({ type: 'receive', direction: direction });
    };

    assertDeepEqual(send(), { skipped: true, reason: 'weekend' }, 'send skips on weekend');
    assertDeepEqual(receive(), { skipped: true, reason: 'weekend' }, 'receive skips on weekend');
    assertDeepEqual(calls, [], 'weekend guard prevents send and receive work');
  } finally {
    getDeploymentSide = originalGetDeploymentSide;
    isWeekdayInTimezone = originalIsWeekdayInTimezone;
    isReceiveWindowInTimezone = originalIsReceiveWindowInTimezone;
    sendOutgoingSnapshot = originalSendOutgoingSnapshot;
    processIncomingSnapshots = originalProcessIncomingSnapshots;
  }
}

function testReceiveTimeWindowGuard() {
  const originalGetDeploymentSide = getDeploymentSide;
  const originalIsWeekdayInTimezone = isWeekdayInTimezone;
  const originalIsReceiveWindowInTimezone = isReceiveWindowInTimezone;
  const originalProcessIncomingSnapshots = processIncomingSnapshots;
  const calls = [];

  try {
    getDeploymentSide = function() {
      return DEPLOYMENT_SIDES.SECONDARY;
    };
    isWeekdayInTimezone = function() {
      return true;
    };
    isReceiveWindowInTimezone = function(timezone) {
      assertEqual(timezone, CONFIGS.PRIMARY_TO_SECONDARY.timezone, 'receive window uses configured timezone');
      return false;
    };
    processIncomingSnapshots = function(direction) {
      calls.push({ type: 'receive', direction: direction });
    };

    assertDeepEqual(receive(), { skipped: true, reason: 'outside_receive_window' }, 'receive skips outside configured window');
    assertDeepEqual(calls, [], 'receive window guard prevents receive work');
  } finally {
    getDeploymentSide = originalGetDeploymentSide;
    isWeekdayInTimezone = originalIsWeekdayInTimezone;
    isReceiveWindowInTimezone = originalIsReceiveWindowInTimezone;
    processIncomingSnapshots = originalProcessIncomingSnapshots;
  }
}

function createMockCalendarApi(initialEvents) {
  const api = {
    events: JSON.parse(JSON.stringify(initialEvents || [])),
    nextId: 1,
    list: function(calendarId, options) {
      return {
        items: api.events.filter(function(event) {
          return isMirrorEvent(event, CONFIGS.PRIMARY_TO_SECONDARY.direction) &&
            eventOverlapsWindow(event, options.timeMin, options.timeMax);
        })
      };
    },
    insert: function(resource, calendarId) {
      const event = JSON.parse(JSON.stringify(resource));
      event.id = 'mock-' + api.nextId;
      api.nextId += 1;
      api.events.push(event);
      return event;
    },
    update: function(resource, calendarId, eventId) {
      const event = JSON.parse(JSON.stringify(resource));
      event.id = eventId;
      for (let i = 0; i < api.events.length; i += 1) {
        if (api.events[i].id === eventId) {
          api.events[i] = event;
          return event;
        }
      }
      throw new Error('Mock event not found: ' + eventId);
    },
    remove: function(calendarId, eventId) {
      api.events = api.events.filter(function(event) {
        return event.id !== eventId;
      });
    }
  };
  return api;
}
