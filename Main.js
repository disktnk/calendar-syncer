function send() {
  return sendOutgoingSnapshot(getSendDirectionForDeployment(getDeploymentSide()));
}

function receive() {
  return processIncomingSnapshots(getReceiveDirectionForDeployment(getDeploymentSide()));
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
