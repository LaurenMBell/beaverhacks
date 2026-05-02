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
  transportationSelect: document.querySelector("#transportation-select"),
  travelTimeSelect: document.querySelector("#travel-time"),
  resultsList: document.querySelector("#results-list"),
  resultsTitle: document.querySelector("#results-title"),
  searchButton: document.querySelector("#search-button"),
  searchForm: document.querySelector("#search-form"),
  serviceSelect: document.querySelector("#service-select"),
  statusMessage: document.querySelector("#status-message"),
  summaryPill: document.querySelector("#summary-pill"),
};

const googleMapsApiKey = window.APP_CONFIG?.googleMapsApiKey;

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

  elements.transportationSelect?.addEventListener("change", async () => {
    await performSearch();
  });

  elements.travelTimeSelect?.addEventListener("change", async () => {
    await performSearch();
  });
}

function loadGoogleMapsScript() {
  window.initHealthcareFinder = initMapExperience;

  const script = document.createElement("script");
  script.src =
    `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}` +
    `&v=weekly&libraries=places,routes&callback=initHealthcareFinder`;
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
  if (!state.map || !state.geocoder) {
    return;
  }

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
    const searchOrigin = await resolveSearchOrigin(locationQuery);
    state.searchOrigin = searchOrigin.location;

    state.map.panTo(searchOrigin.location);
    state.map.setZoom(11);

    const { Place } = await google.maps.importLibrary("places");
    const request = {
      textQuery: buildTextQuery(service.query, locationQuery, keywordQuery),
      fields: [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "rating",
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
    const detailedPlaces = await Promise.all(
      places.map(async (place) => {
        try {
          await fetchPlaceDetails(place);
        } catch (detailError) {
          console.warn("Place details fetch failed for result:", detailError);
        }

        return place;
      })
    );

    // Normalize and prefilter by county boundary
    let results = detailedPlaces
      .map((place) => normalizePlace(place, searchOrigin.formattedAddress))
      .filter((place) => place.location && isWithinCountyBoundary(place.location));

    // Read transport selections
    const transportModeVal = elements.transportationSelect?.value || "drive";
    const maxTravelMinutes = Number(elements.travelTimeSelect?.value) || null;

    // Use the Maps JavaScript DistanceMatrixService to get travel time (avoids CORS).
    const travelModeForMatrix =
      transportModeVal === "walk"
        ? google.maps.TravelMode.WALKING
        : transportModeVal === "bike"
        ? google.maps.TravelMode.BICYCLING
        : google.maps.TravelMode.DRIVING;

    if (results.length) {
      await computeRouteMatrixForResults(results, travelModeForMatrix);
    }

    // Apply travel-time filter if a max travel time is selected
    if (Number.isFinite(maxTravelMinutes) && maxTravelMinutes > 0) {
      const maxSeconds = maxTravelMinutes * 60;
      results = results.filter(
        (place) => (place.travelTimeSeconds ?? Number.POSITIVE_INFINITY) <= maxSeconds
      );
    }

    // Sort results: if travel-time filter is active, sort by travel time, otherwise by distance
    results.sort((left, right) => {
      if (Number.isFinite(maxTravelMinutes) && maxTravelMinutes > 0) {
        return (left.travelTimeSeconds || Number.POSITIVE_INFINITY) - (right.travelTimeSeconds || Number.POSITIVE_INFINITY);
      }
      return left.distanceMeters - right.distanceMeters;
    });

    state.results = results;
    renderMarkers(results);
    renderResults(results, service.label, searchOrigin.formattedAddress, initial);
  } catch (error) {
    console.error(error);
    clearMarkers();
    elements.resultsList.innerHTML = "";
    updateStatus(
      buildSearchFailureMessage(error),
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
  const openingHours = place.regularOpeningHours?.weekdayDescriptions;

  return {
    address: place.formattedAddress || "Address not provided",
    distanceMeters,
    googleMapsLinks: place.googleMapsLinks || place.googleMapsLinks || "",
    hours:
      (Array.isArray(openingHours) && openingHours.length
        ? openingHours.join(" • ")
        : null) ||
      "Hours not available",
    location,
    name: place.displayName || "Healthcare service",
    phone: place.nationalPhoneNumber || "",
    rating: typeof place.rating === "number" ? place.rating : null,
    searchAddress,
    serviceType: place.primaryTypeDisplayName || place.primaryType || "Healthcare",
    websiteURI: place.websiteURI || place.websiteURI || "",
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
        result.googleMapsLinks
          ? `<a href="${result.googleMapsLinks}" target="_blank" rel="noreferrer">Directions</a>`
          : "",
        result.websiteURI
          ? `<a href="${result.websiteURI}" target="_blank" rel="noreferrer">Website</a>`
          : "",
        result.phone ? `<a href="tel:${result.phone}">Call</a>` : "",
      ]
        .filter(Boolean)
        .join("");

      const meta = [
        result.serviceType ? `<span class="meta-pill">${escapeHtml(result.serviceType)}</span>` : "",
        result.rating ? `<span class="meta-pill">Rating ${result.rating.toFixed(1)}</span>` : "",
        Number.isFinite(result.travelTimeSeconds)
          ? `<span class="meta-pill">${escapeHtml(formatTravelTime(result.travelTimeSeconds))}</span>`
          : "",
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
    result.googleMapsLinks
      ? `<div><a href="${result.googleMapsLinks}" target="_blank" rel="noreferrer">Open in Google Maps</a></div>`
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

function buildSearchFailureMessage(error) {
  const message = typeof error?.message === "string" ? error.message : "";

  if (message.includes("ApiNotActivatedMapError")) {
    return "Google Maps loaded, but the required Places service is not activated for this project. Enable Places API (New) in Google Cloud and try again.";
  }

  if (message.includes("RefererNotAllowedMapError")) {
    return "This API key is blocked by its HTTP referrer restrictions. Add your local URL, like http://localhost:4173/*, in Google Cloud.";
  }

  if (message.includes("REQUEST_DENIED") || message.includes("PERMISSION_DENIED")) {
    return `Google denied the Places request. Confirm that Places API (New) is enabled, billing is active, and the key is allowed to use Places. Raw error: ${message}`;
  }

  if (message) {
    return `Search failed: ${message}`;
  }

  return "The search could not be completed. Check the location entry or your Google Maps setup and try again.";
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

function formatTravelTime(seconds) {
  if (!Number.isFinite(seconds) || seconds === Number.POSITIVE_INFINITY) return "Time unavailable";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remaining = mins % 60;
  return `${hours} hr${hours > 1 ? "s" : ""}${remaining ? ` ${remaining} min` : ""}`;
}

async function fetchPlaceDetails(place) {
  const detailFields = [
    "googleMapsLinks",
    "websiteURI",
    "nationalPhoneNumber",
    "regularOpeningHours",
  ];

  if (!place?.fetchFields) return;

  try {
    await place.fetchFields({ fields: detailFields });
  } catch (error) {
    const message = typeof error?.message === "string" ? error.message : "";

    if (message.includes("fields: not iterable") || message.includes("unknown property 0")) {
      await place.fetchFields(detailFields);
      return;
    }

    throw error;
  }
}

async function computeRouteMatrixForResults(results, transportModeVal) {
  const modeMap = {
    drive: 'DRIVE',
    walk: 'WALK',
    bike: 'BICYCLE',
    transit: 'TRANSIT'
  };

  const travelMode = modeMap[transportModeVal] ?? 'DRIVE';

  await Promise.all(
    results.map(async (place) => {
      try {
        const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleMapsApiKey,
            'X-Goog-FieldMask': 'routes.duration'
          },
          body: JSON.stringify({
            origin: {
              location: { latLng: { 
                latitude: state.searchOrigin.lat, 
                longitude: state.searchOrigin.lng 
              }}
            },
            destination: {
              location: { latLng: { 
                latitude: place.location.lat, 
                longitude: place.location.lng 
              }}
            },
            travelMode,
          })
        });

        const data = await response.json();
        const durationStr = data.routes?.[0]?.duration;
        place.travelTimeSeconds = durationStr ? parseInt(durationStr) : null;
      } catch (err) {
        console.warn('Routes API failed for place:', place.displayName, err);
        place.travelTimeSeconds = null;
      }
    })
  );
}



function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
