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
  mapCircle: null,
  markers: [],
  results: [],
  searchOrigin: COUNTY.center,
  activeView: "results",
  selectedServices: new Set(["primary-care"]),
};

const elements = {
  chips: [...document.querySelectorAll(".chip")],
  keywordsInput: document.querySelector("#keywords-input"),
  locationInput: document.querySelector("#location-input"),
  map: document.querySelector("#map"),
  mapView: document.querySelector("#map-view"),
  openNowInput: document.querySelector("#open-now-input"),
  resultsList: document.querySelector("#results-list"),
  resultsView: document.querySelector("#results-view"),
  resultsTitle: document.querySelector("#results-title"),
  searchButton: document.querySelector("#search-button"),
  searchForm: document.querySelector("#search-form"),
  statusMessage: document.querySelector("#status-message"),
  summaryPill: document.querySelector("#summary-pill"),
  viewToggle: document.querySelector("#view-toggle"),
};

const googleMapsApiKey = window.APP_CONFIG?.googleMapsApiKey;

bootstrap();

function bootstrap() {
  bindEvents();
  syncActiveChips();
  setActiveView(state.activeView);

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

  elements.viewToggle.addEventListener("click", async () => {
    await setActiveView(state.activeView === "results" ? "map" : "results");
  });

  elements.chips.forEach((chip) => {
    chip.addEventListener("click", async () => {
      const { service } = chip.dataset;
      toggleService(service);
      syncActiveChips();

      if (state.geocoder) {
        await performSearch();
      }
    });
  });
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
  state.geocoder = new google.maps.Geocoder();
  state.infoWindow = new google.maps.InfoWindow();
  updateStatus(
    "Search for primary care, urgent care, pharmacies, mental health, and more across Benton County.",
    "Map ready"
  );

  await performSearch({ initial: true });
}

