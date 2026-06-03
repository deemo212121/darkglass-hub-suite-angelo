import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCkfbHrlTppWGm5Cgag2aJVv2RvEexxaTw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "adminhubsolutions.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "adminhubsolutions",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "adminhubsolutions.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "551227170830",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:551227170830:web:76177508a429ff35f8dc5f",
  measurementId: "G-M03FS74TNJ",
};

export const firebaseApp: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let analyticsPromise: Promise<Analytics | null> | null = null;

export function getFirebaseAnalytics() {
  if (typeof window === "undefined") return Promise.resolve(null);

  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
      .catch(() => null);
  }

  return analyticsPromise;
}
