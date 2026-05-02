import json
import sys
import time
import subprocess
from math import radians, cos, sin, asin, sqrt
from pathlib import Path

WHITBREAD_PUBS_FILE = Path(__file__).parent / "whitbread_pubs.geojson"
OUTPUT_FILE = Path(__file__).parent / "pubs_with_distances.geojson"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SEARCH_RADIUS_KM = 50
SAME_PUB_TOLERANCE_M = 50
MAX_PUBS_TO_PROCESS = 200


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return R * 2 * asin(sqrt(a))


def load_whitbread_pubs():
    with open(WHITBREAD_PUBS_FILE) as f:
        data = json.load(f)
    pubs = {}
    for feat in data["features"]:
        props = feat["properties"]
        pid = props["id"]
        lat = float(props["latitude"])
        lon = float(props["longitude"])
        pubs[pid] = {"lat": lat, "lon": lon, "title": props["title"]}
    return pubs


def load_existing_progress():
    """Load already-processed results from the output file if it exists.
    Only counts entries with non-null results as processed."""
    if not OUTPUT_FILE.exists():
        return {}
    try:
        with open(OUTPUT_FILE) as f:
            data = json.load(f)
        processed = {}
        for feat in data["features"]:
            props = feat["properties"]
            if "nearest_external_pub" in props and props["nearest_external_pub"] is not None:
                processed[props["id"]] = props["nearest_external_pub"]
        return processed
    except (json.JSONDecodeError, KeyError):
        return {}


def save_progress(geojson):
    """Save current progress to the output file."""
    with open(OUTPUT_FILE, "w") as f:
        json.dump(geojson, f)


