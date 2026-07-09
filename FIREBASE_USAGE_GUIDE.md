# Firebase Usage Guide

Quick reference for using Firebase services in the AH Solutions application.

## Table of Contents

1. [Authentication](#authentication)
2. [File Storage](#file-storage)
3. [User Profiles](#user-profiles)
4. [Error Handling](#error-handling)

---

## Authentication

### Sign In

```typescript
import { signIn } from "@/lib/firebase/auth";

async function handleLogin(email: string, password: string) {
  try {
    const user = await signIn(email, password);
    
    // user contains:
    // - uid: Firebase UID
    // - email: user email
    // - companyId: company identifier
    // - role: user role (ADMIN, MANAGER, etc.)
    // - displayName: user's name
    // - isActive: account status
    
    console.log("Logged in:", user);
    
    // Store in your state management or context
    // Navigate to dashboard
  } catch (error) {
    console.error("Login failed:", error.message);
    // Show error to user
  }
}
```

### Sign Out

```typescript
import { signOut } from "@/lib/firebase/auth";

async function handleLogout() {
  try {
    await signOut();
    console.log("Signed out successfully");
    // Clear local state
    // Navigate to login page
  } catch (error) {
    console.error("Logout failed:", error);
  }
}
```

### Create New User (Admin Only)

```typescript
import { createUser } from "@/lib/firebase/auth";

async function handleCreateUser(
  email: string,
  password: string,
  companyId: string,
  role: string,
  displayName: string
) {
  try {
    const uid = await createUser(email, password, companyId, role, displayName);
    console.log("User created with UID:", uid);
    // Notify user of success
  } catch (error) {
    console.error("User creation failed:", error.message);
    // Show error message
  }
}
```

### Get Current User

```typescript
import { getCurrentUser, onAuthStateChanged } from "@/lib/firebase/auth";

// Get current user (one-time check)
const user = getCurrentUser();
if (user) {
  console.log("Current user:", user.email);
}

// Listen to auth state changes
const unsubscribe = onAuthStateChanged((user) => {
  if (user) {
    console.log("User signed in:", user.email);
  } else {
    console.log("User signed out");
  }
});

// Cleanup listener when component unmounts
unsubscribe();
```

---

## File Storage

### Upload Profile Picture

```typescript
import { uploadProfilePicture } from "@/lib/firebase/storage";

async function handleProfileUpload(file: File, companyId: string, uid: string) {
  try {
    const result = await uploadProfilePicture(companyId, uid, file);
    
    console.log("Upload successful!");
    console.log("File path:", result.path);
    console.log("Download URL:", result.url);
    
    // Save URL to user profile or display image
  } catch (error) {
    console.error("Upload failed:", error);
  }
}
```

### Upload Ticket Images (Before/After)

```typescript
import { uploadTicketImage, uploadTicketImages } from "@/lib/firebase/storage";

// Upload single image
async function uploadSingleImage(
  file: File,
  companyId: string,
  ticketId: string,
  type: "before" | "after"
) {
  try {
    const result = await uploadTicketImage(companyId, ticketId, file, type);
    console.log("Image uploaded:", result.url);
    return result.url;
  } catch (error) {
    console.error("Upload failed:", error);
  }
}

// Upload multiple images
async function uploadMultipleImages(
  files: File[],
  companyId: string,
  ticketId: string,
  type: "before" | "after"
) {
  try {
    const results = await uploadTicketImages(companyId, ticketId, files, type);
    console.log(`Uploaded ${results.length} images`);
    
    results.forEach((result) => {
      console.log("URL:", result.url);
    });
    
    return results.map(r => r.url);
  } catch (error) {
    console.error("Bulk upload failed:", error);
  }
}
```

### Upload Part Image

```typescript
import { uploadPartImage } from "@/lib/firebase/storage";

async function handlePartImageUpload(
  file: File,
  companyId: string,
  partId: string
) {
  try {
    const result = await uploadPartImage(companyId, partId, file);
    console.log("Part image uploaded:", result.url);
    return result.url;
  } catch (error) {
    console.error("Upload failed:", error);
  }
}
```

### Upload Documents (Invoice/Receipt)

```typescript
import { uploadInvoice, uploadReceipt } from "@/lib/firebase/storage";

// Upload invoice
async function handleInvoiceUpload(
  file: File,
  companyId: string,
  ticketId: string
) {
  try {
    const result = await uploadInvoice(companyId, ticketId, file);
    console.log("Invoice uploaded:", result.url);
    return result.url;
  } catch (error) {
    console.error("Upload failed:", error);
  }
}

// Upload receipt
async function handleReceiptUpload(
  file: File,
  companyId: string,
  ticketId: string
) {
  try {
    const result = await uploadReceipt(companyId, ticketId, file);
    console.log("Receipt uploaded:", result.url);
    return result.url;
  } catch (error) {
    console.error("Upload failed:", error);
  }
}
```

### Get Ticket Images

```typescript
import { getTicketImages } from "@/lib/firebase/storage";

async function loadTicketImages(
  companyId: string,
  ticketId: string,
  type: "before" | "after"
) {
  try {
    const urls = await getTicketImages(companyId, ticketId, type);
    console.log(`Found ${urls.length} ${type} images`);
    return urls;
  } catch (error) {
    console.error("Failed to load images:", error);
    return [];
  }
}
```

### Validate File Before Upload

```typescript
import { validateFileType, validateFileSize } from "@/lib/firebase/storage";

function handleFileSelect(file: File, type: "profile" | "ticket-before" | "part" | "invoice") {
  // Check file type
  if (!validateFileType(file, type)) {
    alert("Invalid file type. Please select a valid image or document.");
    return false;
  }
  
  // Check file size
  if (!validateFileSize(file, type)) {
    const maxSize = type === "invoice" || type === "receipt" ? "10MB" : "5MB";
    alert(`File too large. Maximum size is ${maxSize}.`);
    return false;
  }
  
  return true;
}
```

### Delete File

```typescript
import { deleteFile } from "@/lib/firebase/storage";

async function handleFileDelete(filePath: string) {
  try {
    await deleteFile(filePath);
    console.log("File deleted successfully");
  } catch (error) {
    console.error("Delete failed:", error);
  }
}
```

---

## User Profiles

### Get User Profile

```typescript
import { getUserProfile } from "@/lib/firebase/firestore";

async function loadUserProfile(uid: string) {
  try {
    const profile = await getUserProfile(uid);
    
    if (profile) {
      console.log("User profile:", profile);
      // profile contains:
      // - uid, email, companyId, role, displayName
      // - supabaseUserId, isActive
      // - createdAt, lastLogin
      return profile;
    } else {
      console.log("Profile not found");
      return null;
    }
  } catch (error) {
    console.error("Failed to load profile:", error);
  }
}
```

### Update User Profile

```typescript
import { updateUserProfile } from "@/lib/firebase/firestore";

async function updateProfile(uid: string, updates: any) {
  try {
    await updateUserProfile(uid, {
      displayName: "New Name",
      lastLogin: new Date(),
      // Any other fields except uid and createdAt
    });
    
    console.log("Profile updated");
  } catch (error) {
    console.error("Update failed:", error);
  }
}
```

### Check Company Access

```typescript
import { hasCompanyAccess } from "@/lib/firebase/firestore";

async function checkAccess(uid: string, companyId: string) {
  try {
    const hasAccess = await hasCompanyAccess(uid, companyId);
    
    if (hasAccess) {
      console.log("User has access to company");
    } else {
      console.log("Access denied");
      // Redirect or show error
    }
    
    return hasAccess;
  } catch (error) {
    console.error("Access check failed:", error);
    return false;
  }
}
```

---

## Error Handling

### Common Error Codes

Firebase Auth errors you might encounter:

```typescript
try {
  await signIn(email, password);
} catch (error: any) {
  switch (error.code) {
    case "auth/user-not-found":
      showError("No account found with this email");
      break;
    case "auth/wrong-password":
      showError("Incorrect password");
      break;
    case "auth/invalid-email":
      showError("Invalid email address");
      break;
    case "auth/user-disabled":
      showError("Account has been disabled");
      break;
    case "auth/too-many-requests":
      showError("Too many failed attempts. Try again later.");
      break;
    default:
      showError("Login failed. Please try again.");
  }
}
```

### Storage Error Handling

```typescript
try {
  await uploadTicketImage(companyId, ticketId, file, "before");
} catch (error: any) {
  if (error.code === "storage/unauthorized") {
    showError("You don't have permission to upload files");
  } else if (error.code === "storage/canceled") {
    showError("Upload was canceled");
  } else if (error.code === "storage/quota-exceeded") {
    showError("Storage quota exceeded");
  } else {
    showError("Upload failed. Please try again.");
  }
}
```

---

## React Component Example

Here's a complete example of a login component:

```typescript
import { useState } from "react";
import { signIn } from "@/lib/firebase/auth";
import { useNavigate } from "@tanstack/react-router";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const user = await signIn(email, password);
      
      // Store user in context or state
      localStorage.setItem("userEmail", user.email);
      localStorage.setItem("userCompanyId", user.companyId);
      localStorage.setItem("userRole", user.role);
      
      // Navigate based on role
      if (user.role === "SUPERADMIN") {
        navigate({ to: "/superadmin" });
      } else {
        navigate({ to: "/home" });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      {error && <div className="error">{error}</div>}
      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
```

---

## File Upload Component Example

```typescript
import { useState } from "react";
import { uploadTicketImage, validateFileType, validateFileSize } from "@/lib/firebase/storage";

interface Props {
  companyId: string;
  ticketId: string;
  type: "before" | "after";
}

export function ImageUploader({ companyId, ticketId, type }: Props) {
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    if (!validateFileType(file, "ticket-before")) {
      alert("Please select a valid image file (JPEG, PNG, WebP)");
      return;
    }

    if (!validateFileSize(file, "ticket-before")) {
      alert("Image too large. Maximum size is 5MB.");
      return;
    }

    // Upload
    setUploading(true);
    try {
      const result = await uploadTicketImage(companyId, ticketId, file, type);
      setImageUrl(result.url);
      alert("Image uploaded successfully!");
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
      {imageUrl && <img src={imageUrl} alt="Uploaded" />}
    </div>
  );
}
```

---

## Best Practices

1. **Always validate files before upload**
   - Check file type and size client-side
   - Rely on Storage rules for server-side enforcement

2. **Handle errors gracefully**
   - Show user-friendly error messages
   - Log detailed errors for debugging

3. **Check Firebase readiness**
   ```typescript
   import { isFirebaseReady } from "@/lib/firebase/config";
   
   if (!isFirebaseReady()) {
     console.warn("Firebase not configured");
     // Fall back to mock or show error
   }
   ```

4. **Use loading states**
   - Show spinners during uploads/authentication
   - Disable buttons to prevent duplicate requests

5. **Clean up listeners**
   - Always unsubscribe from `onAuthStateChanged`
   - Remove event listeners when components unmount

6. **Secure file paths**
   - Always include companyId in file paths
   - Never allow users to specify their own paths
   - Use server-side validation (Storage rules)

---

## Next Steps

1. Test authentication flow with test users
2. Add file upload UI to ticket details page
3. Display uploaded images in ticket view
4. Add profile picture upload to user settings
5. Implement invoice/receipt upload in parts section
