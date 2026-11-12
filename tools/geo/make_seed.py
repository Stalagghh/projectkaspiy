"""Build the seed GeoJSON files for the Agrakhan demo from OpenStreetMap data.

Run from this directory:

    uv run python make_seed.py

Raw OpenStreetMap responses are cached in tools/geo/.cache/ (ignored by git).
Delete that directory to download fresh data. All outputs are GeoJSON in
WGS84 (lon/lat) and are written to packages/db/seed/.

Data: (c) OpenStreetMap contributors, ODbL 1.0. Zones and device positions
are illustrative (demo only), they are not official boundaries.
"""

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import shapely
from pyproj import Geod, Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, polygonize, transform, unary_union

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / ".cache"
OUT_DIR = HERE.parent.parent / "packages" / "db" / "seed"

USER_AGENT = "hackathon-gis/0.1"
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
OSM_API = "https://api.openstreetmap.org/api/0.6"
ODBL = "© OpenStreetMap contributors, ODbL 1.0"

# Operational box: min lon, min lat, max lon, max lat.
OPS_BOX = (47.35, 43.45, 48.05, 44.20)
# The coastline is downloaded for a slightly larger box (Overpass order: S, W, N, E).
COASTLINE_QUERY = '[out:json][timeout:120];way["natural"="coastline"](43.3,47.2,44.4,48.2);out geom;'
# Points that are certainly open sea (lon, lat): polygon faces that contain them are sea.
SEA_SEED_POINTS = [(47.95, 44.05), (47.95, 43.60)]

BOUNDARY_WAY = 505346049
CHECHEN_WAY = 5227556
YAICHNY_RELATION = 14553380

QUIET_ZONE_M = 5000.0
BUFFER_ZONE_M = 9000.0
HEX_EDGE_M = 1500.0
DECIMALS = 6

UTM_38N = "EPSG:32638"
_to_utm = Transformer.from_crs("EPSG:4326", UTM_38N, always_xy=True).transform
_to_wgs = Transformer.from_crs(UTM_38N, "EPSG:4326", always_xy=True).transform
GEOD = Geod(ellps="WGS84")

checks: list[str] = []


def check(condition: bool, message: str) -> None:
    """Stop with an error if a condition fails, otherwise remember it for the summary."""
    if not condition:
        raise AssertionError(message)
    checks.append(message)


def to_utm(geom):
    return transform(_to_utm, geom)


def to_wgs(geom):
    return transform(_to_wgs, geom)


# ---------------------------------------------------------------- download --


def http_json(url: str, query: str | None = None) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode() if query else None
    request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def overpass(query: str) -> dict:
    """Try each public Overpass server in turn (they are often busy)."""
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            print(f"Overpass request: {endpoint}")
            data = http_json(endpoint, query)
            if data.get("elements"):
                return data
            print("  empty answer, trying the next server")
        except Exception as error:
            print(f"  failed: {error}")
    raise RuntimeError("all Overpass servers failed, try again later")


def cached(name: str, fetch) -> dict:
    path = CACHE_DIR / name
    if not path.exists():
        CACHE_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps(fetch(), ensure_ascii=False), encoding="utf-8")
    return json.loads(path.read_text(encoding="utf-8"))


def osm_full(kind: str, osm_id: int) -> dict:
    """One OSM element with all its nodes, from the main OSM API."""
    return cached(f"{kind}-{osm_id}.json", lambda: http_json(f"{OSM_API}/{kind}/{osm_id}/full.json"))


# ------------------------------------------------------------- OSM parsing --


def osm_lines(data: dict) -> dict[int, LineString]:
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in data["elements"] if e["type"] == "node"}
    return {
        e["id"]: LineString([nodes[n] for n in e["nodes"]])
        for e in data["elements"]
        if e["type"] == "way"
    }


def osm_tags(data: dict, kind: str, osm_id: int) -> dict:
    return next(e for e in data["elements"] if e["type"] == kind and e["id"] == osm_id)["tags"]


def polygon_from_way(data: dict, way_id: int) -> Polygon:
    line = osm_lines(data)[way_id]
    check(line.is_ring, f"way/{way_id} is a closed ring")
    return Polygon(line.coords)