async function performSearch({ initial = false } = {}) {
  if (!state.geocoder) {
    return;
  }

  const selectedServiceKeys = [...state.selectedServices];
  if (!selectedServiceKeys.length) {
    updateStatus("Choose at least one healthcare service to search.", "Select service");
    return;
  }

  const selectedServices = selectedServiceKeys.map((key) => HEALTHCARE_SERVICES[key]);
  const locationQuery =
    elements.locationInput.value.trim() || COUNTY.fallbackLocationLabel;
  const keywordQuery = elements.keywordsInput.value.trim();
  const openNowOnly = elements.openNowInput.checked;
  const serviceLabels = selectedServices.map((service) => service.label);

  setLoading(true, buildServiceSummary(serviceLabels));
  updateStatus(
    `Searching for ${buildServiceSummary(serviceLabels).toLowerCase()} in ${COUNTY.label}...`,
    "Searching"
  );

  try {
    const searchOrigin = await resolveSearchOrigin(locationQuery);
    state.searchOrigin = searchOrigin.location;

    if (state.map) {
      state.map.panTo(searchOrigin.location);
      state.map.setZoom(11);
    }

    const { Place } = await google.maps.importLibrary("places");
    const placesByService = await Promise.all(
      selectedServices.map(async (service) => {
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
          maxResultCount: 12,
          locationBias: searchOrigin.location,
          isOpenNow: openNowOnly || undefined,
        };

        if (service.includedType) {
          request.includedType = service.includedType;
          request.useStrictTypeFiltering = service.strictTypeFiltering;
        }

        const { places = [] } = await Place.searchByText(request);
        return places;
      })
    );

    const dedupedResults = new Map();
    placesByService
      .flat()
      .map((place) => normalizePlace(place, searchOrigin.formattedAddress))
      .filter((place) => place.location && isWithinCountyBoundary(place.location))
      .forEach((place) => {
        const key = place.googleMapsUri || `${place.name}|${place.address}`;
        const existing = dedupedResults.get(key);

        if (!existing || place.distanceMeters < existing.distanceMeters) {
          dedupedResults.set(key, place);
        }
      });

    const results = [...dedupedResults.values()].sort(
      (left, right) => left.distanceMeters - right.distanceMeters
    );

    state.results = results;
    if (state.map) {
      renderMarkers(results);
    }
    renderResults(
      results,
      buildServiceSummary(serviceLabels),
      searchOrigin.formattedAddress,
      initial
    );
  } catch (error) {
    console.error(error);
    clearMarkers();
    elements.resultsList.innerHTML = "";
    updateStatus(
      "The search could not be completed. Check the location entry or your Google Maps setup and try again.",
      "Search failed"
    );
  } finally {
    setLoading(false, buildServiceSummary(serviceLabels));
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

async function focusResult(index) {
  const result = state.results[index];

  if (!result) {
    return;
  }

  await setActiveView("map");
  const marker = state.markers[index];

  if (!marker) {
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

function syncActiveChips() {
  elements.chips.forEach((chip) => {
    chip.classList.toggle("is-active", state.selectedServices.has(chip.dataset.service));
  });
}

function toggleService(service) {
  if (state.selectedServices.has(service)) {
    if (state.selectedServices.size === 1) {
      return;
    }

    state.selectedServices.delete(service);
    return;
  }

  state.selectedServices.add(service);
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

async function setActiveView(view) {
  state.activeView = view === "map" ? "map" : "results";

  const showingResults = state.activeView === "results";
  elements.resultsView.hidden = !showingResults;
  elements.mapView.hidden = showingResults;
  elements.resultsView.classList.toggle("panel-view-active", showingResults);
  elements.mapView.classList.toggle("panel-view-active", !showingResults);
  elements.viewToggle.classList.toggle("is-map", !showingResults);
  elements.viewToggle.setAttribute("aria-pressed", String(!showingResults));

  if (!showingResults) {
    await nextFrame();
    await ensureMapInitialized();

    if (state.map && window.google?.maps) {
      renderMarkers(state.results);
      window.requestAnimationFrame(() => {
        google.maps.event.trigger(state.map, "resize");
        if (!state.results.length) {
          state.map.panTo(state.searchOrigin);
          state.map.setZoom(11);
        }
      });
    }
  }
}

async function ensureMapInitialized() {
  if (state.map || !window.google?.maps) {
    return;
  }

  await nextFrame();

  state.map = new google.maps.Map(elements.map, {
    center: state.searchOrigin,
    zoom: 11,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  drawCountyBoundaryHint();

  if (state.results.length) {
    renderMarkers(state.results);
    window.requestAnimationFrame(() => {
      google.maps.event.trigger(state.map, "resize");
    });
  }
}

function nextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function drawCountyBoundaryHint() {
  if (state.mapCircle) {
    state.mapCircle.setMap(null);
  }

  state.mapCircle = new google.maps.Circle({
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

async function resolveSearchOrigin(query) {
  try {
    return await geocodeLocation(query);
  } catch (error) {
    const message = typeof error?.message === "string" ? error.message : "";

    if (
      message.includes("REQUEST_DENIED") ||
      message.includes("The webpage is not allowed to use the geocoder")
    ) {
      console.warn("Geocoder unavailable, falling back to county center:", error);
      return {
        formattedAddress: `${query} (search biased from ${COUNTY.fallbackLocationLabel})`,
        location: COUNTY.center,
      };
    }

    throw error;
  }
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

function buildServiceSummary(labels) {
  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---- Chatbot ----

const GEMINI_KEY = window.APP_CONFIG?.geminiApiKey;;
const MODEL = "gemini-2.5-flash";

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

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
    state.selectedServices = new Set([mapped]);
    syncActiveChips();
    performSearch();

    addMessage('bot', `🔍 I found nearby ${found}s for you!`);
  }
}

window.toggleChat = toggleChat;
window.sendMessage = sendMessage;
