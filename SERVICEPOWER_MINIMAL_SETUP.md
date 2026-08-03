# ServicePower - Minimal Setup Guide

## ✅ You Only Need User ID & Password!

Good news - you only need your **User ID** and **Password** to get started. The other fields are optional.

## 🔧 Setup (2 Steps)

### Step 1: Add Your Credentials to `.env`

Open `.env` and replace the placeholder values:

```env
# REQUIRED: Your ServicePower credentials
VITE_SERVICEPOWER_USER_ID=your_actual_user_id
VITE_SERVICEPOWER_PASSWORD=your_actual_password

# OPTIONAL: Leave these as-is (or change if you know your settings)
VITE_SERVICEPOWER_ENV=staging
VITE_SERVICEPOWER_REGION=na
```

**Important**: 
- Replace `your_actual_user_id` with your real ServicePower user ID
- Replace `your_actual_password` with your real ServicePower password
- Start with `staging` environment for testing
- Use `na` region if you're in North America, `eu` for Europe

### Step 2: Test Your Connection

Create a test file to verify your credentials work:

**File: `test-servicepower.ts`** (create in project root)

```typescript
import { createServicePowerClient } from './src/lib/servicePowerApi';

async function testConnection() {
  console.log('🔍 Testing ServicePower connection...\n');
  
  try {
    const client = createServicePowerClient();
    console.log('✅ Client created successfully');
    
    // Test 1: Try to retrieve a claim (will likely return empty, but tests auth)
    console.log('\n📝 Testing Claims Retrieval API...');
    const response = await client.retrieveClaim({
      claimNumber: 'TEST-12345' // Replace with a real claim number if you have one
    });
    
    console.log('Response Code:', response.responseCode);
    
    if (response.responseCode === 'OK') {
      console.log('✅ API call successful!');
      console.log('Claims found:', response.claims?.length || 0);
    } else {
      console.log('⚠️ API returned error:');
      console.log('Messages:', response.messages?.map(m => m.message).join(', '));
    }
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    console.log('\nPossible issues:');
    console.log('1. Check your credentials in .env');
    console.log('2. Make sure you can access the ServicePower website');
    console.log('3. Verify you\'re using the correct region (na/eu)');
    console.log('4. Check if you need staging vs production environment');
  }
}

testConnection();
```

Run the test:
```bash
npx tsx test-servicepower.ts
```

## 🎯 What About the Optional Fields?

### `VITE_SERVICEPOWER_MANUFACTURER_NAME`
**When you need it:**
- When calling APIs on behalf of a manufacturer (if you're a servicer)
- Can also be passed directly in API calls

**Example:**
```typescript
await client.retrieveClaim({
  claimNumber: 'CLM-123',
  manufacturerName: 'SomeManufacturer' // Pass directly
});
```

### `VITE_SERVICEPOWER_SERVICER_NUMBER`
**When you need it:**
- When retrieving claims as a servicer
- Optional for most use cases

**You can leave these empty for now** - they'll be passed as parameters when needed.

## 🚀 Quick Usage Examples

### Example 1: Check a Claim (Minimal)

```typescript
import { createServicePowerClient } from '@/lib/servicePowerApi';

const client = createServicePowerClient();

// Just need claim number
const response = await client.retrieveClaim({
  claimNumber: 'CLM-12345'
});

console.log('Claim status:', response.claims?.[0]?.claimStatusDescription);
```

### Example 2: Request Authorization (Minimal)

```typescript
// Provide manufacturer name in the call if not in .env
const response = await client.createRFA({
  manufacturerName: 'YourManufacturer', // Required
  callNumber: 'CALL-67890',              // Required
  coreInfo: {
    whyHigherRate: 'Additional parts needed - compressor failed',
    estimatedHoursOnJob: 2
  },
  amounts: {
    requestedLabor: 150.00
  }
});
```

### Example 3: Check Authorization Status (Minimal)

```typescript
const response = await client.retrieveRFA({
  callNumber: 'CALL-67890',
  manufacturerName: 'YourManufacturer' // Can pass here if not in .env
});

const status = response.requests?.[0]?.coreInfo?.rfaStatusCode;
console.log('Authorization status:', status); // OPN, APV, REJ, WAI, CLS
```

## 🔍 Troubleshooting

### "Credentials not configured"
**Fix**: Make sure you set both `VITE_SERVICEPOWER_USER_ID` and `VITE_SERVICEPOWER_PASSWORD` in `.env`

### "Invalid user or password"
**Fix**: 
1. Double-check your credentials
2. Try logging into ServicePower website with same credentials
3. You may need API-specific credentials (ask ServicePower)

### "Manufacturer name required"
**Fix**: Either:
- Set `VITE_SERVICEPOWER_MANUFACTURER_NAME` in `.env`, OR
- Pass `manufacturerName` parameter in your API calls

### API returns empty results
**Good news**: Your connection works! The API is returning successfully but no data matches your query.

## ✅ You're Ready!

With just your user ID and password, you can:
- ✅ Check claim payment status
- ✅ Request additional authorization
- ✅ Poll for authorization approval
- ✅ Track all payment details

The optional fields can be added later as you need them, or passed directly in API calls.

## 📖 Next Steps

1. **Test your connection** using the test script above
2. **Try a real API call** with actual claim/call numbers from your system
3. **Integrate into your app** - see `SERVICEPOWER_EXAMPLES.md` for code examples
4. **Switch to production** when ready by changing `VITE_SERVICEPOWER_ENV=production`

---

**Questions?** 
- Review `SERVICEPOWER_QUICKSTART.md` for more examples
- Check `SERVICEPOWER_API_INTEGRATION.md` for full documentation
- Contact ServicePower support if credential issues persist
