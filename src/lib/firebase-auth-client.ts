import {
  getAuth,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";

import { getFirebaseClient } from "./firebase-client";

const auth = getAuth(getFirebaseClient());
const provider = new GoogleAuthProvider();
const SESSION_SYNC_KEY = "auth:session-cookie-exp";

let sessionSyncStarted = false;

function getStoredSessionExpiry(): number | null {
  try {
    const rawValue = window.sessionStorage.getItem(SESSION_SYNC_KEY);
    if (!rawValue) return null;

    const value = Number.parseInt(rawValue, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function setStoredSessionExpiry(expiresAt: number): void {
  try {
    window.sessionStorage.setItem(SESSION_SYNC_KEY, String(expiresAt));
  } catch {
    // Ignore storage failures and continue without caching.
  }
}

function clearStoredSessionExpiry(): void {
  try {
    window.sessionStorage.removeItem(SESSION_SYNC_KEY);
  } catch {
    // Ignore storage failures and continue.
  }
}

async function updateServerSession(token: string): Promise<void> {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = typeof data?.error === "string" ? data.error : "Session refresh failed";
    throw new Error(message);
  }
}

async function syncServerSession(user: User): Promise<boolean> {
  const tokenResult = await user.getIdTokenResult();
  const expiresAt = Date.parse(tokenResult.expirationTime);

  if (Number.isFinite(expiresAt) && getStoredSessionExpiry() === expiresAt) {
    return false;
  }

  await updateServerSession(tokenResult.token);

  if (Number.isFinite(expiresAt)) {
    setStoredSessionExpiry(expiresAt);
  }

  return true;
}

async function waitForCurrentUser(): Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve) => {
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function signInWithGooglePopup(): Promise<string> {
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}

export async function restoreServerSessionFromClientAuth(): Promise<boolean> {
  const user = await waitForCurrentUser();

  if (!user) {
    clearStoredSessionExpiry();
    return false;
  }

  await syncServerSession(user);
  return true;
}

export function startServerSessionSync(): void {
  if (sessionSyncStarted) {
    return;
  }

  sessionSyncStarted = true;

  onIdTokenChanged(auth, async (user) => {
    if (!user) {
      clearStoredSessionExpiry();
      return;
    }

    try {
      await syncServerSession(user);
    } catch (error) {
      console.error("[auth] Failed to sync session cookie:", error);
    }
  });
}

export async function signOutFirebaseAuth(): Promise<void> {
  clearStoredSessionExpiry();
  await signOut(auth);
}
