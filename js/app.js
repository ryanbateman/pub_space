const DATA_FILE = 'pubs_with_distances.geojson';
const map = L.map('map').setView([52.5, -1.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
}).addTo(map);

const markers = L.layerGroup();
let heatLayer = null;

let geojsonLayer = null;
let allData = null;
let processedData = null;
let nearestLineLayer = L.layerGroup();
let nearestLineEnabled = true;
let lineHideTimeout = null;
let popupOpen = false;

// Shared colour scale: thresholds tuned to data distribution (P10-P90)
// Same stops used for both dot markers and heatmap gradient
const DIST_MAX = 1.5; // km — P90 cap; anything above clips to worst colour
const COLOUR_STOPS = [
    { at: 0,    colour: '#313695' }, // deep blue — very close
    { at: 0.25, colour: '#4575b4' }, // blue
    { at: 0.5,  colour: '#abd9e9' }, // light blue
    { at: 0.75, colour: '#fee090' }, // yellow
    { at: 1.0,  colour: '#f46d43' }, // orange
    { at: 1.5,  colour: '#a50026' }, // deep red — worst
];

function distanceToColour(km) {
    const t = Math.min(km / DIST_MAX, 1);
    for (let i = COLOUR_STOPS.length - 1; i >= 0; i--) {
        if (t >= COLOUR_STOPS[i].at / DIST_MAX) {
            return COLOUR_STOPS[i].colour;
        }
    }
    return COLOUR_STOPS[0].colour;
}



function createPopupContent(props) {
    let html = `<div class="popup-content"><h3>${props.title}</h3>`;
    if (props.nearest_external_pub) {
        const nearest = props.nearest_external_pub;
        html += `
            <div class="nearest-info">
                <strong>Next nearest pub:</strong><br>
                ${nearest.name}<br>
                <span class="distance">${nearest.distance_km} km away</span>
            </div>
        `;
    } else {
        html += `<div class="nearest-info">No replacement pub found within 50km</div>`;
    }
    html += `</div>`;
    return html;
}

