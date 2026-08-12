function sendOutgoingSnapshot(direction) {
  return withScriptLock(function() {
    const config = getConfig(direction);
    const secret = getSecret(config);
    const result = buildSnapshotPayload(direction, new Date());
    const payloadJson = JSON.stringify(result.payload);
    const payloadHash = sha256Hex(payloadJson);
    const props = getScriptProperties();
    const lastHash = props.getProperty(config.lastSentHashPropertyName);
    const fullSendDue = isPeriodicFullSendDue(config, new Date());

    if (payloadHash === lastHash && !fullSendDue) {
      logInfo('snapshot unchanged', {
        direction: direction,
        windowStart: result.payload.windowStart,
        windowEnd: result.payload.windowEnd,
        scanned: result.stats.scanned,
        blocks: result.stats.blocks
      });
      return {
        sent: false,
        reason: 'unchanged',
        stats: result.stats
      };
    }

    const signature = signPayload(payloadJson, secret);
    sendSnapshotEmail(config, payloadJson, signature, result.payload.generatedAt);
    props.setProperty(config.lastSentHashPropertyName, payloadHash);
    props.setProperty(config.lastSentAtPropertyName, result.payload.generatedAt);
    if (fullSendDue) {
      props.setProperty(config.lastFullSentSlotPropertyName, getCurrentFullSendSlot(config, new Date()));
    }

    logInfo('snapshot sent', {
      direction: direction,
      windowStart: result.payload.windowStart,
      windowEnd: result.payload.windowEnd,
      scanned: result.stats.scanned,
      blocks: result.stats.blocks
    });
    return {
      sent: true,
      stats: result.stats
    };
  });
}

function isPeriodicFullSendDue(config, now) {
  const slot = getCurrentFullSendSlot(config, now);
  if (!slot) return false;
  return getScriptProperties().getProperty(config.lastFullSentSlotPropertyName) !== slot;
}

function getCurrentFullSendSlot(config, now) {
  const hour = Number(Utilities.formatDate(now, config.timezone, 'H'));
  const date = Utilities.formatDate(now, config.timezone, 'yyyy-MM-dd');
  if (hour >= 12 && hour < 18) return date + 'T12';
  if (hour >= 18) return date + 'T18';
  return null;
}
