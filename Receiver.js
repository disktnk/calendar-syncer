function processIncomingSnapshots(direction) {
  return withScriptLock(function() {
    const config = getConfig(direction);
    const secret = getSecret(config);
    const labels = getSyncLabels();
    const messages = findIncomingSnapshotMessages(config);
    const candidates = [];
    let errors = 0;
    let ignored = 0;

    messages.forEach(function(message) {
      const parsed = parseSnapshotMessage(message, config, secret);
      if (parsed.status === 'valid') {
        candidates.push(parsed);
      } else if (parsed.status === 'ignored') {
        addLabelToMessage(message, labels.ignored);
        ignored += 1;
      } else {
        addLabelToMessage(message, labels.error);
        errors += 1;
      }
    });

    if (candidates.length === 0) {
      logInfo('no applicable snapshots', {
        direction: direction,
        emailsProcessed: messages.length
      });
      return {
        applied: false,
        errors: errors,
        ignored: ignored
      };
    }

    candidates.sort(function(a, b) {
      return String(b.payload.generatedAt).localeCompare(String(a.payload.generatedAt));
    });

    const newest = candidates[0];
    const stats = applySnapshotPayload(newest.payload, config);
    getScriptProperties().setProperty(config.lastAppliedGeneratedAtPropertyName, newest.payload.generatedAt);
    addLabelToMessage(newest.message, labels.processed);

    candidates.slice(1).forEach(function(candidate) {
      addLabelToMessage(candidate.message, labels.ignored);
      ignored += 1;
    });

    logInfo('snapshot applied', {
      direction: direction,
      windowStart: newest.payload.windowStart,
      windowEnd: newest.payload.windowEnd,
      emailsProcessed: messages.length,
      created: stats.created,
      updated: stats.updated,
      deleted: stats.deleted
    });

    return {
      applied: true,
      stats: stats,
      errors: errors,
      ignored: ignored
    };
  });
}

function parseSnapshotMessage(message, config, secret) {
  const sender = extractEmailAddress(message.getFrom());
  if (config.allowedSenderEmails.map(normalizeEmail).indexOf(sender) === -1) {
    return {
      status: 'error',
      reason: 'sender_not_allowed',
      message: message
    };
  }

  let envelope;
  try {
    envelope = JSON.parse(message.getPlainBody());
  } catch (error) {
    return {
      status: 'error',
      reason: 'invalid_envelope_json',
      message: message
    };
  }

  if (!verifyEnvelope(envelope, secret)) {
    return {
      status: 'error',
      reason: 'invalid_signature',
      message: message
    };
  }

  let payload;
  try {
    payload = JSON.parse(envelope.payloadJson);
  } catch (error) {
    return {
      status: 'error',
      reason: 'invalid_payload_json',
      message: message
    };
  }

  if (payload.version !== 1 || payload.direction !== config.direction) {
    return {
      status: 'error',
      reason: 'unexpected_payload',
      message: message
    };
  }

  const lastApplied = getScriptProperties().getProperty(config.lastAppliedGeneratedAtPropertyName);
  if (isGeneratedAtStale(payload.generatedAt, lastApplied)) {
    return {
      status: 'ignored',
      reason: 'stale',
      message: message
    };
  }

  return {
    status: 'valid',
    message: message,
    payload: payload
  };
}

function isGeneratedAtStale(generatedAt, lastAppliedGeneratedAt) {
  return !!lastAppliedGeneratedAt && String(generatedAt) <= String(lastAppliedGeneratedAt);
}
