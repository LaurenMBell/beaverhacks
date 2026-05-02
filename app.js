const COUNTY = {
  center: { lat: 44.5646, lng: -123.262 },
  label: "Benton County, Oregon",
  radiusMeters: 50000,
  fallbackLocationLabel: "Corvallis, OR 97330",
};

const HEALTHCARE_SERVICES = {
  "primary-care": {
    label: "Primary care",
    query: "primary care clinic",
    includedType: "doctor",
    strictTypeFiltering: false,
  },
  "urgent-care": {
    label: "Urgent care",
    query: "urgent care",
    strictTypeFiltering: false,
  },
  hospital: {
    label: "Hospitals",
    query: "hospital",
    includedType: "hospital",
    strictTypeFiltering: true,
  },
  dentist: {
    label: "Dental care",
    query: "dentist",
    includedType: "dentist",
    strictTypeFiltering: true,
  },
  pharmacy: {
    label: "Pharmacies",
    query: "pharmacy",
    includedType: "pharmacy",
    strictTypeFiltering: true,
  },
  "mental-health": {
    label: "Mental health",
    query: "mental health clinic",
    strictTypeFiltering: false,
  },
  "womens-health": {
    label: "Women's health",
    query: "women's health clinic",
    strictTypeFiltering: false,
  },
  pediatrics: {
    label: "Pediatrics",
    query: "pediatrician",
    strictTypeFiltering: false,
  },
  "physical-therapy": {
    label: "Physical therapy",
    query: "physical therapy",
    includedType: "physiotherapist",
    strictTypeFiltering: true,
  },
  "medical-lab": {
    label: "Medical labs",
    query: "medical lab",
    includedType: "medical_lab",
    strictTypeFiltering: true,
  },
};

const state = {
  geocoder: null,
  infoWindow: null,
  map: null,
  markers: [],
  results: [],
  searchOrigin: COUNTY.center,
};

const elements = {
  chips: [...document.querySelectorAll(".chip")],
  keywordsInput: document.querySelector("#keywords-input"),
  locationInput: document.querySelector("#location-input"),
  map: document.querySelector("#map"),
  openNowInput: document.querySelector("#open-now-input"),
  resultsList: document.querySelector("#results-list"),
  resultsTitle: document.querySelector("#results-title"),
  searchButton: document.querySelector("#search-button"),
  searchForm: document.querySelector("#search-form"),
  serviceSelect: document.querySelector("#service-select"),
  statusMessage: document.querySelector("#status-message"),
  summaryPill: document.querySelector("#summary-pill"),
};

const googleMapsApiKey = window.APP_CONFIG?.googleMapsApiKey;
const CMS_API_BASE = "https://marketplace.api.healthcare.gov/api/v1";
const BENTON_COUNTY_FIPS = "41003"; // Oregon FIPS code for Benton County
const BENTON_ZIP = "97330";         // Corvallis default ZIP

bootstrap();

function bootstrap() {
  bindEvents();

  if (!googleMapsApiKey || googleMapsApiKey === "YOUR_GOOGLE_MAPS_API_KEY") {
    renderMapSetupMessage();
    updateStatus(
      "Add your Google Maps API key in config.js, then reload the page to search for providers.",
      "Setup needed"
    );
    return;
  }

  loadGoogleMapsScript();
}

function bindEvents() {
  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await performSearch();
  });

  elements.chips.forEach((chip) => {
    chip.addEventListener("click", async () => {
      const { service } = chip.dataset;
      elements.serviceSelect.value = service;
      syncActiveChip(service);
      await performSearch();
    });
  });

  elements.serviceSelect.addEventListener("change", () => {
    syncActiveChip(elements.serviceSelect.value);
  });

  bindInsuranceForm(); // <-- add this line
}

function loadGoogleMapsScript() {
  window.initHealthcareFinder = initMapExperience;

  const script = document.createElement("script");
  script.src =
    `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}` +
    `&v=weekly&libraries=places&callback=initHealthcareFinder`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    renderMapSetupMessage(
      "Google Maps failed to load. Check your API key, enabled APIs, and referrer restrictions."
    );
    updateStatus(
      "Google Maps could not load. Verify your key and Google Cloud settings, then try again.",
      "Load failed"
    );
  };

  document.head.appendChild(script);
}