function onEachFeature(feature, layer) {
    const props = feature.properties;
    const marker = layer;

    if (props.nearest_external_pub) {
        const dist = props.nearest_external_pub.distance_km;
        marker.setIcon(L.divIcon({
            className: 'custom-marker',
            html: `<div style="background:${distanceToColour(dist)};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        }));
    }

    marker.bindPopup(createPopupContent(props), {
        autoPan: true
    });

    marker.on('mouseover', () => {
        if (lineHideTimeout) {
            clearTimeout(lineHideTimeout);
            lineHideTimeout = null;
        }
        showNearestLine(feature);
    });
    marker.on('mouseout', () => {
        if (!popupOpen) {
            lineHideTimeout = setTimeout(hideNearestLine, 300);
        }
    });
    marker.on('popupopen', () => {
        popupOpen = true;
        if (lineHideTimeout) {
            clearTimeout(lineHideTimeout);
            lineHideTimeout = null;
        }
        showNearestLine(feature);
    });
    marker.on('popupclose', () => {
        popupOpen = false;
        hideNearestLine();
    });
}

function showNearestLine(feature) {
    if (!nearestLineEnabled) return;

    const [lon, lat] = feature.geometry.coordinates;
    const nearest = feature.properties.nearest_external_pub;
    if (!nearest) return;

    hideNearestLine();

    if (!map.hasLayer(nearestLineLayer)) {
        nearestLineLayer.addTo(map);
    }

    const line = L.polyline([
        [lat, lon],
        [nearest.lat, nearest.lon]
    ], {
        color: '#e74c3c',
        weight: 2,
        dashArray: '5, 5'
    }).addTo(nearestLineLayer);

    const nearestMarker = L.marker([nearest.lat, nearest.lon], {
        icon: L.divIcon({
            className: 'nearest-marker',
            html: `<div style="background:#e74c3c;width:8px;height:8px;border-radius:50%;border:2px solid white;"></div>`,
            iconSize: [8, 8],
            iconAnchor: [4, 4]
        })
    }).addTo(nearestLineLayer);
}

function hideNearestLine() {
    if (lineHideTimeout) {
        clearTimeout(lineHideTimeout);
        lineHideTimeout = null;
    }
    nearestLineLayer.clearLayers();
}

function filterProcessedOnly(data) {
    return {
        type: data.type,
        features: data.features.filter(f => f.properties.nearest_external_pub !== undefined)
    };
}

let currentData = null; // track which dataset is currently rendered

function getHeatmapParams() {
    return {
        minDist: parseFloat(document.getElementById('slider-minDist').value),
        power: parseFloat(document.getElementById('slider-power').value),
        radius: parseInt(document.getElementById('slider-radius').value),
        blur: parseInt(document.getElementById('slider-blur').value),
        maxOpacity: parseFloat(document.getElementById('slider-maxOpacity').value),
    };
}

function buildHeatmap(data) {
    const params = getHeatmapParams();

    // Collect filtered points
    const points = [];
    data.features.forEach(feat => {
        if (feat.properties.nearest_external_pub) {
            const [lon, lat] = feat.geometry.coordinates;
            const dist = feat.properties.nearest_external_pub.distance_km;
            if (dist >= params.minDist) {
                points.push({ lat, lng: lon, dist });
            }
        }
    });

    // Find actual max distance for normalisation
    const maxDist = points.reduce((max, p) => Math.max(max, p.dist), params.minDist);
    const range = maxDist - params.minDist;

    // Apply power curve to get per-point value
    const heatData = points.map(p => {
        const norm = range > 0 ? (p.dist - params.minDist) / range : 1;
        const value = Math.pow(norm, params.power);
        return { lat: p.lat, lng: p.lng, value };
    });

    if (heatLayer) {
        map.removeLayer(heatLayer);
    }

    heatLayer = new HeatmapOverlay({
        radius: params.radius,
        blur: params.blur / 50, // heatmap.js blur is 0-1 scale
        maxOpacity: params.maxOpacity,
        scaleRadius: false,
        useLocalExtrema: false,
        latField: 'lat',
        lngField: 'lng',
        valueField: 'value',
        gradient: {
            0.0: '#313695',
            0.17: '#4575b4',
            0.33: '#abd9e9',
            0.5: '#fee090',
            0.67: '#f46d43',
            1.0: '#a50026'
        }
    });

    heatLayer.setData({ max: 1, data: heatData });

    if (document.getElementById('toggleHeatmap').checked) {
        map.addLayer(heatLayer);
    }
}

function rebuildHeatmap() {
    if (currentData) {
        buildHeatmap(currentData);
    }
}

// Slider event listeners
['minDist', 'power', 'radius', 'blur', 'maxOpacity'].forEach(param => {
    const slider = document.getElementById(`slider-${param}`);
    const valSpan = document.getElementById(`val-${param}`);
    slider.addEventListener('input', () => {
        valSpan.textContent = slider.value;
        rebuildHeatmap();
    });
});

function loadGeoJSON() {
    fetch(DATA_FILE)
        .then(resp => resp.json())
        .then(data => {
            allData = data;
            processedData = filterProcessedOnly(data);

            const showProcessedOnly = document.getElementById('toggleProcessedOnly').checked;
            renderMap(showProcessedOnly ? processedData : allData);
        })
        .catch(err => console.error('Error loading GeoJSON:', err));
}

function renderMap(data) {
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
        markers.clearLayers();
    }

    currentData = data;

    geojsonLayer = L.geoJSON(data, {
        onEachFeature: onEachFeature,
        pointToLayer: (feature, latlng) => L.marker(latlng)
    });

    markers.addLayer(geojsonLayer);
    map.addLayer(markers);

    // Heatmap: build from current slider values
    buildHeatmap(data);
}

document.getElementById('toggleMarkers').addEventListener('change', (e) => {
    if (e.target.checked) {
        map.addLayer(markers);
    } else {
        map.removeLayer(markers);
    }
});

document.getElementById('toggleHeatmap').addEventListener('change', (e) => {
    if (!heatLayer) return;
    if (e.target.checked) {
        map.addLayer(heatLayer);
    } else {
        map.removeLayer(heatLayer);
    }
});

document.getElementById('toggleProcessedOnly').addEventListener('change', (e) => {
    const dataToRender = e.target.checked ? processedData : allData;
    if (dataToRender) {
        renderMap(dataToRender);
    }
});

document.getElementById('toggleNearestLine').addEventListener('change', (e) => {
    nearestLineEnabled = e.target.checked;
    if (nearestLineEnabled) {
        nearestLineLayer.addTo(map);
    } else {
        map.removeLayer(nearestLineLayer);
        hideNearestLine();
    }
});

loadGeoJSON();