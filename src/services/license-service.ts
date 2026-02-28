/**
 * Premium license verification via Firestore REST API.
 * Mirrors the Flutter app's PremiumDesktopService.
 */

const FIREBASE_API_KEY = 'AIzaSyAR19UKdTOJcQwAqVw5dsRuSWVuWf3iJak';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/kryptor-app/databases/(default)/documents';

/**
 * Exchange a Google OAuth access token for a Firebase ID token.
 */
async function getFirebaseToken(googleAccessToken: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `access_token=${googleAccessToken}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Firebase auth failed: ${res.status}`);
  }

  const data = await res.json();
  return data.idToken;
}

/**
 * Check if the user has a premium license in Firestore.
 */
export async function checkPremiumStatus(email: string, googleAccessToken: string): Promise<boolean> {
  try {
    const firebaseToken = await getFirebaseToken(googleAccessToken);

    const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firebaseToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'licenses' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'email' },
              op: 'EQUAL',
              value: { stringValue: email },
            },
          },
          limit: { value: 1 },
        },
      }),
    });

    if (!res.ok) return false;

    const results = await res.json();
    return Array.isArray(results) && results.length > 0 && results[0].document !== undefined;
  } catch {
    return false;
  }
}
