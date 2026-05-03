export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    const config = {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      geminiApiKey: process.env.GEMINI_API_KEY || ''
    };
    
    return res.status(200).json(config);
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}
