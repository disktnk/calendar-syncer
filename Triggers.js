function installTriggers() {
  deleteTriggers();

  getDeploymentSide();

  createDailyTrigger('send', 9, 0);
  createDailyTrigger('send', 12, 0);
  createDailyTrigger('send', 15, 0);
  createDailyTrigger('send', 18, 0);
  createIntervalTrigger('receive', 15);
}

function deleteTriggers() {
  const managedFunctions = [
    'send',
    'receive',
    'sendPrimaryToSecondary',
    'processPrimaryToSecondary',
    'sendSecondaryToPrimary',
    'processSecondaryToPrimary'
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (managedFunctions.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function createDailyTrigger(functionName, hour, minute) {
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(minute)
    .create();
}

function createIntervalTrigger(functionName, minutes) {
  // Keep receive as one interval trigger and let receive() skip weekends and
  // off-hours. Time-bounded 15-minute triggers would exceed Apps Script's limit.
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyMinutes(minutes)
    .create();
}
