import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAnalytics, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID || "",
};

let app: FirebaseApp;
let analytics: Analytics;

export function getFirebaseClient(): FirebaseApp {
  if (!app) {
    const existing = getApps();
    app = existing.length > 0 ? existing[0] : initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAnalytics(): Analytics {
  if (!analytics) {
    analytics = getAnalytics(getFirebaseClient());
  }
  return analytics;
}