async function initMapExperience() {
  state.map = new google.maps.Map(elements.map, {
    center: COUNTY.center,
    zoom: 11,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  state.geocoder = new google.maps.Geocoder();
  state.infoWindow = new google.maps.InfoWindow();

  drawCountyBoundaryHint();
  updateStatus(
    "Search for primary care, urgent care, pharmacies, mental health, and more across Benton County.",
    "Map ready"
  );

  await performSearch({ initial: true });
}


async function performSearch({ initial = false } = {}) {
  if (!state.map || !state.geocoder) return;

  const service = HEALTHCARE_SERVICES[elements.serviceSelect.value];
  const locationQuery =
    elements.locationInput.value.trim() || COUNTY.fallbackLocationLabel;
  const keywordQuery = elements.keywordsInput.value.trim();
  const openNowOnly = elements.openNowInput.checked;

  setLoading(true, service.label);
  updateStatus(
    `Searching for ${service.label.toLowerCase()} in ${COUNTY.label}...`,
    "Searching"
  );

  try {
    const searchOrigin = await geocodeLocation(locationQuery);
    state.searchOrigin = searchOrigin.location;

    state.map.panTo(searchOrigin.location);
    state.map.setZoom(11);

    const { Place } = await google.maps.importLibrary("places");
    const request = {
      textQuery: buildTextQuery(service.query, locationQuery, keywordQuery),
      fields: [
        "displayName",
        "formattedAddress",
        "location",
        "googleMapsURI",
        "websiteURI",
        "nationalPhoneNumber",
        "rating",
        "regularOpeningHours",
        "businessStatus",
        "primaryType",
        "primaryTypeDisplayName",
      ],
      language: "en-US",
      region: "us",
      maxResultCount: 15,
      locationBias: searchOrigin.location,
      isOpenNow: openNowOnly || undefined,
    };

    if (service.includedType) {
      request.includedType = service.includedType;
      request.useStrictTypeFiltering = service.strictTypeFiltering;
    }

    const { places = [] } = await Place.searchByText(request);
    const results = places
      .map((place) => normalizePlace(place, searchOrigin.formattedAddress))
      .filter((place) => place.location && isWithinCountyBoundary(place.location))
      .sort((left, right) => left.distanceMeters - right.distanceMeters);

    state.results = results;
    renderMarkers(results);
    renderResults(results, service.label, searchOrigin.formattedAddress, initial);

    // ── Insurance plans — scoped here so locationQuery is accessible ──
    if (results.length) {
    (async () => {
      try {
        const zip = resolveZipFromLocation(locationQuery); // no await needed
        console.log("Fetching insurance plans for ZIP:", zip); // should print "97330", not "Promise"
        const plans = await fetchInsurancePlans(zip);
        console.log("Total plans returned:", plans?.length);
        renderInsurancePanel(plans);
    } catch (err) {
    console.warn("Insurance plan fetch failed:", err);
    document.getElementById("insurance-panel")?.remove();
    }
})();
    } else {
      document.getElementById("insurance-panel")?.remove();
    }

  } catch (error) {
    console.error(error);
    clearMarkers();
    elements.resultsList.innerHTML = "";
    document.getElementById("insurance-panel")?.remove();
    updateStatus(
      "The search could not be completed. Check the location entry or your Google Maps setup and try again.",
      "Search failed"
    );
  } finally {
    setLoading(false, service.label);
  }
}

function buildTextQuery(serviceQuery, locationQuery, keywordQuery) {
  const parts = [
    serviceQuery,
    keywordQuery,
    `near ${locationQuery}`,
    `in ${COUNTY.label}`,
  ];

  return parts.filter(Boolean).join(" ");
}

function normalizePlace(place, searchAddress) {
  const location = place.location?.toJSON ? place.location.toJSON() : place.location;
  const distanceMeters = location
    ? calculateDistanceMeters(state.searchOrigin, location)
    : Number.POSITIVE_INFINITY;

  return {
    address: place.formattedAddress || "Address not provided",
    distanceMeters,
    googleMapsUri: place.googleMapsURI || "",
    hours:
      place.regularOpeningHours?.weekdayDescriptions?.[0] ||
      "Hours not available",
    location,
    name: place.displayName || "Healthcare service",
    phone: place.nationalPhoneNumber || "",
    rating: typeof place.rating === "number" ? place.rating : null,
    searchAddress,
    serviceType: place.primaryTypeDisplayName || place.primaryType || "Healthcare",
    websiteUri: place.websiteURI || "",
  };
}

function renderResults(results, serviceLabel, resolvedLocation, initial) {
  elements.resultsTitle.textContent = `${serviceLabel} near ${resolvedLocation}`;

  if (!results.length) {
    elements.resultsList.innerHTML = "";
    updateStatus(
      initial
        ? "No matching healthcare services were returned yet. Try another category or a nearby ZIP code."
        : "No matching services were found inside Benton County. Try broadening the service type or location.",
      "No results"
    );
    return;
  }
  if (results.length) {
  (async () => {
    try {
      const zip = resolveZipFromLocation(locationQuery);
      const plans = await fetchInsurancePlans(zip);
      renderInsurancePanel(plans);
    } catch (err) {
      console.warn("Insurance plan fetch failed:", err);
      document.getElementById("insurance-panel")?.remove();
    }
  })();
} else {
  document.getElementById("insurance-panel")?.remove();
}

  updateStatus(
    `Found ${results.length} ${serviceLabel.toLowerCase()} result${results.length === 1 ? "" : "s"} in or near Benton County.`,
    `${results.length} found`
  );

  elements.resultsList.innerHTML = results
    .map((result, index) => {
      const actions = [
        result.googleMapsUri
          ? `<a href="${result.googleMapsUri}" target="_blank" rel="noreferrer">Directions</a>`
          : "",
        result.websiteUri
          ? `<a href="${result.websiteUri}" target="_blank" rel="noreferrer">Website</a>`
          : "",
        result.phone ? `<a href="tel:${result.phone}">Call</a>` : "",
      ]
        .filter(Boolean)
        .join("");

      const meta = [
        result.serviceType ? `<span class="meta-pill">${escapeHtml(result.serviceType)}</span>` : "",
        result.rating ? `<span class="meta-pill">Rating ${result.rating.toFixed(1)}</span>` : "",
        Number.isFinite(result.distanceMeters)
          ? `<span class="meta-pill">${formatMiles(result.distanceMeters)} away</span>`
          : "",
      ]
        .filter(Boolean)
        .join("");

      return `
        <article class="result-card" data-result-index="${index}">
          <h3>${escapeHtml(result.name)}</h3>
          <div class="result-meta">${meta}</div>
          <p class="result-address">${escapeHtml(result.address)}</p>
          <p class="result-hours">${escapeHtml(result.hours)}</p>
          <div class="result-actions">${actions}</div>
        </article>
      `;
    })
    .join("");

  [...elements.resultsList.querySelectorAll(".result-card")].forEach((card) => {
    card.addEventListener("click", () => {
      const index = Number(card.dataset.resultIndex);
      focusResult(index);
    });
  });
}

function renderMarkers(results) {
  clearMarkers();

  if (!results.length) {
    return;
  }

  const bounds = new google.maps.LatLngBounds();

  results.forEach((result, index) => {
    const marker = new google.maps.Marker({
      map: state.map,
      position: result.location,
      title: result.name,
      label: String(index + 1),
    });

    marker.addListener("click", () => openInfoWindow(result, marker));

    state.markers.push(marker);
    bounds.extend(result.location);
  });

  bounds.extend(COUNTY.center);
  state.map.fitBounds(bounds, 56);
}

function focusResult(index) {
  const result = state.results[index];
  const marker = state.markers[index];

  if (!result || !marker) {
    return;
  }

  state.map.panTo(result.location);
  state.map.setZoom(13);
  openInfoWindow(result, marker);
}

function openInfoWindow(result, marker) {
  const details = [
    `<strong>${escapeHtml(result.name)}</strong>`,
    `<div>${escapeHtml(result.address)}</div>`,
    result.phone ? `<div>${escapeHtml(result.phone)}</div>` : "",
    result.googleMapsUri
      ? `<div><a href="${result.googleMapsUri}" target="_blank" rel="noreferrer">Open in Google Maps</a></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  state.infoWindow.setContent(`<div class="info-window">${details}</div>`);
  state.infoWindow.open({ anchor: marker, map: state.map });
}

function clearMarkers() {
  state.markers.forEach((marker) => marker.setMap(null));
  state.markers = [];
}

function syncActiveChip(service) {
  elements.chips.forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.service === service);
  });
}

function setLoading(isLoading, serviceLabel) {
  elements.searchButton.disabled = isLoading;
  elements.searchButton.textContent = isLoading
    ? `Searching ${serviceLabel.toLowerCase()}...`
    : "Search healthcare services";
}

function updateStatus(message, pillText) {
  elements.statusMessage.textContent = message;
  elements.summaryPill.textContent = pillText;
}

function renderMapSetupMessage(customMessage) {
  elements.map.innerHTML = `
    <div class="map-setup">
      <div>
        <p><strong>Google Maps setup needed</strong></p>
        <p>${escapeHtml(
          customMessage ||
            "Add a valid Maps JavaScript API key in config.js, enable Maps JavaScript API and Places API (New), and reload."
        )}</p>
      </div>
    </div>
  `;
}

function drawCountyBoundaryHint() {
  new google.maps.Circle({
    map: state.map,
    center: COUNTY.center,
    radius: COUNTY.radiusMeters,
    strokeColor: "#0f766e",
    strokeOpacity: 0.6,
    strokeWeight: 2,
    fillColor: "#0f766e",
    fillOpacity: 0.07,
  });
}

async function geocodeLocation(query) {
  const response = await state.geocoder.geocode({
    address: query,
    componentRestrictions: { country: "US" },
  });

  if (!response.results?.length) {
    throw new Error(`No map result found for "${query}".`);
  }

  const topResult = response.results[0];

  return {
    formattedAddress: topResult.formatted_address,
    location: topResult.geometry.location.toJSON(),
  };
}

function isWithinCountyBoundary(location) {
  return calculateDistanceMeters(COUNTY.center, location) <= COUNTY.radiusMeters;
}

function calculateDistanceMeters(from, to) {
  const earthRadius = 6371000;
  const dLat = degreesToRadians(to.lat - from.lat);
  const dLng = degreesToRadians(to.lng - from.lng);
  const startLat = degreesToRadians(from.lat);
  const endLat = degreesToRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(startLat) * Math.cos(endLat);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function formatMiles(distanceMeters) {
  return `${(distanceMeters * 0.000621371).toFixed(1)} mi`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}



// ── Insurance plan lookup ────────────────────────────────────────────────────

async function fetchInsurancePlans(zipCode = BENTON_ZIP, userInputs = {}) {
  const apikey = window.APP_CONFIG?.cmsMarketplaceApiKey;
  if (!apikey) return null;

  const age = parseInt(userInputs.age) || 30;
  const income = parseInt(userInputs.income) || 40000;
  const gender = userInputs.gender || "Female";
  const uses_tobacco = userInputs.tobacco === "true";

  // Dynamically look up the correct FIPS for whatever ZIP was entered
  const countyfips = await getFipsFromZip(zipCode);

  console.log("--- CMS Request ---");
  console.log("ZIP:", zipCode, "FIPS:", countyfips, "Age:", age, "Income:", income);

  const res = await fetch(`${CMS_API_BASE}/plans/search?apikey=${apikey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      household: {
        income,
        people: [
          {
            age,
            aptc_eligible: true,
            gender,
            uses_tobacco,
          },
        ],
      },
      market: "Individual",
      place: {
        countyfips,   // ← now dynamic based on ZIP
        state: "OR",
        zipcode: zipCode,
      },
      year: 2025,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("CMS API raw error:", errorBody);
    throw new Error(`CMS API error: ${res.status}`);
  }

  const data = await res.json();
  console.log("Total plans returned:", data.plans?.length);
  return data.plans ?? [];
}


function renderInsurancePanel(plans) {
  document.getElementById("insurance-panel")?.remove();

  const panel = document.createElement("section");
  panel.id = "insurance-panel";
  panel.className = "insurance-panel";

  if (!plans || !plans.length) {
    panel.innerHTML = `
      <div class="insurance-fallback">
        <p>Browse Oregon health insurance plans directly on the marketplace:</p>
        <a href="https://ohim.checkbookhealth.org/#/pct/individual"
           target="_blank" rel="noreferrer">Compare Oregon Health Plans →</a>
      </div>
    `;
    elements.resultsList.after(panel);
    return;
  }

  // Group by metal level
  const grouped = {
    Bronze: plans.filter(p => p.metal_level === "Bronze"),
    Silver: plans.filter(p => p.metal_level === "Silver"),
    Gold: plans.filter(p => p.metal_level === "Gold"),
    Platinum: plans.filter(p => p.metal_level === "Platinum"),
  };

  // Only include metal levels that actually have plans
  const availableLevels = Object.keys(grouped).filter(
    level => grouped[level].length > 0
  );

  // Build tab buttons for each available metal level
  const tabButtons = availableLevels.map((level, i) => `
    <button
      class="metal-tab ${i === 0 ? "is-active" : ""}"
      data-level="${level}"
      type="button"
    >
      ${level}
      <span class="metal-tab-count">${grouped[level].length}</span>
    </button>
  `).join("");

  // Build cards for each metal level group
  const allCards = availableLevels.map((level, i) => `
    <div
      class="metal-group ${i === 0 ? "is-active" : ""}"
      data-level="${level}"
    >
      <div class="insurance-cards">
        ${grouped[level]
          .sort((a, b) => (a.premium ?? 9999) - (b.premium ?? 9999))
          .map(plan => `
            <article class="insurance-card">
              <div class="insurance-card-header">
                <span class="insurance-card-name">${escapeHtml(plan.name ?? "Plan")}</span>
                <span class="insurance-card-type metal-${level.toLowerCase()}">${escapeHtml(level)}</span>
              </div>
              <div class="insurance-card-meta">
                <span><strong>$${plan.premium != null ? plan.premium.toFixed(0) : "—"}</strong>/mo</span>
                <span>Deductible: $${plan.deductibles?.[0]?.amount?.toLocaleString() ?? "—"}</span>
                <span>OOP max: $${plan.moops?.[0]?.amount?.toLocaleString() ?? "—"}</span>
              </div>
              <div class="insurance-card-issuer">${escapeHtml(plan.issuer?.name ?? "")}</div>
              ${plan.url
                ? `<a class="insurance-card-link" href="${plan.url}" target="_blank" rel="noreferrer">View plan details</a>`
                : ""}
            </article>
          `).join("")}
      </div>
    </div>
  `).join("");

  panel.innerHTML = `
    <h2 class="insurance-title">Oregon Marketplace Insurance Plans</h2>
    <p class="insurance-subtitle">
      Sorted by estimated monthly premium.
      <a href="https://ohim.checkbookhealth.org/#/pct/individual"
         target="_blank" rel="noreferrer">Compare all plans →</a>
    </p>
    <div class="metal-tabs">${tabButtons}</div>
    <div class="metal-groups">${allCards}</div>
  `;

  // Wire up tab switching
  panel.querySelectorAll(".metal-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const level = tab.dataset.level;

      panel.querySelectorAll(".metal-tab").forEach(t => t.classList.remove("is-active"));
      panel.querySelectorAll(".metal-group").forEach(g => g.classList.remove("is-active"));

      tab.classList.add("is-active");
      panel.querySelector(`.metal-group[data-level="${level}"]`).classList.add("is-active");
    });
  });

  elements.resultsList.after(panel);
}
function resolveZipFromLocation(locationQuery) {
  // Try to extract a 5-digit ZIP from the query string first
  const match = locationQuery.match(/\b(\d{5})\b/);
  if (match) return match[1];
  // Fall back to Corvallis
  return BENTON_ZIP;
}

