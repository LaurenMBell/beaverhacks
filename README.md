# Benton County Healthcare Finder

A lightweight, static web app for finding healthcare services in Benton County, Oregon with the Google Maps JavaScript API and the Places Library.

## What this includes

- Benton County-focused healthcare search experience
- Google map with place markers
- Search by address or ZIP code
- Service filters for common healthcare needs
- Result cards with ratings, phone numbers, hours, website links, and directions
- No build step or framework required

## Setup

1. Create a Google Maps Platform API key.
2. Enable these APIs in your Google Cloud project:
   - Maps JavaScript API
   - Places API (New)
3. Open [config.js](/Users/laurenbell/Desktop/beaverhacks/config.js) and replace `YOUR_GOOGLE_MAPS_API_KEY` with your key.
4. Serve the project locally:

```bash
python3 -m http.server 4173
```

5. Visit [http://localhost:4173](http://localhost:4173).

## Notes

- This app is client-side only, so your API key should be restricted by HTTP referrer in Google Cloud.
- Search is tuned for Benton County by combining Google Places text search with a Benton County geographic filter.
- The UI defaults to Corvallis and works well for nearby communities such as Philomath, Alsea, Monroe, Adair Village, and North Albany-area searches.
- There were issues with github pushing so we have another repository with full working code, go here to check it out: https://github.com/AngelaALdu/Beaverhacks2026.git
