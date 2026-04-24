import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

import { getFirebaseClient } from "./firebase-client";

const auth = getAuth(getFirebaseClient());
const provider = new GoogleAuthProvider();

export async function signInWithGooglePopup(): Promise<string> {
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}

export async function signOutFirebaseAuth(): Promise<void> {
  await signOut(auth);
}
