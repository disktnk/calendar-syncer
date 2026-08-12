function installTriggers() {
  deleteTriggers();

  getDeploymentSide();

  createDailyTrigger('send', 12, 0);
  createDailyTrigger('send', 18, 0);
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
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(minute)
    .create();
}
