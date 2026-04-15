# API Directory - Vercel Serverless Functions

This directory contains serverless functions that run on Vercel's edge network.

## get-groq-key.js

Provides the Groq API key securely to the frontend without exposing it in client-side code.

### Setup on Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add a new environment variable:
   - **Name**: `GROQ_API_KEY`
   - **Value**: Your Groq API key (get it from https://console.groq.com/)
   - **Environment**: Select all (Production, Preview, Development)
4. Click **Save**
5. Redeploy your project for the changes to take effect

### Endpoint

Once deployed, the function is available at:
```
https://your-domain.vercel.app/api/get-groq-key
```

### Security Note

This endpoint returns the API key to the client. In a production environment, you should:
- Add CORS restrictions to limit which domains can access the endpoint
- Add rate limiting to prevent abuse
- Consider implementing a proxy pattern where the client never sees the API key

For this implementation, we're using a simple approach since the API key is meant to be used on Vercel as stated in the requirements.