def query_external_pubs(lat, lon, max_retries=3):
    radius = SEARCH_RADIUS_KM * 1000
    query = f"[out:json][timeout:60];(node[\"amenity\"=\"pub\"](around:{radius},{lat},{lon});way[\"amenity\"=\"pub\"](around:{radius},{lat},{lon});relation[\"amenity\"=\"pub\"](around:{radius},{lat},{lon}););out body center;"

    for attempt in range(max_retries):
        try:
            result = subprocess.run([
                'curl', '-s', '-X', 'POST', OVERPASS_URL,
                '-d', f'data={query}',
                '-H', 'Content-Type: application/x-www-form-urlencoded'
            ], capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                print(f"\n  curl error for {lat},{lon} (attempt {attempt + 1}/{max_retries})")
                time.sleep(5 * (attempt + 1))
                continue
            if not result.stdout.strip():
                print(f"\n  Empty response for {lat},{lon} (attempt {attempt + 1}/{max_retries}), retrying...")
                time.sleep(5 * (attempt + 1))
                continue
            data = json.loads(result.stdout)
            if "remark" in data and "rate" in data.get("remark", "").lower():
                print(f"\n  Rate limited (attempt {attempt + 1}/{max_retries}), backing off...")
                time.sleep(15 * (attempt + 1))
                continue
            return data.get("elements", [])
        except json.JSONDecodeError:
            print(f"\n  Invalid JSON response for {lat},{lon} (attempt {attempt + 1}/{max_retries}), retrying...")
            time.sleep(5 * (attempt + 1))
            continue
        except Exception as e:
            print(f"\n  Error querying {lat},{lon}: {e} (attempt {attempt + 1}/{max_retries})")
            time.sleep(5 * (attempt + 1))
            continue

    print(f"\n  Failed after {max_retries} attempts for {lat},{lon}")
    return None


def is_whitbread_pub(ext_lat, ext_lon, whitbread_pubs):
    for wb_pub in whitbread_pubs.values():
        dist = haversine(ext_lat, ext_lon, wb_pub["lat"], wb_pub["lon"])
        if dist <= SAME_PUB_TOLERANCE_M:
            return True
    return False


QUERY_FAILED = "__QUERY_FAILED__"


def find_nearest_external_pub(lat, lon, whitbread_pubs):
    elements = query_external_pubs(lat, lon)
    if elements is None:
        return QUERY_FAILED
    if not elements:
        return None

    candidates = []
    for elem in elements:
        ext_lat = elem.get("lat") or elem.get("center", {}).get("lat")
        ext_lon = elem.get("lon") or elem.get("center", {}).get("lon")
        if not ext_lat or not ext_lon:
            continue
        if is_whitbread_pub(ext_lat, ext_lon, whitbread_pubs):
            continue
        dist = haversine(lat, lon, ext_lat, ext_lon)
        name = elem.get("tags", {}).get("name", "Unnamed Pub")
        candidates.append({
            "name": name,
            "lat": ext_lat,
            "lon": ext_lon,
            "distance_km": round(dist / 1000, 3)
        })

    if not candidates:
        return None

    candidates.sort(key=lambda x: x["distance_km"])
    return candidates[0]


def main():
    print("Loading whitbread pubs...")
    whitbread_pubs = load_whitbread_pubs()
    print(f"Loaded {len(whitbread_pubs)} whitbread pubs")

    print("Loading existing progress...")
    already_processed = load_existing_progress()
    print(f"Already processed: {len(already_processed)} pubs")

    with open(WHITBREAD_PUBS_FILE) as f:
        geojson = json.load(f)

    # Apply any previously computed results to the fresh geojson
    for feat in geojson["features"]:
        props = feat["properties"]
        pid = props["id"]
        if pid in already_processed:
            props["nearest_external_pub"] = already_processed[pid]

    total = len(geojson["features"])
    remaining = total - len(already_processed)
    done = 0
    skipped = 0
    start_time = time.time()

    print(f"Remaining to process: {remaining}/{total}")
    print()

    for feat in geojson["features"]:
        props = feat["properties"]
        pid = props["id"]
        lat = float(props["latitude"])
        lon = float(props["longitude"])

        if pid not in whitbread_pubs:
            continue

        # Skip already-processed pubs
        if pid in already_processed:
            skipped += 1
            done += 1
            continue

        nearest = find_nearest_external_pub(lat, lon, whitbread_pubs)

        # If query failed after retries, skip this pub (will retry next run)
        if nearest == QUERY_FAILED:
            result_str = "-> FAILED (will retry next run)"
            sys.stdout.write(f"\033[2K\r  [!] {props.get('title', pid)} {result_str}")
            sys.stdout.flush()
            print()
            time.sleep(2)
            continue

        props["nearest_external_pub"] = nearest

        done += 1
        newly_processed = done - skipped

        # Progress bar
        elapsed = time.time() - start_time
        avg_time = elapsed / newly_processed if newly_processed else 0
        eta_secs = avg_time * (remaining - newly_processed)
        eta_min = int(eta_secs // 60)
        eta_sec = int(eta_secs % 60)

        bar_width = 30
        pct = newly_processed / remaining if remaining else 1
        filled = int(bar_width * pct)
        bar = "█" * filled + "░" * (bar_width - filled)

        result_str = f"-> {nearest['name']} ({nearest['distance_km']}km)" if nearest else "-> No external pub found"
        status_line = f"\r  [{bar}] {newly_processed}/{remaining} | ETA: {eta_min:02d}:{eta_sec:02d} | {props.get('title', pid)} {result_str}"
        sys.stdout.write(f"\033[2K{status_line}")
        sys.stdout.flush()

        # Save progress after each pub so we can resume
        if newly_processed % 5 == 0:
            save_progress(geojson)

        if done >= MAX_PUBS_TO_PROCESS:
            print(f"\nReached limit of {MAX_PUBS_TO_PROCESS} pubs, stopping early for testing")
            break

        time.sleep(1)

    elapsed_total = time.time() - start_time
    elapsed_min = int(elapsed_total // 60)
    elapsed_sec = int(elapsed_total % 60)
    print(f"\n\nCompleted: {done}/{total} (skipped {skipped} already processed)")
    print(f"Time elapsed: {elapsed_min:02d}:{elapsed_sec:02d}")
    print(f"Writing final output to {OUTPUT_FILE}...")
    save_progress(geojson)
    print("Done!")


if __name__ == "__main__":
    main()