def polygon_from_relation(data: dict, relation_id: int):
    relation = next(e for e in data["elements"] if e["type"] == "relation" and e["id"] == relation_id)
    lines = osm_lines(data)
    outer = [lines[m["ref"]] for m in relation["members"] if m["type"] == "way" and m["role"] == "outer"]
    inner = [lines[m["ref"]] for m in relation["members"] if m["type"] == "way" and m["role"] == "inner"]
    outer_area = unary_union(list(polygonize(linemerge(outer))))
    if inner:
        outer_area = outer_area.difference(unary_union(list(polygonize(linemerge(inner)))))
    check(not outer_area.is_empty, f"relation/{relation_id} builds a polygon")
    return outer_area


def coastline_lines() -> list[LineString]:
    data = cached("coastline.json", lambda: overpass(COASTLINE_QUERY))
    return [
        LineString([(p["lon"], p["lat"]) for p in e["geometry"]])
        for e in data["elements"]
        if e["type"] == "way"
    ]


# ---------------------------------------------------------------- geometry --


def inside_point(polygon) -> Point:
    """Centroid when it lies inside the polygon, otherwise a point on its surface."""
    centroid = polygon.centroid
    return centroid if polygon.contains(centroid) else polygon.representative_point()


def largest_polygon(geom) -> Polygon:
    parts = [g for g in getattr(geom, "geoms", [geom]) if g.geom_type == "Polygon" and not g.is_empty]
    if not parts:
        raise ValueError("no polygon left after clipping")
    return max(parts, key=lambda g: g.area)


def build_sea(coast: list[LineString]):
    """Sea part of the operational box.

    The coastline lines and the box outline are cut at every crossing and
    turned into faces. Faces that contain a known open-sea point are sea;
    every other face (mainland, islands) is land and is removed.
    """
    ops_box = box(*OPS_BOX)
    faces = [f for f in polygonize(unary_union(coast + [ops_box.exterior])) if ops_box.contains(f.representative_point())]
    seeds = [Point(p) for p in SEA_SEED_POINTS]
    sea_faces = [f for f in faces if any(f.contains(s) for s in seeds)]
    land_faces = [f for f in faces if not any(f.contains(s) for s in seeds)]
    print(f"Faces in the box: {len(faces)} ({len(sea_faces)} sea, {len(land_faces)} land or island)")
    sea = unary_union(sea_faces).difference(unary_union(land_faces)).intersection(ops_box)
    return sea, land_faces


def west_coast_on_parallel(sea, lat: float) -> float:
    """Longitude where the sea starts on a parallel (going from west to east)."""
    line = LineString([(OPS_BOX[0], lat), (OPS_BOX[2], lat)])
    part = sea.intersection(line)
    return min(x for g in getattr(part, "geoms", [part]) for x, _ in g.coords)


def east_shore_on_parallel(sea, lat: float) -> float:
    """Longitude of the shore that faces the open sea on a parallel.

    The open sea is the sea segment that reaches farthest east; its west end
    is the shore (Agrakhan Bay, west of the peninsula, is skipped).
    """
    line = LineString([(OPS_BOX[0], lat), (OPS_BOX[2], lat)])
    part = sea.intersection(line)
    open_sea = max(getattr(part, "geoms", [part]), key=lambda g: max(x for x, _ in g.coords))
    return min(x for x, _ in open_sea.coords)


def moved(point_utm: Point, azimuth_deg: float, distance_m: float) -> Point:
    a = math.radians(azimuth_deg)
    return Point(point_utm.x + math.sin(a) * distance_m, point_utm.y + math.cos(a) * distance_m)


def exit_distance(shape_utm, start: Point, azimuth_deg: float) -> float:
    """Distance from start to the last crossing of the shape outline along an azimuth."""
    ray = LineString([start.coords[0], moved(start, azimuth_deg, 100_000).coords[0]])
    hit = ray.intersection(shape_utm.boundary)
    return max(ray.project(Point(xy)) for g in getattr(hit, "geoms", [hit]) for xy in g.coords)


def first_point(candidates, accept, what: str) -> Point:
    for point in candidates:
        if accept(point):
            return point
    raise RuntimeError(f"no position found for {what}")


