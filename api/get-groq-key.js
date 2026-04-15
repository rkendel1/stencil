/**
 * Vercel serverless function to securely provide the Groq API key.
 * 
 * Set the GROQ_API_KEY environment variable in Vercel dashboard:
 * Settings → Environment Variables → Add New
 * 
 * Name: GROQ_API_KEY
 * Value: your_groq_api_key_here
 */

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Get API key from environment variable
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey) {
    return res.status(503).json({ 
      error: 'API key not configured',
      message: 'Please set GROQ_API_KEY in Vercel environment variables'
    });
  }
  
  // Return the API key (only to authorized origins if needed)
  res.status(200).json({ apiKey });
}
