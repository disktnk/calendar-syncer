const SYNC_DIRECTIONS = {
  PRIMARY_TO_SECONDARY: 'PRIMARY_TO_SECONDARY',
  SECONDARY_TO_PRIMARY: 'SECONDARY_TO_PRIMARY'
};

const DEPLOYMENT_SIDES = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY'
};

const CONFIGS = {
  PRIMARY_TO_SECONDARY: {
    direction: 'PRIMARY_TO_SECONDARY',
    sourceAccountEmail: 'primary.user@example.com',
    sourceAccountEmailPropertyName: 'PRIMARY_EMAIL',
    otherAccountEmail: 'secondary.user@example.com',
    otherAccountEmailPropertyName: 'SECONDARY_EMAIL',
    sourceCalendarIds: ['primary'],
    destinationCalendarId: 'primary',
    recipientEmail: 'secondary.user@example.com',
    recipientEmailPropertyName: 'SECONDARY_EMAIL',
    allowedSenderEmails: ['primary.user@example.com'],
    allowedSenderEmailsPropertyName: 'PRIMARY_EMAIL',
    subjectPrefix: '[calendar-busy-sync]',
    windowDays: 35,
    timezone: 'Asia/Tokyo',
    manualNoSyncTokens: ['[nosync]'],
    includeTentative: false,
    includeEventTypes: ['default', 'focusTime', 'outOfOffice'],
    excludeEventTypes: ['birthday', 'workingLocation', 'fromGmail'],
    includeAllDayDefault: false,
    includeAllDayOutOfOffice: true,
    scriptPropertySecretName: 'SYNC_SECRET_PRIMARY_TO_SECONDARY',
    sourceLabelPropertyName: 'PRIMARY_LABEL',
    lastSentHashPropertyName: 'LAST_SENT_HASH_PRIMARY_TO_SECONDARY',
    lastSentAtPropertyName: 'LAST_SENT_AT_PRIMARY_TO_SECONDARY',
    lastFullSentSlotPropertyName: 'LAST_FULL_SENT_SLOT_PRIMARY_TO_SECONDARY',
    lastAppliedGeneratedAtPropertyName: 'LAST_APPLIED_GENERATED_AT_PRIMARY_TO_SECONDARY'
  },

  SECONDARY_TO_PRIMARY: {
    direction: 'SECONDARY_TO_PRIMARY',
    sourceAccountEmail: 'secondary.user@example.com',
    sourceAccountEmailPropertyName: 'SECONDARY_EMAIL',
    otherAccountEmail: 'primary.user@example.com',
    otherAccountEmailPropertyName: 'PRIMARY_EMAIL',
    sourceCalendarIds: ['primary'],
    destinationCalendarId: 'primary',
    recipientEmail: 'primary.user@example.com',
    recipientEmailPropertyName: 'PRIMARY_EMAIL',
    allowedSenderEmails: ['secondary.user@example.com'],
    allowedSenderEmailsPropertyName: 'SECONDARY_EMAIL',
    subjectPrefix: '[calendar-busy-sync]',
    windowDays: 35,
    timezone: 'Asia/Tokyo',
    manualNoSyncTokens: ['[nosync]'],
    includeTentative: false,
    includeEventTypes: ['default', 'focusTime', 'outOfOffice'],
    excludeEventTypes: ['birthday', 'workingLocation', 'fromGmail'],
    includeAllDayDefault: false,
    includeAllDayOutOfOffice: true,
    scriptPropertySecretName: 'SYNC_SECRET_SECONDARY_TO_PRIMARY',
    sourceLabelPropertyName: 'SECONDARY_LABEL',
    lastSentHashPropertyName: 'LAST_SENT_HASH_SECONDARY_TO_PRIMARY',
    lastSentAtPropertyName: 'LAST_SENT_AT_SECONDARY_TO_PRIMARY',
    lastFullSentSlotPropertyName: 'LAST_FULL_SENT_SLOT_SECONDARY_TO_PRIMARY',
    lastAppliedGeneratedAtPropertyName: 'LAST_APPLIED_GENERATED_AT_SECONDARY_TO_PRIMARY'
  }
};

function getConfig(direction) {
  const config = CONFIGS[direction];
  if (!config) {
    throw new Error('Unknown sync direction: ' + direction);
  }
  return applyEmailProperties(config);
}

function applyEmailProperties(config) {
  const resolved = JSON.parse(JSON.stringify(config));
  const props = getScriptProperties();
  resolved.sourceAccountEmail = getRequiredEmailProperty(props, config.sourceAccountEmailPropertyName);
  resolved.otherAccountEmail = getRequiredEmailProperty(props, config.otherAccountEmailPropertyName);
  resolved.recipientEmail = getRequiredEmailProperty(props, config.recipientEmailPropertyName);
  resolved.allowedSenderEmails = [getRequiredEmailProperty(props, config.allowedSenderEmailsPropertyName)];
  return resolved;
}

function getRequiredProperty(props, propertyName) {
  const value = String(props.getProperty(propertyName) || '').trim();
  if (!value) {
    throw new Error('Missing script property: ' + propertyName);
  }
  return value;
}

function getRequiredEmailProperty(props, propertyName) {
  return getRequiredProperty(props, propertyName);
}

function getScriptProperties() {
  return PropertiesService.getScriptProperties();
}

function getConfiguredWindowDays(config) {
  const props = getScriptProperties();
  const rawValue = props.getProperty('SYNC_WINDOW_DAYS');
  if (!rawValue) {
    return config.windowDays;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Invalid sync window days: ' + rawValue);
  }
  return value;
}

function getMirrorEventSummary(config) {
  const label = String(getScriptProperties().getProperty(config.sourceLabelPropertyName) || '').trim();
  if (!label) {
    return 'Busy';
  }
  return 'Busy: ' + label;
}

function getDeploymentSide() {
  const side = getScriptProperties().getProperty('DEPLOYMENT_SIDE');
  if (side !== DEPLOYMENT_SIDES.PRIMARY && side !== DEPLOYMENT_SIDES.SECONDARY) {
    throw new Error('Set script property DEPLOYMENT_SIDE to PRIMARY or SECONDARY before installing triggers');
  }
  return side;
}

function getDirectionsForDeployment(side) {
  if (side === DEPLOYMENT_SIDES.PRIMARY) {
    return {
      sendDirections: [SYNC_DIRECTIONS.PRIMARY_TO_SECONDARY],
      receiveDirections: [SYNC_DIRECTIONS.SECONDARY_TO_PRIMARY]
    };
  }
  if (side === DEPLOYMENT_SIDES.SECONDARY) {
    return {
      sendDirections: [SYNC_DIRECTIONS.SECONDARY_TO_PRIMARY],
      receiveDirections: [SYNC_DIRECTIONS.PRIMARY_TO_SECONDARY]
    };
  }
  throw new Error('Unknown deployment side: ' + side);
}

function getSendDirectionForDeployment(side) {
  return getSingleDirection(getDirectionsForDeployment(side).sendDirections, 'send', side);
}

function getReceiveDirectionForDeployment(side) {
  return getSingleDirection(getDirectionsForDeployment(side).receiveDirections, 'receive', side);
}

function getSingleDirection(directions, type, side) {
  if (directions.length !== 1) {
    throw new Error('Expected exactly one ' + type + ' direction for deployment side ' + side);
  }
  return directions[0];
}

function getSecret(config) {
  const secret = getScriptProperties().getProperty(config.scriptPropertySecretName);
  if (!secret) {
    throw new Error('Missing script property: ' + config.scriptPropertySecretName);
  }
  return secret;
}
