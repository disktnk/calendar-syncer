  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function hasAttendeeEmail(event, email) {
    const target = normalizeEmail(email);
    return (event.attendees || []).some(function(attendee) {
      return normalizeEmail(attendee.email) === target;
    });
  }

  function hasNoSyncToken(summary, tokens) {
    const value = String(summary || '').toLowerCase();
    return (tokens || []).some(function(token) {
      return value.indexOf(String(token).toLowerCase()) !== -1;
    });
  }

  function eventTypeOf(event) {
    return event.eventType || 'default';
  }

  function isMirrorEvent(event, direction) {
    const privateProps = event && event.extendedProperties && event.extendedProperties.private;
    if (!privateProps || privateProps.busyMirror !== '1') {
      return false;
    }
    return !direction || privateProps.direction === direction;
  }

  function isAcceptedBySourceUser(event, config) {
    const attendees = event.attendees || [];
    const sourceEmail = normalizeEmail(config.sourceAccountEmail);
    const selfAttendee = attendees.find(function(attendee) {
      return attendee.self === true || normalizeEmail(attendee.email) === sourceEmail;
    });

    if (selfAttendee) {
      if (selfAttendee.responseStatus === 'accepted') return true;
      if (selfAttendee.responseStatus === 'tentative') return config.includeTentative === true;
      return false;
    }

    if (attendees.length === 0) {
      if (event.creator && event.creator.self === true) return true;
      if (event.organizer && event.organizer.self === true) return true;
      if (normalizeEmail(event.creator && event.creator.email) === sourceEmail) return true;
      if (normalizeEmail(event.organizer && event.organizer.email) === sourceEmail) return true;
    }

    return false;
  }

  function shouldIncludeAllDayEvent(event, config) {
    const isAllDay = !!(event.start && event.start.date);
    if (!isAllDay) {
      return true;
    }
    if (eventTypeOf(event) === 'outOfOffice') {
      return config.includeAllDayOutOfOffice === true;
    }
    return config.includeAllDayDefault === true;
  }

  function shouldSyncEvent(event, sourceCalendarId, config) {
    if (!event) return false;
    if (event.status === 'cancelled') return false;
    if (isMirrorEvent(event)) return false;
    if (hasNoSyncToken(event.summary, config.manualNoSyncTokens)) return false;
    if (hasAttendeeEmail(event, config.otherAccountEmail)) return false;
    if (event.transparency === 'transparent') return false;

    const type = eventTypeOf(event);
    if ((config.excludeEventTypes || []).indexOf(type) !== -1) return false;
    if ((config.includeEventTypes || []).indexOf(type) === -1) return false;
    if (!isAcceptedBySourceUser(event, config)) return false;
    if (!shouldIncludeAllDayEvent(event, config)) return false;

    return true;
  }
