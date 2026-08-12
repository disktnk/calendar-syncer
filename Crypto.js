function bytesToHex(bytes) {
  return bytes.map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function hmacSha256Hex(secret, message) {
  const bytes = Utilities.computeHmacSha256Signature(String(message), String(secret));
  return bytesToHex(bytes);
}

function sha256Hex(message) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(message));
  return bytesToHex(bytes);
}

function signPayload(payloadJson, secret) {
  return hmacSha256Hex(secret, payloadJson);
}

function verifyEnvelope(envelope, secret) {
  if (!envelope || typeof envelope.payloadJson !== 'string' || typeof envelope.signature !== 'string') {
    return false;
  }
  return signPayload(envelope.payloadJson, secret) === envelope.signature;
}