def hexagon(cx: float, cy: float, edge: float) -> Polygon:
    """Pointy-top hexagon around (cx, cy)."""
    return Polygon(
        [(cx + edge * math.cos(math.radians(60 * i + 30)), cy + edge * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    )


def hex_grid(area_utm, edge: float) -> list[Polygon]:
    """Hexagons whose centre lies inside the area, rows from south to north."""
    shapely.prepare(area_utm)
    minx, miny, maxx, maxy = area_utm.bounds
    step_x, step_y = math.sqrt(3) * edge, 1.5 * edge
    cells = []
    row = 0
    y = miny
    while y <= maxy + step_y:
        x = minx - step_x + (step_x / 2 if row % 2 else 0.0)
        while x <= maxx + step_x:
            if area_utm.contains(Point(x, y)):
                cells.append(hexagon(x, y, edge))
            x += step_x
        y += step_y
        row += 1
    return cells


# ------------------------------------------------------------------ output --


def rounded(value):
    if isinstance(value, (list, tuple)):
        if value and isinstance(value[0], (int, float)):
            return [round(float(v), DECIMALS) for v in value]
        return [rounded(v) for v in value]
    return value


def geojson_geometry(geom) -> dict:
    """GeoJSON geometry with 6 decimals; fails if the result is not valid."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        kind = geom.geom_type
        geom = shapely.orient_polygons(shapely.set_precision(geom, 10**-DECIMALS))
        if kind == "MultiPolygon" and geom.geom_type == "Polygon":
            geom = MultiPolygon([geom])
    plain = mapping(geom)
    result = {"type": plain["type"], "coordinates": rounded(plain["coordinates"])}
    parsed = shape(result)
    if not parsed.is_valid or parsed.is_empty:
        raise ValueError(f"invalid {result['type']}: {shapely.is_valid_reason(parsed)}")
    return result


def feature(geom, properties: dict) -> dict:
    return {"type": "Feature", "properties": properties, "geometry": geojson_geometry(geom)}


def write_collection(name: str, features: list[dict]) -> list:
    """Write one feature per line and return the geometries read back from the file."""
    body = ",\n".join(json.dumps(f, ensure_ascii=False, separators=(",", ":")) for f in features)
    path = OUT_DIR / name
    path.write_text('{"type":"FeatureCollection","features":[\n' + body + "\n]}\n", encoding="utf-8")
    written = json.loads(path.read_text(encoding="utf-8"))
    geometries = [shape(f["geometry"]) for f in written["features"]]
    check(all(g.is_valid for g in geometries), f"{name}: {len(geometries)} valid geometries")
    return geometries


# -------------------------------------------------------------------- main --


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Sanctuary boundary.
    boundary_data = osm_full("way", BOUNDARY_WAY)
    check(osm_tags(boundary_data, "way", BOUNDARY_WAY).get("boundary") == "protected_area", "way/505346049 is a protected area")
    boundary = polygon_from_way(boundary_data, BOUNDARY_WAY)
    write_collection(
        "agrakhan-boundary.geojson",
        [
            feature(
                MultiPolygon([boundary]),
                {
                    "id": "agrakhan",
                    "name_ru": "Аграханский заказник",
                    "name_en": "Agrakhan Federal Sanctuary",
                    "source": f"osm:way/{BOUNDARY_WAY}",
                    "attribution": ODBL,
                },
            )
        ],
    )

    # 2. Sea part of the operational box.
    coast = coastline_lines()
    sea, land_faces = build_sea(coast)
    sea = sea if sea.geom_type == "MultiPolygon" else MultiPolygon([sea])
    [sea_written] = write_collection(
        "ops-area.geojson",
        [
            feature(
                sea,
                {
                    "id": "agrakhan-ops",
                    "illustrative": True,
                    "source": "derived from OSM natural=coastline (ODbL 1.0)",
                    "name_ru": "Операционная морская зона (иллюстративно)",
                },
            )
        ],
    )
    sea = sea_written  # use the rounded geometry from now on, so later checks match the file
    sea_utm = to_utm(sea)
    coast_utm = to_utm(unary_union(coast))
    sea_area_km2 = abs(GEOD.geometry_area_perimeter(sea)[0]) / 1e6

    # Checks "by numbers": on each parallel the sea starts at the coastline and
    # 500 m further west there is land (peninsula or mainland), not sea.
    print("Where the sea starts on each parallel (lon):")
    for lat in (43.50, 43.60, 43.70, 43.80):
        lon = west_coast_on_parallel(sea, lat)
        start_utm = to_utm(Point(lon, lat))
        print(f"  lat {lat:.2f}: lon {lon:.4f}, distance to coastline {start_utm.distance(coast_utm):.1f} m")
        check(start_utm.distance(coast_utm) < 1.0, f"sea starts at the coastline on lat {lat:.2f}")
        check(not sea_utm.contains(moved(start_utm, 270, 500)), f"500 m west of the coast on lat {lat:.2f} is land")
    check(all(not sea.contains(f.representative_point()) for f in land_faces), "land and island faces are not sea")

    # 3. Candidate haul-out islands.
    chechen_data = osm_full("way", CHECHEN_WAY)
    yaichny_data = osm_full("relation", YAICHNY_RELATION)
    chechen = polygon_from_way(chechen_data, CHECHEN_WAY)
    yaichny = polygon_from_relation(yaichny_data, YAICHNY_RELATION)
    check(osm_tags(chechen_data, "way", CHECHEN_WAY).get("place") == "island", "way/5227556 is an island")
    check(osm_tags(yaichny_data, "relation", YAICHNY_RELATION).get("place") == "island", "relation/14553380 is an island")
    haulouts = [
        (inside_point(chechen), {"id": "chechen", "name_ru": "о. Чечень", "name_en": "Chechen Island", "osm_ref": f"way/{CHECHEN_WAY}", "candidate": True}),
        (inside_point(yaichny), {"id": "yaichny", "name_ru": "о. Яичный", "name_en": "Yaichny Island", "osm_ref": f"relation/{YAICHNY_RELATION}", "candidate": True}),
    ]
    haulout_points = write_collection("haulouts.geojson", [feature(p, props) for p, props in haulouts])
    check(chechen.contains(haulout_points[0]) and yaichny.contains(haulout_points[1]), "haul-out points lie on their islands")
    haulouts_utm = [to_utm(p) for p in haulout_points]

    # 4. Illustrative zones around Chechen island. The island land is the OSM
    # island polygon plus the coastline ring around it (the two differ a bit).
    # The mainland face also touches the island polygon; it is far larger and skipped.
    island_rings = [f for f in land_faces if f.intersects(chechen) and f.area < chechen.area * 5]
    check(len(island_rings) == 1, "Chechen island has one coastline ring")
    island_utm = to_utm(unary_union([chechen] + island_rings))
    quiet_utm = largest_polygon(island_utm.buffer(QUIET_ZONE_M).intersection(sea_utm).difference(island_utm))
    ring_utm = island_utm.buffer(BUFFER_ZONE_M).difference(island_utm.buffer(QUIET_ZONE_M))
    buffer_utm = largest_polygon(ring_utm.intersection(sea_utm))
    quiet, buffer_zone = write_collection(
        "zones.geojson",
        [
            feature(
                to_wgs(quiet_utm),
                {
                    "id": "zone-chechen-quiet",
                    "kind": "no_entry",
                    "name_ru": "Зона покоя у о. Чечень (демо)",
                    "name_en": "Quiet zone near Chechen Island (demo)",
                    "illustrative": True,
                },
            ),
            feature(
                to_wgs(buffer_utm),
                {
                    "id": "zone-chechen-buffer",
                    "kind": "buffer",
                    "name_ru": "Буферная зона (демо)",
                    "name_en": "Buffer zone (demo)",
                    "illustrative": True,
                },
            ),
        ],
    )
    quiet_utm, buffer_utm = to_utm(quiet), to_utm(buffer_zone)
    zones_utm = unary_union([quiet_utm, buffer_utm])

    # 5. Simulated devices.
    centre = to_utm(haulout_points[0])  # Chechen haul-out point

    def buoy_in_quiet_zone(azimuths):
        candidates = (
            moved(centre, az, exit_distance(island_utm, centre, az) + offset)
            for az in azimuths
            for offset in (2000, 1500, 2500, 1000, 3000)
        )
        # 200 m margin so that the buoy stays inside after rounding.
        return first_point(candidates, lambda p: quiet_utm.buffer(-200).contains(p), "buoy in the quiet zone")

    buoy_01 = buoy_in_quiet_zone([45, 35, 55, 25, 65])
    buoy_02 = buoy_in_quiet_zone([225, 215, 235, 205, 245, 195, 255])
    buoy_03 = first_point(
        (moved(centre, az, exit_distance(island_utm, centre, az) + d) for az in (0, 10, 350, 20, 340) for d in (12000, 14000, 10000)),
        lambda p: sea_utm.buffer(-200).contains(p) and p.distance(zones_utm) > 500,
        "buoy 03",
    )

    def near_coast(candidates, what):
        return first_point(
            candidates,
            lambda p: sea_utm.buffer(-50).contains(p) and 700 <= p.distance(coast_utm) <= 1300,
            what,
        )

    def east_of_coast(lat):
        start = to_utm(Point(east_shore_on_parallel(sea, lat), lat))
        return near_coast((moved(start, 90, d) for d in range(500, 3001, 50)), f"water station at lat {lat}")

    # wq-02: east shore of the peninsula about 3 km south of its northern tip,
    # which almost touches Chechen island (the strait there is too narrow).
    wq_01 = east_of_coast(43.75)
    wq_02 = east_of_coast(43.90)
    wq_03 = east_of_coast(43.52)

    devices = [
        (buoy_01, {"id": "buoy-01", "kind": "acoustic_buoy", "name_ru": "Акустический буй 01", "simulated": True}),
        (buoy_02, {"id": "buoy-02", "kind": "acoustic_buoy", "name_ru": "Акустический буй 02", "simulated": True}),
        (buoy_03, {"id": "buoy-03", "kind": "acoustic_buoy", "name_ru": "Акустический буй 03", "simulated": True}),
        (wq_01, {"id": "wq-01", "kind": "water_station", "name_ru": "Станция воды 01", "simulated": True}),
        (wq_02, {"id": "wq-02", "kind": "water_station", "name_ru": "Станция воды 02", "simulated": True}),
        (wq_03, {"id": "wq-03", "kind": "water_station", "name_ru": "Станция воды 03", "simulated": True}),
    ]
    device_points = write_collection("devices.geojson", [feature(to_wgs(p), props) for p, props in devices])
    by_id = dict(zip([props["id"] for _, props in devices], device_points))
    check(all(sea.contains(p) for p in device_points), "all devices are at sea")
    check(quiet.contains(by_id["buoy-01"]), "buoy-01 is inside zone-chechen-quiet")
    check(quiet.contains(by_id["buoy-02"]), "buoy-02 is inside zone-chechen-quiet (no_entry)")
    check(by_id["buoy-01"].x > haulout_points[0].x and by_id["buoy-01"].y > haulout_points[0].y, "buoy-01 is north-east of the island")
    check(by_id["buoy-02"].x < haulout_points[0].x and by_id["buoy-02"].y < haulout_points[0].y, "buoy-02 is south-west of the island")
    check(not quiet.contains(by_id["buoy-03"]) and not buffer_zone.contains(by_id["buoy-03"]), "buoy-03 is outside both zones")
    check(by_id["buoy-03"].y > haulout_points[0].y, "buoy-03 is north of the island")
    for name in ("wq-01", "wq-02", "wq-03"):
        km = to_utm(by_id[name]).distance(coast_utm) / 1000
        check(0.5 <= km <= 1.5, f"{name} is {km:.2f} km from the coastline")

    # 6. Forecast cells: hexagons over the sea, built in UTM 38N.
    edge = HEX_EDGE_M
    cells = hex_grid(sea_utm, edge)
    if len(cells) > 2000:
        edge = 2000.0
        cells = hex_grid(sea_utm, edge)
    cell_features = []
    for number, cell in enumerate(cells, start=1):
        centre_cell = cell.centroid
        cell_features.append(
            feature(
                to_wgs(cell),
                {
                    "id": number,
                    "dist_haulout_km": round(min(centre_cell.distance(h) for h in haulouts_utm) / 1000, 2),
                    "dist_coast_km": round(centre_cell.distance(coast_utm) / 1000, 2),
                },
            )
        )
    write_collection("forecast-cells.geojson", cell_features)

    # Summary.
    print()
    print(f"Sea polygon area: {sea_area_km2:.1f} km2 (geodesic, WGS84)")
    print(f"Forecast cells: {len(cells)} hexagons, edge {edge / 1000:.1f} km")
    print("Devices (lon, lat):")
    for (_, props), point in zip(devices, device_points):
        print(f"  {props['id']}: {point.x:.6f}, {point.y:.6f}")
    print("Haul-outs (lon, lat):")
    for (_, props), point in zip(haulouts, haulout_points):
        print(f"  {props['id']}: {point.x:.6f}, {point.y:.6f}")
    print("Checks passed:")
    for message in checks:
        print(f"  ok  {message}")


if __name__ == "__main__":
    main()
