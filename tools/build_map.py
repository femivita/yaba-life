"""Turn the raw Overture extract (data/raw/*.parquet) into the compact city file
the game streams: public/data/yaba.bin (geometry) + public/data/yaba.json (index,
names, landmarks).

Coordinates are local metres around ORIGIN: +x = east, +z = south (three.js
convention: -z is north), stored as int16 decimetres in the .bin.

Usage: python3 tools/build_map.py [--research /mnt/project-files/research/yaba-places.json]
"""
import argparse
import difflib
import hashlib
import json
import math
import os
import re
import struct

import numpy as np
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data")

ORIGIN = (6.5097, 3.3800)  # lat, lon: Yaba / Herbert Macaulay Way area
BBOX = (3.360, 6.493, 3.405, 6.528)
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN[0]))


def to_local(lon, lat):
    return (lon - ORIGIN[1]) * M_PER_DEG_LON, -(lat - ORIGIN[0]) * M_PER_DEG_LAT


def local_geom(g):
    import shapely
    return shapely.transform(g, lambda c: np.column_stack(to_local(c[:, 0], c[:, 1])))


CLIP = None


def h32(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


def name_of(row):
    n = row.get("names")
    return (n or {}).get("primary") if n else None


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        out = []
        for x in g.geoms:
            out += polys(x)
        return out
    return []


def lines(g):
    if g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if hasattr(g, "geoms"):
        out = []
        for x in g.geoms:
            out += lines(x)
        return out
    return []


class Bin:
    """int16 decimetre streams, each section addressed by (offset, count)."""

    def __init__(self):
        self.parts = []
        self.size = 0

    def add(self, arr, dtype):
        a = np.ascontiguousarray(arr, dtype=dtype)
        b = a.tobytes()
        pad = (-len(b)) % 4
        off = self.size
        self.parts.append(b + b"\0" * pad)
        self.size += len(b) + pad
        return {"offset": off, "length": int(a.size), "type": np.dtype(dtype).name}

    def write(self, path):
        with open(path, "wb") as f:
            for p in self.parts:
                f.write(p)


def dm(v):
    return np.clip(np.round(np.asarray(v) * 10), -32767, 32767).astype(np.int16)


def ring(poly, simplify=0.3):
    p = poly.simplify(simplify, preserve_topology=True) if simplify else poly
    if p.is_empty or not isinstance(p, Polygon):
        return None
    c = np.asarray(p.exterior.coords)[:-1]
    if len(c) < 3:
        return None
    # counter-clockwise in x/z-down space for consistent wall winding
    area = 0.5 * np.sum(c[:, 0] * np.roll(c[:, 1], -1) - np.roll(c[:, 0], -1) * c[:, 1])
    if area < 0:
        c = c[::-1]
    return c


# ---------------------------------------------------------------------------


def building_height(row, area, rid):
    if row.get("height"):
        return float(row["height"])
    if row.get("num_floors"):
        return float(row["num_floors"]) * 3.2 + 0.6
    r = (h32(rid) % 1000) / 1000.0
    # Yaba: lots of bungalows and 2-3 storey "face-me-I-face-you" blocks,
    # bigger footprints are offices, hostels, schools and markets.
    if area < 45:
        floors = 1
    elif area < 120:
        floors = 1 + (r > 0.45) + (r > 0.85)
    elif area < 400:
        floors = 2 + (r > 0.4) + (r > 0.8)
    elif area < 1500:
        floors = 2 + int(r * 4)
    else:
        floors = 2 + int(r * 3)
    return floors * 3.2 + 0.4 + r * 0.6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--research", default="/mnt/project-files/research/yaba-places.json")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    x0, z1 = to_local(BBOX[0], BBOX[1])
    x1, z0 = to_local(BBOX[2], BBOX[3])
    clip = box(x0, z0, x1, z1)
    out = {
        "version": 1,
        "name": "Yaba, Lagos",
        "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1]},
        "bounds": [x0, z0, x1, z1],
        "attribution": "Map data © OpenStreetMap contributors (ODbL), via Overture Maps Foundation. "
                       "Some building footprints © Google Open Buildings (CC BY 4.0) and Microsoft (ODbL).",
    }
    binf = Bin()

    # --- buildings ---------------------------------------------------------
    t = pq.read_table(os.path.join(RAW, "buildings.parquet"),
                      columns=["id", "geometry", "names", "height", "num_floors", "class", "is_underground",
                               "has_parts", "roof_shape"]).to_pylist()
    counts, coords, heights, kinds = [], [], [], []
    named_buildings = []
    for row in t:
        if row.get("is_underground"):
            continue
        g = local_geom(wkb.loads(row["geometry"]))
        if not g.intersects(clip):
            continue
        for p in polys(g.intersection(clip)):
            if p.area < 8:
                continue
            c = ring(p, 0.25)
            if c is None or len(c) > 200:
                continue
            h = building_height(row, p.area, row["id"])
            counts.append(len(c))
            coords.append(c)
            heights.append(h)
            cls = row.get("class") or ""
            kinds.append({"commercial": 1, "retail": 1, "office": 1, "university": 2, "school": 2, "college": 2,
                          "church": 3, "mosque": 3, "religious": 3, "hospital": 4, "industrial": 5,
                          "warehouse": 5}.get(cls, 0))
            nm = name_of(row)
            if nm:
                cx, cz = p.centroid.x, p.centroid.y
                named_buildings.append({"name": nm, "x": round(cx, 1), "z": round(cz, 1), "h": round(h, 1)})
    flat = np.concatenate(coords)
    out["buildings"] = {
        "count": len(counts),
        "counts": binf.add(counts, np.uint16),
        "coords": binf.add(dm(flat).reshape(-1), np.int16),
        "heights": binf.add(np.round(np.asarray(heights) * 10), np.uint16),
        "kinds": binf.add(kinds, np.uint8),
    }
    print("buildings", len(counts), "verts", len(flat))

    # --- roads & rail --------------------------------------------------------
    seg = pq.read_table(os.path.join(RAW, "segments.parquet"),
                        columns=["id", "geometry", "names", "class", "subtype", "road_flags"]).to_pylist()
    road_classes = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified",
                    "service", "living_street", "track", "footway", "path", "pedestrian", "steps", "unknown",
                    "cycleway", "standard_gauge", "rail"]
    rcounts, rcoords, rclass, rname_idx = [], [], [], []
    names = []
    name_index = {}
    spawn_lines = []
    for row in seg:
        g = local_geom(wkb.loads(row["geometry"])).intersection(clip)
        cls = row.get("class") or "unknown"
        if row.get("subtype") == "water":
            continue
        if cls not in road_classes:
            cls = "unknown"
        is_bridge = False
        flags = row.get("road_flags") or []
        for f in flags:
            if "is_bridge" in (f.get("values") or []):
                is_bridge = True
        for ln in lines(g):
            ln = ln.simplify(0.4)
            c = np.asarray(ln.coords)
            if len(c) < 2 or ln.length < 1:
                continue
            nm = name_of(row)
            if nm:
                if nm not in name_index:
                    name_index[nm] = len(names)
                    names.append(nm)
                ni = name_index[nm]
            else:
                ni = 65535
            spawn_lines.append((ln, nm))
            rcounts.append(len(c))
            rcoords.append(c)
            rclass.append(road_classes.index(cls) | (0x80 if is_bridge else 0))
            rname_idx.append(ni)
    out["roads"] = {
        "classes": road_classes,
        "names": names,
        "count": len(rcounts),
        "counts": binf.add(rcounts, np.uint16),
        "coords": binf.add(dm(np.concatenate(rcoords)).reshape(-1), np.int16),
        "class": binf.add(rclass, np.uint8),
        "name": binf.add(rname_idx, np.uint16),
    }
    print("roads", len(rcounts))

    # --- areas: water + land use ------------------------------------------
    area_kinds = ["water", "park", "grass", "pitch", "campus", "school", "hospital", "market", "residential",
                  "industrial", "cemetery", "military", "railway", "sand", "wetland", "stadium"]
    acounts, acoords, akind, holes_meta = [], [], [], []

    def add_area(geom, kind, simplify=0.8):
        for p in polys(geom.intersection(clip)):
            if p.area < 30:
                continue
            p = p.simplify(simplify, preserve_topology=True)
            if not isinstance(p, Polygon) or p.is_empty:
                continue
            # triangulate client side with holes: store exterior then holes, counts negative for holes
            ext = np.asarray(p.exterior.coords)[:-1]
            if len(ext) < 3:
                continue
            acounts.append(len(ext))
            acoords.append(ext)
            akind.append(area_kinds.index(kind))
            hs = [np.asarray(h.coords)[:-1] for h in p.interiors if len(h.coords) > 3]
            holes_meta.append(len(hs))
            for h in hs:
                acounts.append(len(h))
                acoords.append(h)

    water_rows = pq.read_table(os.path.join(RAW, "water.parquet"),
                               columns=["geometry", "subtype", "class", "names"]).to_pylist()
    water_union = []
    for row in water_rows:
        g = local_geom(wkb.loads(row["geometry"]))
        if g.geom_type in ("Polygon", "MultiPolygon"):
            water_union.append(g)
    if water_union:
        add_area(unary_union(water_union), "water", 1.5)
    lu_map = {
        "park": "park", "garden": "park", "recreation_ground": "park", "grass": "grass", "meadow": "grass",
        "village_green": "grass", "pitch": "pitch", "track": "pitch", "playground": "park", "stadium": "stadium",
        "university": "campus", "college": "campus", "school": "school", "education": "school",
        "hospital": "hospital", "clinic": "hospital", "retail": "market", "marketplace": "market",
        "commercial": "market", "residential": "residential", "industrial": "industrial",
        "cemetery": "cemetery", "grave_yard": "cemetery", "military": "military", "railway": "railway",
        "beach": "sand", "sand": "sand", "wetland": "wetland", "farmland": "grass", "brownfield": "sand",
        "forest": "park", "wood": "park", "scrub": "grass",
    }
    order = {k: i for i, k in enumerate(["residential", "industrial", "military", "railway", "campus", "school",
                                         "hospital", "market", "cemetery", "grass", "park", "sand", "wetland",
                                         "stadium", "pitch"])}
    lu_rows = []
    for fname in ["land_use.parquet", "infrastructure.parquet"]:
        for row in pq.read_table(os.path.join(RAW, fname), columns=["geometry", "subtype", "class", "names"]).to_pylist():
            kind = lu_map.get(row.get("class") or "") or lu_map.get(row.get("subtype") or "")
            if not kind:
                continue
            g = local_geom(wkb.loads(row["geometry"]))
            if g.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            lu_rows.append((order.get(kind, 0), kind, g, name_of(row)))
    lu_rows.sort(key=lambda r: r[0])  # draw big/low-priority areas first
    area_names = []
    for _, kind, g, nm in lu_rows:
        add_area(g, kind)
        if nm and kind in ("campus", "school", "hospital", "market", "park", "stadium", "pitch", "military"):
            c = g.representative_point()
            area_names.append({"name": nm, "kind": kind, "x": round(c.x, 1), "z": round(c.y, 1),
                               "area": round(g.area)})
    out["areas"] = {
        "kinds": area_kinds,
        "count": len(akind),
        "kind": binf.add(akind, np.uint8),
        "holes": binf.add(holes_meta, np.uint8),
        "counts": binf.add(acounts, np.uint16),
        "coords": binf.add(dm(np.concatenate(acoords)).reshape(-1), np.int16),
    }
    print("areas", len(akind))

    # --- places (POIs) -------------------------------------------------------
    pl = pq.read_table(os.path.join(RAW, "places.parquet"),
                       columns=["id", "geometry", "names", "basic_category", "confidence"]).to_pylist()
    pois = []
    for row in pl:
        nm = name_of(row)
        if not nm or (row.get("confidence") or 0) < 0.55:
            continue
        g = local_geom(wkb.loads(row["geometry"]))
        if not clip.contains(g):
            continue
        pois.append({"name": nm, "cat": row.get("basic_category") or "", "x": round(g.x, 1), "z": round(g.y, 1)})
    out["pois"] = pois
    print("pois", len(pois))

    # --- landmarks: research places snapped to OSM features by name ----------
    candidates = ([dict(c, src="area") for c in area_names] + [dict(c, src="building") for c in named_buildings]
                  + [dict(c, src="poi") for c in pois])

    def norm(s):
        s = s.lower()
        s = re.sub(r"\(.*?\)", " ", s)
        s = re.sub(r"[^a-z0-9 ]", " ", s)
        s = re.sub(r"\b(the|of|and|ltd|limited|nigeria|lagos|yaba)\b", " ", s)
        return " ".join(s.split())

    def norm_keep(s):
        return " ".join(re.sub(r"[^a-z0-9 ]", " ", s.lower()).split())

    # research id -> exact OpenStreetMap/Overture name, checked by hand.
    # False = known to be missing from the map data; keep the research coordinate.
    ALIASES = {
        "unilag": "University of Lagos", "unilag_lagoon_front": "Unilag Lagoon Front",
        "yabatech": "Yaba College of Technology",
        "fce_akoka": "Federal College of Education (Technical), Akoka",
        "queens_college": "Queens College Yaba", "neuro_psych": "Federal Psychiatric Hospital Yaba",
        "nimr": "Nigerian Institute of Medical Research", "yaba_market": "Yaba Market",
        "tejuosho_market": "Tejuosho Shopping Centre", "ecentre": "E - Centre",
        "railway_mini_market": "Yaba Market (railway)", "yaba_rail": "Yaba Railway Station",
        "ojuelegba": "Ojuelegba", "third_mainland_ramp": "Third Mainland Bridge",
        "cchub": "Co-creation HUB Limited", "banilux_bar": "Banilux Bar", "silver_cafe": "Silver Cafe",
        "unilag_guest_house": "Unilag Guest House", "domino": False, "fce_yaba": False, "the_place": False,
        "efex_hotel": False, "city_grill": False, "sabo_market": False, "sabo_roundabout": False,
        "jibowu_parks": False, "makoko": False, "unilag_gate": False,
    }
    GENERIC = {"market", "restaurant", "hotel", "bar", "bars", "lounge", "club", "station", "hospital", "college",
               "junction", "mall", "office", "terminal", "bus", "park", "parks", "road", "street", "st", "line",
               "red", "blue", "cafe", "grill", "grills", "spot", "house", "centre", "center", "university",
               "federal", "front", "gate", "main", "ultra", "modern", "mini", "interstate", "roundabout", "on",
               "ramp", "waterfront", "strip", "wine", "bbq", "guest", "school", "hub", "limited"}
    landmarks = []
    districts = []
    if os.path.exists(args.research):
        research = json.load(open(args.research))
        for d in research.get("districts", []):
            districts.append({k: d[k] for k in d if k in ("id", "name", "feel")} |
                             ({"x": round(to_local(d["lon"], d["lat"])[0], 1),
                               "z": round(to_local(d["lon"], d["lat"])[1], 1)} if "lat" in d else {}))
        for p in research["places"]:
            rx, rz = to_local(p["lon"], p["lat"])
            names_to_try = [p["name"]] + p.get("aliases", [])
            m = re.search(r"\((.*?)\)", p["name"])
            if m:
                names_to_try.append(m.group(1))
            best, best_score = None, 0.0
            alias = ALIASES.get(p["id"])
            if alias:
                pri = {"area": 0, "building": 1, "poi": 2}
                hits = [c for c in candidates if c["name"] == alias]
                if hits:
                    best = min(hits, key=lambda c: (pri[c["src"]], math.hypot(c["x"] - rx, c["z"] - rz)))
                    best_score = 1.0
            elif alias is None:
                q = norm_keep(p["name"])
                for c in candidates:
                    dist = math.hypot(c["x"] - rx, c["z"] - rz)
                    if dist > 800:
                        continue
                    sc = difflib.SequenceMatcher(None, q, norm_keep(c["name"])).ratio()
                    if sc >= 0.88 and sc > best_score:
                        best, best_score = c, sc
            entry = {
                "id": p["id"], "name": p["name"], "type": p["type"], "district": p.get("district"),
                "hooks": p.get("gameplay_hooks", []), "hours": p.get("hours"),
            }
            if best:
                entry.update(x=best["x"], z=best["z"], snapped=best["name"], snap_src=best["src"],
                             score=round(best_score, 2))
            else:
                entry.update(x=round(rx, 1), z=round(rz, 1), snapped=None)
            if clip.contains(Polygon([(entry["x"] - .1, entry["z"] - .1), (entry["x"] + .1, entry["z"] - .1),
                                      (entry["x"], entry["z"] + .1)])):
                landmarks.append(entry)
    out["landmarks"] = landmarks
    out["districts"] = districts
    out["areaNames"] = area_names
    print("landmarks", len(landmarks), "snapped", sum(1 for l in landmarks if l["snapped"]))

    # --- spawn: Yaba bus stop area on Herbert Macaulay Way -------------------
    sx, sz = to_local(3.3782, 6.5087)
    # snap onto the pavement edge of Herbert Macaulay Way
    from shapely.geometry import Point
    hm = [ln for ln, nm in spawn_lines if nm == "Herbert Macaulay Way"]
    if hm:
        u = unary_union(hm)
        pt = u.interpolate(u.project(Point(sx, sz)))
        sx, sz = pt.x + 7.5, pt.y
    out["spawn"] = {"x": round(sx, 1), "z": round(sz, 1)}

    binf.write(os.path.join(OUT, "yaba.bin"))
    out["binBytes"] = binf.size
    with open(os.path.join(OUT, "yaba.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print("bin", binf.size // 1024, "KB; json", os.path.getsize(os.path.join(OUT, "yaba.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
