import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db, isFirebaseReady } from "./config";

/**
 * User profile structure in Firestore
 * MINIMAL - Only for user session cache
 */
export interface UserProfile {
  uid: string;
  email: string;
  companyId: string;
  role: "SUPERADMIN" | "ADMIN" | "MANAGER" | "CSR" | "TECHNICIAN" | "DISPATCHER" | "HR" | "IT" | "PARTS" | "FINANCE";
  displayName: string;
  supabaseUserId: string;
  isActive: boolean;
  createdAt: Timestamp | Date;
  lastLogin: Timestamp | Date;
}

/**
 * Get user profile from Firestore
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!isFirebaseReady() || !db) {
    console.warn("Firestore not configured");
    return null;
  }

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return null;
    }

    return userSnap.data() as UserProfile;
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return null;
  }
}

/**
 * Create user profile in Firestore
 * Called after Firebase Auth user creation
 */
export async function createUserProfile(data: {
  uid: string;
  email: string;
  companyId: string;
  role: string;
  displayName: string;
  isActive: boolean;
  supabaseUserId: string;
}): Promise<void> {
  if (!isFirebaseReady() || !db) {
    throw new Error("Firestore not configured");
  }

  try {
    const userRef = doc(db, "users", data.uid);
    
    await setDoc(userRef, {
      uid: data.uid,
      email: data.email,
      companyId: data.companyId,
      role: data.role,
      displayName: data.displayName,
      supabaseUserId: data.supabaseUserId,
      isActive: data.isActive,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error creating user profile:", error);
    throw error;
  }
}

/**
 * Update user profile in Firestore
 */
export async function updateUserProfile(
  uid: string,
  updates: Partial<Omit<UserProfile, "uid" | "createdAt">>
): Promise<void> {
  if (!isFirebaseReady() || !db) {
    console.warn("Firestore not configured");
    return;
  }

  try {
    const userRef = doc(db, "users", uid);
    
    // Convert Date to Timestamp for lastLogin
    const firestoreUpdates: any = { ...updates };
    if (updates.lastLogin) {
      firestoreUpdates.lastLogin = serverTimestamp();
    }
    
    await updateDoc(userRef, firestoreUpdates);
  } catch (error) {
    console.error("Error updating user profile:", error);
    throw error;
  }
}

/**
 * Check if user has access to a company
 */
export async function hasCompanyAccess(
  uid: string,
  companyId: string
): Promise<boolean> {
  const profile = await getUserProfile(uid);
  
  if (!profile) {
    return false;
  }

  // SuperAdmin has access to all companies
  if (profile.role === "SUPERADMIN") {
    return true;
  }

  // Regular users can only access their own company
  return profile.companyId === companyId;
}
