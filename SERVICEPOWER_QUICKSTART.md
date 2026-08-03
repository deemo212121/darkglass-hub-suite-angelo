# ServicePower Integration - Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### Step 1: Configure Credentials

Edit `.env` file and add your ServicePower credentials:

```env
VITE_SERVICEPOWER_ENV=staging
VITE_SERVICEPOWER_REGION=na
VITE_SERVICEPOWER_USER_ID=your_user_id_here
VITE_SERVICEPOWER_PASSWORD=your_password_here
VITE_SERVICEPOWER_MANUFACTURER_NAME=YourManufacturerName
```

### Step 2: Basic Usage

```typescript
import { createServicePowerClient } from '@/lib/servicePowerApi';

// Create client (uses environment variables automatically)
const client = createServicePowerClient();

// Check a claim
const claimResponse = await client.retrieveClaim({
  claimNumber: 'CLM-12345'
});

// Create authorization request
const rfaResponse = await client.createRFA({
  callNumber: 'CALL-67890',
  coreInfo: {
    whyHigherRate: 'Additional parts needed',
    estimatedHoursOnJob: 2
  },
  amounts: {
    requestedLabor: 150.00
  }
});

// Check authorization status
const statusResponse = await client.retrieveRFA({
  callNumber: 'CALL-67890'
});
```

## 📚 Key Concepts

### Three Main APIs

1. **Claims Retrieval** - Check payment status of submitted claims
2. **Create RFA** - Request additional authorization when needed
3. **Retrieve RFA** - Check authorization approval status

### RFA Status Codes

- `OPN` - Open (pending review)
- `APV` - Approved ✅
- `REJ` - Rejected ❌
- `WAI` - Waiting for more info ⏸️
- `CLS` - Closed 🔒

## 🔄 Common Workflows

### Workflow 1: Request Authorization

```typescript
// 1. Submit request
await client.createRFA({
  callNumber: 'CALL-123',
  coreInfo: { whyHigherRate: 'Reason here...' },
  amounts: { requestedLabor: 200.00 }
});

// 2. Poll for decision (checks every minute)
const result = await client.pollRFAStatus('CALL-123', {
  interval: 60000,
  maxAttempts: 60
});

// 3. Check if approved
if (result.requests?.[0]?.coreInfo?.rfaStatusCode === 'APV') {
  console.log('Approved!');
}
```

### Workflow 2: Check Claim Payment

```typescript
const response = await client.retrieveClaim({
  claimNumber: 'CLM-456'
});

const claim = response.claims?.[0];
if (claim?.paymentDate) {
  console.log(`Paid: $${claim.paymentAmount}`);
}
```

## 🧪 Testing

1. **Use staging first**: Set `VITE_SERVICEPOWER_ENV=staging`
2. **Test each API**: Start with claims retrieval (safest)
3. **Verify data**: Check responses match expected format
4. **Switch to production**: Change to `VITE_SERVICEPOWER_ENV=production`

## 📋 Checklist Before Production

- [ ] Tested all APIs in staging environment
- [ ] Verified credentials work
- [ ] Handling errors properly
- [ ] Logging transaction IDs for debugging
- [ ] Security: credentials not in source control
- [ ] Polling intervals are reasonable (not too frequent)
- [ ] User notifications implemented for approvals/rejections

## 🆘 Troubleshooting

### "Credentials not configured" Error
**Solution**: Check `.env` file has `VITE_SERVICEPOWER_USER_ID` and `VITE_SERVICEPOWER_PASSWORD`

### API Returns "ER" Response Code
**Solution**: Check `messages` array in response for specific errors

### Authorization Not Found
**Solution**: 
- Verify `callNumber` is correct
- Check `manufacturerName` matches your account
- Try date range query instead

### Network Timeout
**Solution**: ServicePower APIs can be slow, increase timeout or implement retry logic

## 📖 Documentation Files

- **`SERVICEPOWER_API_INTEGRATION.md`** - Complete integration guide
- **`SERVICEPOWER_EXAMPLES.md`** - Code examples and React components
- **`src/types/servicePower.ts`** - Full TypeScript type definitions
- **`src/lib/servicePowerApi.ts`** - API client implementation

## 🔐 Security Best Practices

1. **Never commit credentials** - Use `.env` files only
2. **Use HTTPS only** - ServicePower requires secure connections
3. **Rotate passwords regularly** - Update credentials periodically
4. **Log transaction IDs** - Include in error reports to support
5. **Sanitize logs** - Don't log passwords or sensitive customer data

## 💡 Pro Tips

1. **Cache claim data** - Reduce API calls by caching recent lookups
2. **Batch polling** - Poll multiple RFAs in a single scheduled job
3. **Set expectations** - Tell technicians RFA review takes time
4. **Track metrics** - Monitor approval rates and processing times
5. **Provide context** - More detail in `whyHigherRate` = faster approvals

## 🎯 Next Steps

1. Read the full integration guide: `SERVICEPOWER_API_INTEGRATION.md`
2. Review code examples: `SERVICEPOWER_EXAMPLES.md`
3. Test in staging environment
4. Integrate into your ticket workflow
5. Deploy to production

## Need Help?

- Review the PDF documentation provided
- Check transaction IDs in error logs
- Contact ServicePower support with specific transaction IDs
- Review sample JSON requests/responses at documented URLs
