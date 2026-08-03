# ServicePower - How It Actually Works

## 🔍 Important Discovery

ServicePower API **does not support date-range queries**. You **cannot** pull "all claims from the last 7 days" without knowing specific claim numbers.

### What ServicePower Requires

To retrieve a claim, you MUST provide at least ONE of these:
- ✅ **Claim Number** (most common)
- ✅ **Call Number**
- ✅ **Claim Identifier**
- ✅ **Claim Batch Number + Sequence Number**

❌ You **cannot** query by date range alone
❌ You **cannot** get "all claims"

---

## 🎯 Updated Sync Process

### Step 1: Get Your Claim Numbers

You need to know which claims you want to sync. Get claim numbers from:
- Your ServicePower dashboard/portal
- Email notifications from ServicePower
- Your existing ticket system
- ServicePower reports

### Step 2: Enter Claim Numbers

In the ticket list, click **"Sync ServicePower"** and enter your claim numbers:

```
ABC12345
DEF67890
GHI11223
```

Or comma-separated:
```
ABC12345, DEF67890, GHI11223
```

### Step 3: Sync

Click **"Fetch Claims"** - the system will:
1. Query each claim number individually
2. Convert successful responses to tickets
3. Merge them with your existing ticket list
4. Show you how many were added/updated

---

## 📊 What Happens

### Success Example

```
✅ Sync Complete!
Added: 3 | Updated: 0

• Claim ABC12345: Success
• Claim DEF67890: Success
• Claim GHI11223: Success
```

### Partial Success

```
✅ Sync Complete!
Added: 2 | Updated: 0

Partial errors:
• Claim XYZ99999: No data found
```

This means 2 claims synced successfully, 1 wasn't found.

### Complete Failure

```
❌ Sync Failed
• Please enter at least one claim number
```

---

## 💡 Typical Workflow

### Option 1: Manual Entry

1. Check ServicePower portal for new claims
2. Copy claim numbers
3. Paste into sync dialog
4. Fetch

### Option 2: From Reports

1. Export claim list from ServicePower
2. Copy claim numbers column
3. Paste into sync dialog
4. Fetch

### Option 3: One-by-One

Need to look up a specific claim a customer is asking about?
1. Enter that single claim number
2. Fetch
3. View in ticket list

---

## ⚙️ Technical Explanation

ServicePower's Claims Retrieval API is designed for **targeted queries**, not bulk operations. This is common for B2B APIs:

**Why?**
- Performance: Prevents massive data dumps
- Security: Requires specific authorization per claim
- Data integrity: Ensures you're querying claims you have access to

**Result:**
You need to manage claim numbers externally (portal, emails, reports) and sync specific ones you need.

---

## 🔄 Alternative Approaches

### 1. Batch Processing

If you have a list of claim numbers in a spreadsheet:
1. Copy all claim numbers
2. Paste into sync dialog
3. Let it process each one

### 2. Selective Sync

Only sync claims you actually need:
- New claims received today
- Claims pending action
- Claims your team is working on

### 3. Integration with ServicePower Portal

If ServicePower has a portal/dashboard:
- Use portal to search/filter claims
- Export claim numbers
- Bulk sync to your system

---

## 📝 Updated Usage

**OLD (doesn't work):**
```
Sync last 7 days → ❌ API error
```

**NEW (works):**
```
Enter claim numbers:
ABC123
DEF456
GHI789

→ ✅ Fetches these 3 specific claims
```

---

## ✅ Restart and Test

1. **Restart server** (Ctrl+C, then `npm run dev`)
2. **Go to ticket list**
3. **Click "Sync ServicePower"**
4. **Enter a few real claim numbers** (from your ServicePower account)
5. **Click "Fetch Claims"**
6. **See them appear in your list!**

---

## 🎯 Summary

| What You Need | What You Get |
|--------------|--------------|
| Specific claim numbers | ✅ Those exact claims |
| Date range only | ❌ API error |
| "All claims" | ❌ Not possible |

**Bottom line:** ServicePower sync works great - you just need to provide specific claim numbers! 🚀
