# Whitbread Pub Closures - Impact Map

An interactive map visualising the impact of Whitbread pub closures (Beefeater, Brewers Fayre, etc.) across the UK. For each closing pub, it calculates the distance to the next nearest non-Whitbread pub — highlighting communities that will be left furthest from their local.

**[View the live map](https://ryanbateman.github.io/pub_space/)**

## How It Works

1. **Source data** (`whitbread_pubs.geojson`) contains 198 Whitbread pub locations scheduled for closure.
2. **Preprocessing** (`calculate_distances.py`) queries the [Overpass API](https://overpass-api.de/) to find all pubs within 50km of each closing pub, filters out other Whitbread pubs (by proximity), and records the nearest remaining pub with its name, coordinates, and distance.
3. **Frontend** (`index.html`) renders the results on a Leaflet.js map with:
   - Colour-coded markers (blue = close replacement, red = distant replacement)
   - A distance-weighted heatmap showing where the impact is worst
   - Click a pub to see details in the sidebar, with a line drawn to its nearest replacement
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

The script is incremental — if interrupted, re-running it will skip already-processed pubs and resume where it left off. To force a full re-run (e.g. after changing filters), delete `pubs_with_distances.geojson` first.

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
| Heatmap | heatmap.js + leaflet-heatmap plugin |
| Typography | Roboto (Google Fonts) |
| Hosting | GitHub Pages (auto-deploy via Actions) |

## Project Structure

```
├── index.html                  # Map entry point
├── css/style.css               # Styles
├── js/app.js                   # Map rendering logic
├── calculate_distances.py      # Preprocessing script
├── whitbread_pubs.geojson      # Source: 198 Whitbread pub locations
└── pubs_with_distances.geojson # Generated: pubs enriched with nearest-pub data
```

## Heatmap Calculation

The heatmap visualises how far each closing pub is from its nearest replacement. It uses [heatmap.js](https://www.patrick-wied.at/static/heatmapjs/) with per-point intensity values derived from the distance data. The rendering pipeline works as follows:

1. **Filter** — Pubs with a replacement distance below the **Min Distance** threshold are excluded entirely from the heatmap.
2. **Normalise** — Remaining distances are normalised to a 0–1 range between Min Distance and the maximum distance in the filtered dataset.
3. **Power curve** — The normalised value is raised to the power set by the **Intensity Curve** slider. A value of 1 gives a linear mapping; higher values suppress low-distance pubs and emphasise the most distant ones.
4. **Render** — Each point is drawn with pixel size set by **Radius**, edge softness by **Blur**, and peak visibility by **Max Opacity**. The colour gradient runs from blue (low intensity) through yellow to red (high intensity).

All parameters are adjustable via the Heatmap Settings panel in the sidebar:

| Slider | Default | Effect |
|--------|---------|--------|
| Min Distance | 0.5 km | Excludes pubs closer than this from the heatmap |
| Intensity Curve | 1.0 | Power exponent applied to normalised distance (1 = linear) |
| Radius | 30 px | Pixel radius of each heat point |
| Blur | 21 px | Edge softness of each heat point |
| Max Opacity | 0.5 | Maximum opacity of the hottest points |

## Known Issues

**Self-matching pubs**: Some results may show the closing pub's nearest replacement as itself (or a near-zero distance). This happens when the pub exists in OpenStreetMap with slightly different coordinates or name than the source data. Mitigations applied:

- Proximity filter: any OSM pub within 150m of a Whitbread pub is excluded
- Name matching: any OSM pub whose name fuzzy-matches (>70% similarity) the queried pub is excluded

If you spot remaining self-matches, re-running the preprocessing script with the updated filters will correct them.

## Credits

Made by **Ryan B**, with the assistance of **Claude Opus 4.6** (Anthropic) and **MinMax 2.7** using OpenCode.

## License

MIT
