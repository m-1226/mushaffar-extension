/**
 * Conflict resolution for merging local and remote vaults.
 * Port of Flutter's ConflictResolver — last-write-wins with deletion detection.
 */

import type { VaultData } from '../models/vault';
import type { PasswordModel } from '../models/password';
import type { CardModel } from '../models/card';
import type { AuthenticatorModel } from '../models/authenticator';
import type { FolderModel } from '../models/folder';

interface HasIdAndDate {
  id: string;
  lastEditDate?: string;
  createdDate?: string;
  createdAt?: string;
}

function getTimestamp(item: HasIdAndDate): number {
  const dateStr = item.lastEditDate || item.createdDate || item.createdAt || '';
  return dateStr ? new Date(dateStr).getTime() : 0;
}

function getCreatedTimestamp(item: HasIdAndDate): number {
  const dateStr = item.createdDate || item.createdAt || item.lastEditDate || '';
  return dateStr ? new Date(dateStr).getTime() : 0;
}

function mergeItems<T extends HasIdAndDate>(
  localItems: T[],
  remoteItems: T[],
  lastSyncTimestamp: number
): T[] {
  // Remote as baseline
  const merged = new Map<string, T>();
  for (const item of remoteItems) {
    merged.set(item.id, item);
  }

  // Check local items
  for (const localItem of localItems) {
    const remoteItem = merged.get(localItem.id);

    if (remoteItem) {
      // Exists in both — keep the newer one
      if (getTimestamp(localItem) > getTimestamp(remoteItem)) {
        merged.set(localItem.id, localItem);
      }
    } else {
      // Only in local — check if it was created after last sync (new) or deleted remotely
      const created = getCreatedTimestamp(localItem);
      if (lastSyncTimestamp === 0 || created > lastSyncTimestamp) {
        // Created after last sync → NEW item, keep it
        merged.set(localItem.id, localItem);
      }
      // Otherwise: existed before last sync but not in remote → deleted remotely, drop it
    }
  }

  return Array.from(merged.values());
}

/**
 * Merge local and remote vaults using last-write-wins strategy.
 */
export function mergeVaults(
  local: VaultData,
  remote: VaultData,
  lastSyncTimestamp: Date | null
): VaultData {
  const syncTs = lastSyncTimestamp ? lastSyncTimestamp.getTime() : 0;

  return {
    passwords: mergeItems<PasswordModel & HasIdAndDate>(
      local.passwords as (PasswordModel & HasIdAndDate)[],
      remote.passwords as (PasswordModel & HasIdAndDate)[],
      syncTs
    ) as PasswordModel[],
    cards: mergeItems<CardModel & HasIdAndDate>(
      local.cards as (CardModel & HasIdAndDate)[],
      remote.cards as (CardModel & HasIdAndDate)[],
      syncTs
    ) as CardModel[],
    authenticators: mergeItems<AuthenticatorModel & HasIdAndDate>(
      local.authenticators as (AuthenticatorModel & HasIdAndDate)[],
      remote.authenticators as (AuthenticatorModel & HasIdAndDate)[],
      syncTs
    ) as AuthenticatorModel[],
    folders: mergeItems<FolderModel & HasIdAndDate>(
      local.folders as (FolderModel & HasIdAndDate)[],
      remote.folders as (FolderModel & HasIdAndDate)[],
      syncTs
    ) as FolderModel[],
  };
}