function bindInsuranceForm() {
  const form = document.getElementById("insurance-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const zip = document.getElementById("insurance-zip").value.trim() || BENTON_ZIP;
    const userInputs = {
      age: document.getElementById("insurance-age").value,
      income: document.getElementById("insurance-income").value,
      gender: document.getElementById("insurance-gender").value,
      tobacco: document.getElementById("insurance-tobacco").value,
    };

    const btn = document.getElementById("insurance-search-btn");
    btn.disabled = true;
    btn.textContent = "Searching plans...";

    try {
      const plans = await fetchInsurancePlans(zip, userInputs);
      renderInsurancePanel(plans);
    } catch (err) {
      console.warn("Insurance plan fetch failed:", err);
    } finally {
      btn.disabled = false;
      btn.textContent = "Find Plans";
    }
  });
}

async function getFipsFromZip(zipCode) {
  const apikey = window.APP_CONFIG?.cmsMarketplaceApiKey;
  const res = await fetch(
    `${CMS_API_BASE}/counties/by/zip/${zipCode}?apikey=${apikey}`
  );

  if (!res.ok) {
    console.warn("Could not look up county for ZIP, falling back to Benton County");
    return BENTON_COUNTY_FIPS;
  }

  const data = await res.json();
  console.log("Counties for ZIP:", data);

  // Pick the first county returned for that ZIP
  const county = data.counties?.[0];
  if (!county) return BENTON_COUNTY_FIPS;

  console.log("Using county:", county.name, "FIPS:", county.fips);
  return county.fips;
}


