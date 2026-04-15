/**
 * Vercel serverless function to securely provide the Groq API key.
 * 
 * Set the GROQ_API_KEY environment variable in Vercel dashboard:
 * Settings → Environment Variables → Add New
 * 
 * Name: GROQ_API_KEY
 * Value: your_groq_api_key_here
 * 
 * Security: Only responds to same-origin requests in production
 */

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Basic CORS check - only allow requests from same origin in production
  const origin = req.headers.origin || req.headers.referer;
  const host = req.headers.host;
  
  // In production, verify origin matches host
  if (process.env.NODE_ENV === 'production' && origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'CORS: Origin not allowed'
        });
      }
    } catch (e) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'Invalid origin'
      });
    }
  }
  
  // Get API key from environment variable
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey) {
    return res.status(503).json({ 
      error: 'API key not configured',
      message: 'Please set GROQ_API_KEY in Vercel environment variables'
    });
  }
  
  // Set CORS headers to allow same-origin requests
  res.setHeader('Access-Control-Allow-Origin', origin || `https://${host}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Return the API key (only to authorized origins)
  res.status(200).json({ apiKey });
}
