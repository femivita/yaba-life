"""Fetch real map data for a city bbox from Overture Maps (OpenStreetMap-derived).

Reads only the parquet row groups whose bbox stats intersect the area, so it
never downloads the full global dataset.

Usage: python3 tools/fetch_overture.py
"""
import json, sys
from concurrent.futures import ThreadPoolExecutor
import pyarrow.fs as fs
import pyarrow.parquet as pq
import pyarrow as pa

RELEASE = "2026-09-23.1"
# Yaba, Lagos (Ebute Metta / Sabo / Akoka / Onike / Alagomeji / UNILAG)
BBOX = dict(xmin=3.360, ymin=6.493, xmax=3.405, ymax=6.528)
THEMES = {
    "buildings": "theme=buildings/type=building",
    "segments": "theme=transportation/type=segment",
    "places": "theme=places/type=place",
    "land_use": "theme=base/type=land_use",
    "water": "theme=base/type=water",
    "infrastructure": "theme=base/type=infrastructure",
}
s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")
root = f"overturemaps-us-west-2/release/{RELEASE}/"


def rg_hits(md, names):
    idx = {n: i for i, n in enumerate(names)}
    want = ["bbox.xmin", "bbox.xmax", "bbox.ymin", "bbox.ymax"]
    hits = []
    for r in range(md.num_row_groups):
        rg = md.row_group(r)
        st = {}
        for w in want:
            c = rg.column(idx[w]).statistics
            st[w] = (c.min, c.max)
        if (st["bbox.xmin"][0] <= BBOX["xmax"] and st["bbox.xmax"][1] >= BBOX["xmin"]
                and st["bbox.ymin"][0] <= BBOX["ymax"] and st["bbox.ymax"][1] >= BBOX["ymin"]):
            hits.append(r)
    return hits


def process(path):
    f = pq.ParquetFile(s3.open_input_file(path))
    names = [f.metadata.schema.column(i).path for i in range(f.metadata.num_columns)]
    hits = rg_hits(f.metadata, names)
    if not hits:
        return None
    t = f.read_row_groups(hits)
    b = t.column("bbox").combine_chunks()
    import pyarrow.compute as pc
    m = pc.and_(pc.and_(pc.less_equal(b.field("xmin"), BBOX["xmax"]), pc.greater_equal(b.field("xmax"), BBOX["xmin"])),
                pc.and_(pc.less_equal(b.field("ymin"), BBOX["ymax"]), pc.greater_equal(b.field("ymax"), BBOX["ymin"])))
    t = t.filter(m)
    return t if t.num_rows else None


for key, sub in THEMES.items():
    files = [f.path for f in s3.get_file_info(fs.FileSelector(root + sub)) if f.path.endswith(".parquet") or "part-" in f.path]
    with ThreadPoolExecutor(16) as ex:
        tables = [t for t in ex.map(process, files) if t is not None]
    if not tables:
        print(key, 0); continue
    t = pa.concat_tables(tables, promote_options="permissive")
    pq.write_table(t, f"data/raw/{key}.parquet")
    print(key, t.num_rows, file=sys.stderr)
