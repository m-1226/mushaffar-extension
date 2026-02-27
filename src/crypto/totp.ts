/**
 * TOTP code generation matching Mushaffar app's AuthenticatorModel.
 * Uses otpauth library for RFC 6238 compliance.
 */

import * as OTPAuth from 'otpauth';
import type { AuthenticatorModel } from '../models/authenticator';

export interface TOTPCode {
  code: string;
  remaining: number; // seconds until next code
  period: number;
}

export function generateTOTP(auth: AuthenticatorModel): TOTPCode {
  const totp = new OTPAuth.TOTP({
    issuer: auth.issuer,
    label: auth.accountName,
    algorithm: auth.algorithm || 'SHA1',
    digits: auth.digits || 6,
    period: auth.period || 30,
    secret: OTPAuth.Secret.fromBase32(auth.secret),
  });

  const code = totp.generate();
  const period = auth.period || 30;
  const remaining = period - (Math.floor(Date.now() / 1000) % period);

  return { code, remaining, period };
}
