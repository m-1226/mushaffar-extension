export interface AuthenticatorModel {
  id: string;
  issuer: string;
  accountName: string;
  secret: string; // Base32-encoded TOTP secret
  issuerUrl?: string;
  digits: number; // Default: 6
  period: number; // Default: 30
  algorithm: string; // Default: SHA1
  createdDate: string;
}
