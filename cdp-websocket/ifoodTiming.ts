import 'dotenv/config';

function seconds(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be an integer between ' + min + ' and ' + max + '.');
  }
  return value;
}

export const verificationWaitSeconds = seconds('IFOOD_VERIFICATION_WAIT_SECONDS', 180, 1, 1800);
export const sessionTtlSeconds = seconds('IFOOD_SESSION_TTL_SECONDS', 600, 15, 3600);

// Keep enough session time for navigation, the remaining actions, and artifact capture.
if (sessionTtlSeconds < verificationWaitSeconds + 120) {
  throw new Error('IFOOD_SESSION_TTL_SECONDS must exceed the verification wait by at least 120 seconds.');
}
