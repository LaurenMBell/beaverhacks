// api/config.js
export default function handler(req, res) {
  res.status(200).json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
  });
}