function installTriggers() {
  deleteTriggers();

  getDeploymentSide();

  createDailyTrigger('send', 9, 0);
  createDailyTrigger('send', 12, 0);
  createDailyTrigger('send', 18, 0);
  createDailyTrigger('receive', 9, 10);
  createDailyTrigger('receive', 12, 10);
  createDailyTrigger('receive', 18, 10);
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
  // Keep these daily and let send()/receive() skip weekends. Expanding 6 daily
  // triggers across 5 weekdays would exceed Apps Script's 20 triggers/script limit.
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(minute)
    .create();
}
