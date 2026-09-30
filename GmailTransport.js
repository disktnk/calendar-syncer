function buildSubject(config, generatedAt) {
  return config.subjectPrefix + ' ' + config.direction + ' ' + generatedAt;
}

function sendSnapshotEmail(config, payloadJson, signature, generatedAt) {
  const envelope = {
    payloadJson: payloadJson,
    signature: signature
  };
  const subject = buildSubject(config, generatedAt);
  const body = JSON.stringify(envelope);
  const rawMessage = [
    'To: ' + config.recipientEmail,
    'Subject: ' + encodeMimeHeader(subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body
  ].join('\r\n');
  const response = Gmail.Users.Messages.send({
    raw: Utilities.base64EncodeWebSafe(Utilities.newBlob(rawMessage).getBytes())
  }, 'me');

  if (!response || !response.id) {
    throw new Error('Gmail API did not return a sent message ID');
  }

  // Trash only the exact sent message returned by the send operation.
  Gmail.Users.Messages.trash('me', response.id);
  return response.id;
}

function encodeMimeHeader(value) {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  return '=?UTF-8?B?' + Utilities.base64Encode(Utilities.newBlob(value).getBytes()) + '?=';
}

function getOrCreateGmailLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function getSyncLabels() {
  return {
    processed: getOrCreateGmailLabel('calendar-busy-sync/processed'),
    error: getOrCreateGmailLabel('calendar-busy-sync/error'),
    ignored: getOrCreateGmailLabel('calendar-busy-sync/ignored')
  };
}

function buildIncomingSearchQuery(config) {
  const windowDays = getConfiguredWindowDays(config);
  return [
    'subject:"' + config.subjectPrefix + ' ' + config.direction + '"',
    '-label:"calendar-busy-sync/processed"',
    '-label:"calendar-busy-sync/error"',
    '-label:"calendar-busy-sync/ignored"',
    'newer_than:' + String(Math.max(2, windowDays + 7)) + 'd'
  ].join(' ');
}

function extractEmailAddress(fromHeader) {
  const match = String(fromHeader || '').match(/<([^>]+)>/);
  return normalizeEmail(match ? match[1] : fromHeader);
}

function findIncomingSnapshotMessages(config) {
  const threads = GmailApp.search(buildIncomingSearchQuery(config), 0, 50);
  const messages = [];
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      if (message.getSubject().indexOf(config.subjectPrefix + ' ' + config.direction) !== -1) {
        messages.push(message);
      }
    });
  });
  return messages;
}

function addLabelToMessage(message, label) {
  const thread = message.getThread();
  thread.addLabel(label);
}
