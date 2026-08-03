# ServicePower Ticket Sync - Pull Real Claims

## ✅ Feature Complete!

You can now pull **real claims from ServicePower** directly into your ticket list!

---

## 🚀 How to Use

### 1. Go to Ticket List

Navigate to your ticket list page (usually at `/m/tickets/ticket-list`)

### 2. Find the "ServicePower Integration" Section

At the top of the page, you'll see a blue highlighted section with:
- **"Sync ServicePower"** button
- **Options** link to configure sync settings

### 3. Click "Sync ServicePower"

This will:
1. Connect to ServicePower API
2. Fetch claims from the last 7 days (default)
3. Convert them to your ticket format
4. Merge them with existing tickets
5. Automatically refresh the list

### 4. See Your Real Tickets!

The synced tickets will appear in your list with:
- ✅ Ticket Source: "ServicePower"
- ✅ All claim data mapped to ticket fields
- ✅ Payment info in the parts section

---

## ⚙️ Options

Click "Options" to customize the sync:

**Date Ranges Available:**
- 7 days (default)
- 14 days
- 30 days
- 60 days
- 90 days

The sync will fetch all claims from ServicePower within that timeframe.

---

## 📊 What Gets Synced?

### Claim → Ticket Mapping

| ServicePower Field | Maps To Ticket Field |
|-------------------|---------------------|
| Call Number | Ticket No |
| Claim Number | Account |
| Brand Name | Manufacturer |
| Model Number | Model |
| Serial Number | Serial |
| Product Name | Product Type |
| Servicer Name | Customer |
| Servicer Number | Technician |
| Claim Status | Status |
| Received Date | Schedule & Created |
| Payment Amount | Parts (as payment record) |
| Labor/Parts/Travel | Part note details |

### Additional Data

- **Ticket Source**: Automatically set to "ServicePower"
- **Parts Section**: Payment details (labor, parts, travel costs)
- **Status**: Claim status description
- **Account**: Claim number/identifier

---

## 🔄 Sync Behavior

### Merge Strategy (Default)

- **New tickets**: Added to your list
- **Existing tickets**: Updated with latest ServicePower data
- **Local data preserved**: Your visits and status changes are kept
- **Dummy tickets**: Remain unchanged

This means you won't lose any local modifications!

---

## 💡 Use Cases

### 1. Daily Sync

Start your day by syncing last 7 days to get:
- New claims received
- Updated claim statuses
- Payment confirmations

### 2. Catch Up After Vacation

Use 30 or 60 day sync to catch up on all claims while you were away

### 3. Monthly Review

Sync 30 days at month-end to review all claims for the period

---

## ✅ Success Messages

### Sync Complete

```
✅ Sync Complete!
Added: 5 | Updated: 12
Tickets refreshed automatically
```

- **Added**: New tickets from ServicePower
- **Updated**: Existing tickets refreshed with latest data

### Sync Failed

```
❌ Sync Failed
• Error message details here
```

Common errors:
- Network connection issues
- ServicePower API temporary unavailable
- Invalid credentials (check `.env` file)

---

## 🛠️ Technical Details

### API Call

The sync makes a POST request to `/api/servicepower` with:
```json
{
  "action": "retrieveClaim",
  "params": {
    "fromDate": "20260608",
    "toDate": "20260615"
  }
}
```

### Data Storage

- Synced tickets saved to `localStorage` under key `ahs:tickets:data`
- Triggers storage event to refresh all open tabs
- Merges with existing tickets automatically

### Files

**Sync Logic:**
- `src/lib/servicePowerSync.ts` - Core sync functions
- `src/components/ServicePowerSyncButton.tsx` - UI component
- `src/components/TicketList.tsx` - Updated with sync button

**API Route:**
- `src/routes/api/servicepower.ts` - Server-side endpoint

---

## 🎯 Quick Start

1. ✅ Make sure dev server is running
2. ✅ Go to ticket list page
3. ✅ Click "Sync ServicePower"
4. ✅ Wait for confirmation
5. ✅ See real claims in your list!

---

## 🔧 Troubleshooting

### No tickets synced (Added: 0)

**Possible reasons:**
- No claims exist in the selected date range
- Date range is too narrow (try 30 days)
- Claim filters don't match (manufacturerName, etc.)

**Solution**: Try a longer date range

### Sync fails with authentication error

**Check:**
1. `.env` file has correct credentials:
   ```
   VITE_SERVICEPOWER_USER_ID=admin@usinhomeservices.com
   VITE_SERVICEPOWER_PASSWORD=Frontier38*
   ```
2. Dev server was restarted after updating `.env`

### Tickets disappear after sync

**This shouldn't happen!** The merge strategy preserves all tickets.

**If it does:**
1. Check browser console for errors
2. Check `localStorage` key `ahs:tickets:data`
3. Report the issue with console logs

---

## 📱 Mobile / Tablet

The sync button works on all devices! Just tap "Sync ServicePower" and wait for the confirmation.

---

## 🎉 Success!

You now have a **live connection** to ServicePower claims! No more manual data entry - just sync and go! 🚀

---

## Next Steps

Want to enhance this further?

- **Auto-sync**: Add a timer to sync automatically every hour
- **Filtered sync**: Add fields to sync specific manufacturers or servicers
- **Export**: Export synced tickets to Excel/CSV
- **Push updates**: Send ticket updates back to ServicePower

Let me know what you'd like to add next!