// ---- Chatbot ----

const GEMINI_KEY = window.APP_CONFIG?.geminiApiKey;;
const MODEL = "gemini-2.5-flash";

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${window.APP_CONFIG.geminiApiKey}`;

let chatHistory = [];

function toggleChat() {
  const win = document.getElementById('chat-window');
  const isHidden = win.style.display === 'none';
  win.style.display = isHidden ? 'flex' : 'none';

  if (isHidden && chatHistory.length === 0) {
    addMessage('bot', 'Hi! Describe your symptoms and I\'ll suggest what type of doctor to see and help you find affordable care nearby. 🏥');
  }
}

function addMessage(role, text) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const userText = input.value.trim();
  if (!userText) return;

  // Show user message
  addMessage('user', userText);
  input.value = '';

  // Add to history
  chatHistory.push({
    role: 'user',
    parts: [{ text: userText }]
  });

  // Show loading
  const loadingDiv = addMessage('loading', 'Thinking...');

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a helpful healthcare triage assistant.

    When a user describes symptoms:
    1. Suggest what type of doctor/specialist they should see
    2. Indicate urgency: Emergency, Urgent (within 24hrs), or Routine
    3. Give 1–2 sentences of practical advice
    4. If symptoms sound serious, always recommend emergency care

    Format your response like this:

    Doctor: <type of doctor> <add 2 line spacing>
    Urgency: <Emergency / Urgent / Routine> <add 2 line spacing>
    Advice: <short advice> <add 2 line spacing>

    Keep responses concise and friendly.
    Never diagnose — only suggest next steps.`
              }
            ]
          },
          ...chatHistory
        ]
      })
    });

    const data = await response.json();

    // Check for errors from Gemini
    if (data.error) {
      throw new Error(data.error.message);
    }

    const botReply = data.candidates[0].content.parts[0].text;

    // Replace loading with real response
    loadingDiv.className = 'message bot';
    loadingDiv.textContent = botReply;

    // Add assistant reply to history
    chatHistory.push({
      role: 'model',       // Gemini uses "model" instead of "assistant"
      parts: [{ text: botReply }]
    });

    // Auto-search for providers based on reply
    autoSearchFromReply(botReply);

  } catch (err) {
    loadingDiv.className = 'message bot';
    loadingDiv.textContent = 'Sorry, something went wrong. Please try again.';
    console.error('Gemini error:', err);
  }
}

// Auto-trigger provider search based on AI response
function autoSearchFromReply(reply) {
  const specialtyMap = {
    'primary care': 'primary-care',
    'urgent care': 'urgent-care',
    'emergency': 'urgent-care',
    'dentist': 'dentist',
    'pediatrician': 'pediatrics',
    'gynecologist': 'womens-health',
    'therapist': 'mental-health',
    'psychiatrist': 'mental-health'
  };

  const found = Object.keys(specialtyMap).find(s =>
    reply.toLowerCase().includes(s)
  );

  if (found) {
    const mapped = specialtyMap[found];

    // ✅ use your actual dropdown
    elements.serviceSelect.value = mapped;

    // update UI + search
    syncActiveChip(mapped);
    performSearch();

    addMessage('bot', `🔍 I found nearby ${found}s for you!`);
  }
}

window.toggleChat = toggleChat;
window.sendMessage = sendMessage;