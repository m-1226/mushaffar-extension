import type { PasswordModel } from './password';
import type { FolderModel } from './folder';
import type { CardModel } from './card';
import type { AuthenticatorModel } from './authenticator';

export interface VaultData {
  passwords: PasswordModel[];
  folders: FolderModel[];
  cards: CardModel[];
  authenticators: AuthenticatorModel[];
}

export interface VaultState {
  isUnlocked: boolean;
  data: VaultData | null;
  lastSync: string | null; // ISO timestamp
  userEmail: string | null;
}

export const emptyVault: VaultData = {
  passwords: [],
  folders: [],
  cards: [],
  authenticators: [],
};
