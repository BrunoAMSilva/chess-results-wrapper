import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App;
let auth: Auth;

function getAdminApp(): App {
  if (!app) {
    const existing = getApps();
    if (existing.length > 0) {
      app = existing[0];
    } else {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || import.meta.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (serviceAccount) {
        let parsed: object;
        try {
          parsed = JSON.parse(serviceAccount);
        } catch (e) {
          console.error("[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", e instanceof Error ? e.message : e);
          throw new Error("Firebase initialization failed: invalid service account JSON");
        }
        try {
          app = initializeApp({ credential: cert(parsed) });
        } catch (e) {
          console.error("[firebase-admin] initializeApp with service account failed:", e instanceof Error ? e.message : e);
          throw new Error("Firebase initialization failed: could not initialize with service account");
        }
      } else {
        // Fallback: use project ID only (works with GOOGLE_APPLICATION_CREDENTIALS env)
        try {
          app = initializeApp({
            projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || process.env.PUBLIC_FIREBASE_PROJECT_ID || undefined,
          });
        } catch (e) {
          console.error("[firebase-admin] initializeApp with project ID failed:", e instanceof Error ? e.message : e);
          throw new Error("Firebase initialization failed: missing credentials (set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS)");
        }
      }
    }
  }
  return app;
}

export function getAdminAuth(): Auth {
  if (!auth) {
    auth = getAuth(getAdminApp());
  }
  return auth;
}

export interface AuthUser {
  uid: string;
  email: string | undefined;
  name: string | undefined;
  picture: string | undefined;
}

export async function verifySessionToken(token: string): Promise<AuthUser | null> {
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    };
  } catch (e) {
    console.error("[firebase-admin] verifyIdToken failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
