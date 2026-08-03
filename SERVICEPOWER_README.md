# ServicePower API Integration - README

## 📚 Documentation Index

This folder contains everything you need to integrate ServicePower APIs into your application.

### 🚀 Start Here

**→ [`SERVICEPOWER_QUICKSTART.md`](./SERVICEPOWER_QUICKSTART.md)**  
Get up and running in 5 minutes with basic examples and configuration.

### 📖 Full Documentation

1. **[`SERVICEPOWER_API_INTEGRATION.md`](./SERVICEPOWER_API_INTEGRATION.md)**  
   Complete integration guide covering:
   - API endpoints (staging & production)
   - Authentication
   - All three APIs (Claims, Create RFA, Retrieve RFA)
   - Error handling
   - Best practices
   - Common workflows

2. **[`SERVICEPOWER_EXAMPLES.md`](./SERVICEPOWER_EXAMPLES.md)**  
   Practical code examples:
   - Basic API usage
   - React components
   - Background jobs
   - Polling implementations
   - Error handling patterns

3. **[`SERVICEPOWER_IMPLEMENTATION_SUMMARY.md`](./SERVICEPOWER_IMPLEMENTATION_SUMMARY.md)**  
   Overview of what's been implemented:
   - Files created
   - Integration points
   - Testing checklist
   - Next steps

### 💻 Implementation Files

**Types**: `src/types/servicePower.ts`
- Full TypeScript definitions for all API requests and responses
- Utility types for configuration
- Comprehensive interfaces for all data structures

**API Client**: `src/lib/servicePowerApi.ts`
- ServicePower client class
- Factory function for easy setup
- Polling support
- Utility functions for date formatting/parsing

**React Component**: `src/components/ServicePowerIntegration.tsx`
- Example integration component
- Authorization request form
- Status display
- Ready to use in your ticket pages

### ⚙️ Configuration

**Environment Variables** (in `.env`):
```env
VITE_SERVICEPOWER_ENV=staging
VITE_SERVICEPOWER_REGION=na
VITE_SERVICEPOWER_USER_ID=
VITE_SERVICEPOWER_PASSWORD=
VITE_SERVICEPOWER_MANUFACTURER_NAME=
VITE_SERVICEPOWER_SERVICER_NUMBER=
```

## 🎯 Quick Reference

### Three Main APIs

| API | Purpose | When to Use |
|-----|---------|-------------|
| **Claims Retrieval** | Check claim payment status | After claim submission, to verify payment received |
| **Create RFA** | Request additional authorization | When job requires more than pre-agreed amount |
| **Retrieve RFA** | Check authorization status | To see if request was approved/rejected |

### RFA Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| `OPN` | Open | Wait for review |
| `APV` | Approved ✅ | Proceed with work |
| `REJ` | Rejected ❌ | Review reason, resubmit if possible |
| `WAI` | Waiting | Provide additional information |
| `CLS` | Closed | No further action |

## 🔗 Integration Steps

1. **Configure** → Add credentials to `.env`
2. **Import** → Use `createServicePowerClient()` in your code
3. **Test** → Start with staging environment
4. **Integrate** → Add to ticket pages and workflows
5. **Deploy** → Switch to production after testing

## 📋 Common Use Cases

### Use Case 1: Technician Needs More Parts
```typescript
await client.createRFA({
  callNumber: 'CALL-123',
  coreInfo: { whyHigherRate: 'Additional compressor needed' },
  amounts: { requestedLabor: 100 },
  parts: [{ quantity: 1, partNumber: 'ABC-123', ... }]
});
```

### Use Case 2: Check If Claim Was Paid
```typescript
const response = await client.retrieveClaim({
  claimNumber: 'CLM-456'
});
if (response.claims?.[0]?.paymentDate) {
  console.log('Paid!');
}
```

### Use Case 3: Wait for Authorization Approval
```typescript
await client.pollRFAStatus('CALL-123', {
  interval: 60000,
  onUpdate: (response) => {
    console.log('Status:', response.requests?.[0]?.coreInfo?.rfaStatus);
  }
});
```

## 🧪 Testing

1. Use **staging** environment first
2. Test with sample data
3. Verify all three APIs work
4. Check error handling
5. Switch to **production** when ready

## 🆘 Troubleshooting

**Problem**: "Credentials not configured"  
**Solution**: Check `.env` has `VITE_SERVICEPOWER_USER_ID` and `VITE_SERVICEPOWER_PASSWORD`

**Problem**: API returns "ER" response  
**Solution**: Check `messages` array in response for details

**Problem**: Authorization not found  
**Solution**: Verify `callNumber` and `manufacturerName` are correct

## 📞 Getting Help

1. Check the documentation files in this folder
2. Review the code examples
3. Look at transaction IDs in error logs
4. Contact ServicePower support with:
   - Transaction ID
   - Request/response payloads
   - Timestamp
   - Environment (staging/production)

## 🎓 Learning Path

**For New Developers:**
1. Read: `SERVICEPOWER_QUICKSTART.md`
2. Review: `src/types/servicePower.ts`
3. Try: Examples in `SERVICEPOWER_EXAMPLES.md`
4. Test: In staging environment

**For Integration:**
1. Read: `SERVICEPOWER_API_INTEGRATION.md`
2. Study: `src/lib/servicePowerApi.ts`
3. Customize: `src/components/ServicePowerIntegration.tsx`
4. Implement: In your ticket workflows

## 📦 What's Included

- ✅ Complete TypeScript types
- ✅ API client with error handling
- ✅ Polling support for RFA status
- ✅ Date formatting utilities
- ✅ Example React components
- ✅ Comprehensive documentation
- ✅ Code examples
- ✅ Environment configuration

## 🔐 Security Notes

- Never commit `.env` files
- Use HTTPS only (enforced)
- Rotate passwords regularly
- Log transaction IDs, not passwords
- Use separate staging/production credentials

## 🚀 Ready to Start?

→ Open **[`SERVICEPOWER_QUICKSTART.md`](./SERVICEPOWER_QUICKSTART.md)** to begin!

---

## 📁 File Structure

```
darkglass-hub-suite/
├── .env                                    # Add ServicePower credentials here
├── SERVICEPOWER_README.md                  # This file
├── SERVICEPOWER_QUICKSTART.md              # Start here!
├── SERVICEPOWER_API_INTEGRATION.md         # Complete guide
├── SERVICEPOWER_EXAMPLES.md                # Code examples
├── SERVICEPOWER_IMPLEMENTATION_SUMMARY.md  # What's included
├── src/
│   ├── types/
│   │   └── servicePower.ts                # TypeScript definitions
│   ├── lib/
│   │   └── servicePowerApi.ts             # API client
│   └── components/
│       └── ServicePowerIntegration.tsx     # Example component
```

---

**Questions?** Review the documentation files or contact your team lead.

**Found a bug?** Check transaction IDs and error messages first.

**Need a feature?** The API client is extensible - add your own methods!

Happy coding! 🎉
