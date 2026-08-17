function send() {
  const direction = getSendDirectionForDeployment(getDeploymentSide());
  if (!shouldRunOnWeekday(direction, new Date())) {
    logInfo('send skipped on weekend', { direction: direction });
    return {
      skipped: true,
      reason: 'weekend'
    };
  }
  return sendOutgoingSnapshot(direction);
}

function receive() {
  const direction = getReceiveDirectionForDeployment(getDeploymentSide());
  if (!shouldRunOnWeekday(direction, new Date())) {
    logInfo('receive skipped on weekend', { direction: direction });
    return {
      skipped: true,
      reason: 'weekend'
    };
  }
  return processIncomingSnapshots(direction);
}

function shouldRunOnWeekday(direction, now) {
  const config = CONFIGS[direction];
  if (!config) {
    throw new Error('Unknown sync direction: ' + direction);
  }
  return isWeekdayInTimezone(config.timezone, now);
}

function isWeekdayInTimezone(timezone, now) {
  const dateText = Utilities.formatDate(now || new Date(), timezone, 'yyyy-MM-dd');
  const parts = dateText.split('-').map(function(part) {
    return Number(part);
  });
  const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return day >= 1 && day <= 5;
}

function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Could not acquire script lock');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function logInfo(message, data) {
  const safeData = data || {};
  console.log(message + ' ' + JSON.stringify(safeData));
}
