import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"] as string,
  authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"] as string,
  projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"] as string,
  storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"] as string,
  messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] as string,
  appId: import.meta.env["VITE_FIREBASE_APP_ID"] as string,
  measurementId: import.meta.env["VITE_FIREBASE_MEASUREMENT_ID"] as string,
};

// Reuse the existing app during HMR / repeated imports instead of re-initializing.
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

// Google Analytics (GA4). Initialized lazily and only in a supported browser
// with a measurementId configured, so it is a safe no-op during SSR, in tests,
// or before Analytics is enabled in the Firebase console.
let analyticsPromise: Promise<Analytics | null> | null = null;
export function getAnalyticsSafe(): Promise<Analytics | null> {
  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      if (typeof window === "undefined" || !firebaseConfig.measurementId) return null;
      try {
        return (await isSupported()) ? getAnalytics(app) : null;
      } catch {
        return null;
      }
    })();
  }
  return analyticsPromise;
}
