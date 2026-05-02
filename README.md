# Whitbread Pub Closures - Impact Map

An interactive map visualising the impact of Whitbread pub closures (Beefeater, Brewers Fayre, etc.) across the UK. For each closing pub, it calculates the distance to the next nearest non-Whitbread pub — highlighting communities that will be left furthest from their local.

**[View the live map](https://ryanb.github.io/pub_space/)** *(update URL after publishing)*

## How It Works

1. **Source data** (`whitbread_pubs.geojson`) contains 198 Whitbread pub locations scheduled for closure.
2. **Preprocessing** (`calculate_distances.py`) queries the [Overpass API](https://overpass-api.de/) to find all pubs within 50km of each closing pub, filters out other Whitbread pubs (by proximity), and records the nearest remaining pub with its name, coordinates, and distance.
3. **Frontend** (`index.html`) renders the results on a Leaflet.js map with:
   - Colour-coded markers (blue = close replacement, red = distant replacement)
   - A distance-weighted heatmap showing where the impact is worst
   - Hover/click lines showing the path to the nearest replacement pub
   - Adjustable heatmap parameters for exploring the data

## Data Flow

```
whitbread_pubs.geojson
        |
        v
  calculate_distances.py (Overpass API queries)
        |
        v
pubs_with_distances.geojson
        |
        v
  index.html (Leaflet.js map)
```

## Running Locally

### Prerequisites

- Python 3
- `curl` (used by the preprocessing script)

### Preprocessing (one-time, ~4 mins)

```bash
python3 calculate_distances.py
```

The script is incremental — if interrupted, re-running it will skip already-processed pubs and resume where it left off.

### Serving the map

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Preprocessing | Python 3, Overpass API, Haversine distance |
| Map tiles | OpenStreetMap via Leaflet.js |
| Heatmap | Leaflet.heat |
| Hosting | GitHub Pages |

## Project Structure

```
├── index.html                  # Map entry point
├── css/style.css               # Styles
├── js/app.js                   # Map rendering logic
├── calculate_distances.py      # Preprocessing script
├── whitbread_pubs.geojson      # Source: 198 Whitbread pub locations
├── pubs_with_distances.geojson # Generated: pubs enriched with nearest-pub data
└── SPEC.md                     # Detailed technical specification
```

## Credits

Made by **Ryan B**, with the assistance of **Claude Opus 4.6** (Anthropic) and **MinMax 2.7** using OpenCode.

## License

MIT
