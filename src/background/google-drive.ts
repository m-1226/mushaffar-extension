/**
 * Google Drive API integration matching Mushaffar app.
 * Folder: "Mushaffar Backups"
 * File: "auto_backup_mushaffar.mushaffar"
 */

const FOLDER_NAME = 'Mushaffar Backups';
const BACKUP_FILE_NAME = 'auto_backup_mushaffar.mushaffar';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (result) => {
      const token = typeof result === 'string' ? result : result?.token;
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Auth failed'));
      } else {
        resolve(token);
      }
    });
  });
}

async function driveRequest(path: string, options: RequestInit = {}, token?: string): Promise<Response> {
  const authToken = token || await getAuthToken();
  const url = path.startsWith('http') ? path : `${DRIVE_API}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...options.headers,
    },
  });
}

async function findFolder(token: string): Promise<string | null> {
  const query = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id,name)`, {}, token);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createFolder(token: string): Promise<string> {
  const res = await driveRequest('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  }, token);
  const data = await res.json();
  return data.id;
}

async function findBackupFile(folderId: string, token: string): Promise<string | null> {
  const query = `name='${BACKUP_FILE_NAME}' and '${folderId}' in parents and trashed=false`;
  const res = await driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id,name)`, {}, token);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

/**
 * Download the encrypted backup from Google Drive.
 * Returns the raw base64-encoded backup string, or null if not found.
 */
export async function downloadBackup(): Promise<string | null> {
  const token = await getAuthToken();

  let folderId = await findFolder(token);
  if (!folderId) return null;

  const fileId = await findBackupFile(folderId, token);
  if (!fileId) return null;

  const res = await driveRequest(`/files/${fileId}?alt=media`, {}, token);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  // The backup is raw bytes; convert to base64 string for decryption
  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Check if it's already base64 text or raw bytes
  try {
    const text = new TextDecoder().decode(bytes);
    // If it decodes as valid base64-looking text, return as-is
    if (/^[A-Za-z0-9+/=\s]+$/.test(text.trim())) {
      return text.trim();
    }
  } catch { /* not text */ }

  // Raw bytes — base64 encode them (chunked to avoid call stack overflow)
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Upload encrypted backup to Google Drive.
 * Creates folder if needed, replaces existing file.
 */
export async function uploadBackup(base64Data: string): Promise<void> {
  const token = await getAuthToken();

  let folderId = await findFolder(token);
  if (!folderId) {
    folderId = await createFolder(token);
  }

  // Convert base64 to raw bytes
  const binary = atob(base64Data);
  const rawBytes = Uint8Array.from(binary, c => c.charCodeAt(0));

  // Check for existing file to update
  const existingFileId = await findBackupFile(folderId, token);

  if (existingFileId) {
    // Update existing file
    await fetch(`${UPLOAD_API}/files/${existingFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: rawBytes,
    });
  } else {
    // Create new file with multipart upload
    const metadata = JSON.stringify({
      name: BACKUP_FILE_NAME,
      parents: [folderId],
    });

    const boundary = '---mushaffar-boundary---';
    const body = [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      metadata,
      `\r\n--${boundary}\r\n`,
      'Content-Type: application/octet-stream\r\n\r\n',
    ].join('');

    const bodyEnd = `\r\n--${boundary}--`;

    const encoder = new TextEncoder();
    const bodyStart = encoder.encode(body);
    const bodyEndBytes = encoder.encode(bodyEnd);

    const combined = new Uint8Array(bodyStart.length + rawBytes.length + bodyEndBytes.length);
    combined.set(bodyStart, 0);
    combined.set(rawBytes, bodyStart.length);
    combined.set(bodyEndBytes, bodyStart.length + rawBytes.length);

    await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combined,
    });
  }
}

/**
 * Get the current user's email via Google userinfo API.
 */
export async function getUserEmail(): Promise<string> {
  const token = await getAuthToken();
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.email;
}

/**
 * Sign out by revoking the cached auth token.
 */
export async function signOut(): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (result) => {
      const token = typeof result === 'string' ? result : result?.token;
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          // Also revoke on Google's side
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}
