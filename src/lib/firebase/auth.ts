import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  User,
  UserCredential,
} from "firebase/auth";
import { auth, isFirebaseReady } from "./config";
import { getUserProfile, createUserProfile, updateUserProfile } from "./firestore";

export interface AuthUser {
  uid: string;
  email: string;
  companyId: string;
  role: string;
  displayName: string;
  isActive: boolean;
}

/**
 * Sign in with email and password
 * Returns Firebase UID and user profile from Firestore
 */
export async function signIn(
  email: string,
  password: string
): Promise<AuthUser> {
  if (!isFirebaseReady() || !auth) {
    throw new Error("Firebase not configured. Using mock authentication.");
  }

  try {
    // 1. Authenticate with Firebase only. Profile loading (from Supabase, with
    //    Firestore fallback) is handled by the auth state listener in auth.tsx.
    //    We intentionally do NOT require a Firestore profile here, since new
    //    users live in Supabase only.
    const userCredential: UserCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user: User = userCredential.user;

    // Best-effort: if a legacy Firestore profile exists, return its details.
    // Otherwise return minimal info — the listener fills the real profile.
    let profile = null;
    try {
      profile = await getUserProfile(user.uid);
    } catch {
      profile = null;
    }

    if (profile && profile.isActive === false) {
      throw new Error("Account is inactive. Contact administrator.");
    }
    if (profile) {
      await updateUserProfile(user.uid, { lastLogin: new Date() }).catch(() => {});
    }

    return {
      uid: user.uid,
      email: user.email || email,
      companyId: profile?.companyId ?? "",
      role: profile?.role ?? "",
      displayName: profile?.displayName || email,
      isActive: profile?.isActive ?? true,
    };
  } catch (error: any) {
    console.error("Firebase sign-in error:", error);
    
    // Provide user-friendly error messages
    if (error.code === "auth/invalid-credential") {
      throw new Error("Invalid email or password. Please check your credentials and try again.");
    } else if (error.code === "auth/user-not-found") {
      throw new Error("No account found with this email");
    } else if (error.code === "auth/wrong-password") {
      throw new Error("Incorrect password");
    } else if (error.code === "auth/invalid-email") {
      throw new Error("Invalid email address");
    } else if (error.code === "auth/user-disabled") {
      throw new Error("Account has been disabled");
    } else if (error.code === "auth/too-many-requests") {
      throw new Error("Too many failed login attempts. Please try again later.");
    } else {
      throw new Error(error.message || "Sign-in failed");
    }
  }
}

/**
 * Sign out current user
 */
export async function signOut(): Promise<void> {
  if (!isFirebaseReady() || !auth) {
    console.warn("Firebase not configured");
    return;
  }

  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error("Firebase sign-out error:", error);
    throw error;
  }
}

/**
 * Create new user account (Admin only)
 * This would typically be done via Firebase Admin SDK on the backend
 */
export async function createUser(
  email: string,
  password: string,
  companyId: string,
  role: string,
  displayName: string
): Promise<string> {
  if (!isFirebaseReady() || !auth) {
    throw new Error("Firebase not configured");
  }

  try {
    // 1. Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const uid = userCredential.user.uid;

    // 2. Create Firestore profile
    await createUserProfile({
      uid,
      email,
      companyId,
      role,
      displayName,
      isActive: true,
      supabaseUserId: "", // Will be filled when Supabase is integrated
    });

    return uid;
  } catch (error: any) {
    console.error("Firebase create user error:", error);
    
    if (error.code === "auth/email-already-in-use") {
      throw new Error("Email already in use");
    } else if (error.code === "auth/weak-password") {
      throw new Error("Password too weak (min 6 characters)");
    } else {
      throw new Error(error.message || "Failed to create user");
    }
  }
}

/**
 * Get current authenticated user
 */
export function getCurrentUser(): User | null {
  if (!isFirebaseReady() || !auth) {
    return null;
  }
  return auth.currentUser;
}

/**
 * Listen to auth state changes
 */
export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  if (!isFirebaseReady() || !auth) {
    return () => {};
  }
  
  return auth.onAuthStateChanged(callback);
}
