"""Generate the player character GLB from MakeHuman assets.

MakeHuman's meshes, targets, skins and proxies are CC0 since MakeHuman 1.1.
We read them from the `makehuman-data` npm package (fetched into .cache/),
morph the base mesh into a young Nigerian man, fit clothes/hair onto him,
collapse the 163-bone default skeleton to a game rig, author idle/walk/run
clips procedurally and write a single compact skinned GLB.

Usage:
    npm pack makehuman-data@0.0.2 --pack-destination .cache && tar ...   (see scripts/fetch-makehuman.sh)
    python3 tools/character/build_character.py [--config tools/character/presets/tunde.json]
"""
import argparse
import io
import json
import math
import os
import struct

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MH = os.path.join(ROOT, ".cache", "makehuman-data", "package")
DATA = os.path.join(MH, "public", "data")

# ---------------------------------------------------------------------------
# three.js JSON v3 parsing
# ---------------------------------------------------------------------------


def parse_faces(model):
    """Return list of (vertex_idx[3], uv_idx[3], material) triangles."""
    faces = model["faces"]
    tris = []
    i = 0
    n = len(faces)
    while i < n:
        t = faces[i]
        i += 1
        quad = t & 1
        has_mat = t & 2
        has_face_uv = t & 4
        has_vert_uv = t & 8
        has_face_n = t & 16
        has_vert_n = t & 32
        has_face_c = t & 64
        has_vert_c = t & 128
        nv = 4 if quad else 3
        vi = faces[i:i + nv]
        i += nv
        mat = 0
        if has_mat:
            mat = faces[i]
            i += 1
        if has_face_uv:
            i += 1
        uvi = None
        if has_vert_uv:
            uvi = faces[i:i + nv]
            i += nv
        if has_face_n:
            i += 1
        if has_vert_n:
            i += nv
        if has_face_c:
            i += 1
        if has_vert_c:
            i += nv
        if uvi is None:
            uvi = vi
        if quad:
            tris.append(((vi[0], vi[1], vi[3]), (uvi[0], uvi[1], uvi[3]), mat))
            tris.append(((vi[1], vi[2], vi[3]), (uvi[1], uvi[2], uvi[3]), mat))
        else:
            tris.append((tuple(vi), tuple(uvi), mat))
    return tris


def load_json(path):
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Morph targets
# ---------------------------------------------------------------------------


def target_key(path):
    p = path.lower()
    p = p.split("targets/", 1)[1] if "targets/" in p else p
    return p[:-len(".target")] if p.endswith(".target") else p


def apply_targets(base, weights):
    tl = load_json(os.path.join(MH, "src", "json", "targets", "target-list.json"))
    keys = sorted(target_key(p) for p in tl["targets"].keys())
    nverts3 = base.shape[0] * 3
    data = np.memmap(os.path.join(DATA, "targets", "targets.bin"), dtype="<i2", mode="r")
    assert data.shape[0] == nverts3 * len(keys), "unexpected targets.bin size"
    delta = np.zeros(nverts3, dtype=np.float64)
    for name, w in weights.items():
        if w == 0:
            continue
        idx = keys.index(name)  # raises if missing: keeps presets honest
        delta += data[idx * nverts3:(idx + 1) * nverts3].astype(np.float64) * w
    return base + (delta * 1e-3).reshape(-1, 3)


def macro_weights(cfg):
    """MakeHuman macro modifier maths for one gender/age (simplified to the
    young adult range the game needs)."""
    male = cfg.get("gender", 1.0)
    muscle = cfg.get("muscle", 0.5)
    weight = cfg.get("weight", 0.5)
    height = cfg.get("height", 0.5)
    w = {}

    def lerp3(v, names):
        # v in [0,1] -> weights on (min, average, max)
        if v < 0.5:
            return {names[0]: 1 - v * 2, names[1]: v * 2}
        return {names[1]: 1 - (v - 0.5) * 2, names[2]: (v - 0.5) * 2}

    genders = {"male": male, "female": 1 - male}
    muscles = lerp3(muscle, ["minmuscle", "averagemuscle", "maxmuscle"])
    weights = lerp3(weight, ["minweight", "averageweight", "maxweight"])
    for g, gw in genders.items():
        if gw <= 0:
            continue
        for race, rw in cfg.get("ethnicity", {"african": 1.0}).items():
            w[f"macrodetails/{race}-{g}-young"] = w.get(f"macrodetails/{race}-{g}-young", 0) + gw * rw
        for m, mw in muscles.items():
            for wt, ww in weights.items():
                k = f"macrodetails/universal-{g}-young-{m}-{wt}"
                w[k] = gw * mw * ww
                if height != 0.5:
                    hk = "maxheight" if height > 0.5 else "minheight"
                    w[f"macrodetails/height/{g}-young-{m}-{wt}-{hk}"] = gw * mw * ww * abs(height - 0.5) * 2
                pk = f"macrodetails/proportions/{g}-young-{m}-{wt}-idealproportions"
                w[pk] = gw * mw * ww * cfg.get("proportions", 0.5)
    for k, v in cfg.get("extra_targets", {}).items():
        w[k] = w.get(k, 0) + v
    return {k: v for k, v in w.items() if abs(v) > 1e-6}


# ---------------------------------------------------------------------------
# Skeleton: collapse MakeHuman default rig into a game rig
# ---------------------------------------------------------------------------

KEEP_PREFIXES = (
    "root", "spine0", "pelvis.", "upperleg0", "lowerleg0", "foot.", "toe1-1.",
    "clavicle.", "shoulder01.", "upperarm0", "lowerarm0", "wrist.",
    "metacarpal", "finger", "neck0", "head", "jaw",
)


def build_skeleton(model, verts):
    bones = model["bones"]
    jp = model["metadata"]["joint_pos_idxs"]

    def joint(name):
        return verts[jp[name]].mean(axis=0)

    real = [i for i, b in enumerate(bones) if "____" not in b["name"]]

    def real_parent(i):
        p = bones[i]["parent"]
        while p >= 0 and "____" in bones[p]["name"]:
            p = bones[p]["parent"]
        return p

    def kept(name):
        return name.startswith(KEEP_PREFIXES)

    # map every one of the 326 bones to a kept real bone
    def resolve(i):
        while i >= 0:
            b = bones[i]
            if "____" not in b["name"] and kept(b["name"]):
                return i
            i = b["parent"] if "____" not in b["name"] else bones[i]["parent"]
        return 1  # root

    out = []  # kept bones in hierarchy order
    index_of = {}
    for i in real:
        name = bones[i]["name"]
        if not kept(name):
            continue
        p = real_parent(i)
        while p >= 0 and not kept(bones[p]["name"]):
            p = real_parent(p)
        index_of[i] = len(out)
        out.append({
            "src": i,
            "name": name,
            "parent": index_of.get(p, -1) if p >= 0 else -1,
            "head": joint(name + "____head"),
            "tail": joint(name + "____tail"),
        })
    remap = np.array([index_of[resolve(i)] for i in range(len(bones))], dtype=np.int32)
    return out, remap


def remap_skin(indices, weights, remap, nbones):
    """Fold influences onto kept bones, keep top 4, renormalise."""
    idx = np.asarray(indices, dtype=np.int64).reshape(-1, 4)
    w = np.asarray(weights, dtype=np.float64).reshape(-1, 4)
    n = idx.shape[0]
    acc = np.zeros((n, nbones))
    rows = np.repeat(np.arange(n), 4)
    np.add.at(acc, (rows, remap[idx.ravel()]), w.ravel())
    return top4(acc) + (acc,)


def top4(acc):
    nbones = acc.shape[1]
    top = np.argsort(-acc, axis=1)[:, :4]
    tw = np.take_along_axis(acc, top, axis=1)
    s = tw.sum(axis=1, keepdims=True)
    s[s == 0] = 1
    tw = tw / s
    top[tw == 0] = 0
    return top.astype(np.uint8 if nbones < 256 else np.uint16), tw.astype(np.float32)


# ---------------------------------------------------------------------------
# Mesh assembly
# ---------------------------------------------------------------------------


def build_submesh(tris, positions, uvs, skin_idx, skin_w, keep_face=None, flip_v=False):
    """Split vertices by (pos, uv) pair -> flat arrays."""
    key_to_new = {}
    pos, uv, ji, jw, index = [], [], [], [], []
    for (vi, ui, mat) in tris:
        if keep_face is not None and not keep_face(vi, mat):
            continue
        for v, u in zip(vi, ui):
            k = (v, u)
            ni = key_to_new.get(k)
            if ni is None:
                ni = len(pos)
                key_to_new[k] = ni
                pos.append(positions[v])
                uu = uvs[u]
                uv.append((uu[0], 1 - uu[1]) if flip_v else (uu[0], uu[1]))
                ji.append(skin_idx[v])
                jw.append(skin_w[v])
            index.append(ni)
    return {
        "position": np.asarray(pos, dtype=np.float32),
        "uv": np.asarray(uv, dtype=np.float32),
        "joints": np.asarray(ji),
        "weights": np.asarray(jw, dtype=np.float32),
        "index": np.asarray(index, dtype=np.uint32),
    }


def compute_normals(m):
    p = m["position"].astype(np.float64)
    f = m["index"].reshape(-1, 3)
    fn = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    n = np.zeros_like(p)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    # smooth across uv seams: average normals of coincident positions
    keyed = np.round(p, 5)
    _, inv = np.unique(keyed, axis=0, return_inverse=True)
    acc = np.zeros((inv.max() + 1, 3))
    np.add.at(acc, inv.ravel(), n)
    n = acc[inv.ravel()]
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    m["normal"] = (n / ln).astype(np.float32)


def fit_proxy(proxy, body_verts):
    ref = np.asarray(proxy["metadata"]["ref_vIdxs"], dtype=np.int64)
    w = np.asarray(proxy["metadata"]["weights"], dtype=np.float64)
    off = np.asarray(proxy["metadata"]["offsets"], dtype=np.float64)
    v = (body_verts[ref] * w[:, :, None]).sum(axis=1) + off
    return v


# ---------------------------------------------------------------------------
# Quaternion helpers (x, y, z, w)
# ---------------------------------------------------------------------------


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def qaxis(axis, ang):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    s = math.sin(ang / 2)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, math.cos(ang / 2)])


def qinv(q):
    return np.array([-q[0], -q[1], -q[2], q[3]])


def qbetween(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    c = np.cross(a, b)
    d = float(np.dot(a, b))
    q = np.array([c[0], c[1], c[2], 1 + d])
    return q / np.linalg.norm(q)


def qrot(q, v):
    p = np.array([v[0], v[1], v[2], 0.0])
    r = qmul(qmul(q, p), qinv(q))
    return r[:3]


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


# ---------------------------------------------------------------------------
# Procedural animation
# ---------------------------------------------------------------------------


class Rig:
    def __init__(self, bones):
        self.bones = bones
        self.by_name = {b["name"]: i for i, b in enumerate(bones)}
        self.children = [[] for _ in bones]
        for i, b in enumerate(bones):
            if b["parent"] >= 0:
                self.children[b["parent"]].append(i)

    def i(self, name):
        return self.by_name[name]

    def dir(self, name):
        b = self.bones[self.i(name)]
        d = b["tail"] - b["head"]
        return d / np.linalg.norm(d)

    def seg(self, a, b):
        """Direction from the head of bone a to the head of bone b (a whole limb segment)."""
        d = self.bones[self.i(b)]["head"] - self.bones[self.i(a)]["head"]
        return d / np.linalg.norm(d)


def pose_frame(rig, p, t):
    """Compute local quaternions for every bone for parameters p at phase t.

    World-space rotations are specified for the big limbs, everything else
    inherits. Rest frames are axis aligned (MakeHuman), so a bone's world
    rotation is simply the product of local rotations down the chain.
    """
    n = len(rig.bones)
    world = [None] * n
    local = [np.array([0, 0, 0, 1.0])] * n
    want = {}  # bone -> world rotation override
    extra_local = {}  # bone -> local rotation

    TAU = math.pi * 2
    ph = TAU * t
    s = math.sin(ph)
    c = math.cos(ph)
    s2 = math.sin(2 * ph)
    c2 = math.cos(2 * ph)

    # Hips / spine
    hip_twist = qaxis(Y, p["hip_twist"] * s)
    hip_roll = qaxis(Z, p["hip_roll"] * s)
    lean = qaxis(X, p["lean"])
    breathe = p.get("breathe", 0) * math.sin(ph)
    want_root = qmul(lean, qmul(hip_twist, hip_roll))
    root_i = rig.i("root")
    # chest orientation (hips + counter twist) so the arms ride with the torso
    torso = qmul(lean, qaxis(Y, -p["hip_twist"] * s * 0.4 + p.get("chest_twist", 0) * -s))

    for side, sgn in (("L", 1), ("R", -1)):
        phase = s if side == "L" else -s
        # legs: positive swing brings foot forward (+Z)
        swing = p["leg_swing"] * phase + p.get("leg_bias", 0)
        # knee bends most while the leg passes under the body (swing phase)
        lift = max(0.0, math.cos(ph + (0 if side == "L" else math.pi) + p.get("knee_phase", 0.0)))
        knee = p["knee_base"] + p["knee"] * lift ** 1.5
        # straighten each limb segment from the MakeHuman A-pose, then swing it
        # about world X (positive angle = segment points backward)
        leg_down = np.array([sgn * 0.015, -1.0, 0.0])
        thigh_rest = qbetween(rig.seg(f"upperleg01.{side}", f"lowerleg01.{side}"), leg_down)
        shin_rest = qbetween(rig.seg(f"lowerleg01.{side}", f"foot.{side}"), leg_down)
        thigh = qmul(qaxis(X, -swing), thigh_rest)
        want[f"upperleg01.{side}"] = qmul(want_root, thigh) if p.get("legs_follow_hips") else thigh
        shin_angle = knee - swing
        want[f"lowerleg01.{side}"] = qmul(qaxis(X, shin_angle), shin_rest)
        # foot partly follows the shin: toes up at heel strike, down at push off
        roll = p.get("foot_roll", 0) * max(0.0, -phase) * lift
        want[f"foot.{side}"] = qmul(qaxis(X, 0.35 * shin_angle + roll), shin_rest)
        # arms swing opposite to the leg on the same side; a > 0 = forward
        a = -p["arm_swing"] * phase + p.get("arm_bias", 0)
        target = np.array([sgn * p["arm_out"], -1.0, -0.04])
        up = qmul(torso, qmul(qaxis(X, -a), qbetween(rig.seg(f"upperarm01.{side}", f"lowerarm01.{side}"), target)))
        want[f"upperarm01.{side}"] = up
        bend = p["elbow"] + p.get("elbow_swing", 0) * max(0.0, a / max(p["arm_swing"], 1e-6))
        fore_target = np.array([sgn * p["arm_out"] * 0.5, -1.0, 0.0])
        fore = qmul(torso, qmul(qaxis(X, -(a + bend)), qbetween(rig.seg(f"lowerarm01.{side}", f"wrist.{side}"), fore_target)))
        want[f"lowerarm01.{side}"] = fore
        # relaxed hand: in line with the forearm, slight inward flex
        hand_target = np.array([sgn * p["arm_out"] * 0.3, -1.0, 0.12])
        want[f"wrist.{side}"] = qmul(torso, qmul(qaxis(X, -(a + bend) * 0.9),
                                                qbetween(rig.seg(f"wrist.{side}", f"finger3-1.{side}"), hand_target)))
        # finger curl in rest-local frame (fingers point +-X, palm -Y)
        for f in range(1, 6):
            for k in range(1, 4):
                nm = f"finger{f}-{k}.{side}"
                if nm in rig.by_name:
                    ang = p["curl"] * (0.6 if f == 1 else 1.0) * (1.2 if k > 1 else 0.8)
                    extra_local[nm] = qaxis(Z, -sgn * ang) if f > 1 else qaxis(Y, sgn * ang * 0.5)

    # head stays level-ish, idle look around
    look = qaxis(Y, p.get("look", 0) * math.sin(ph * p.get("look_freq", 1)))
    nod = qaxis(X, -p["lean"] * 0.6 + p.get("head_bob", 0) * c2)

    # spine counter twist and breathing
    for k, nm in enumerate(["spine04", "spine03", "spine02", "spine01"]):
        extra_local[nm] = qmul(qaxis(Y, -p["hip_twist"] * s * 0.6 + (p.get("chest_twist", 0) * -s if k == 3 else 0)),
                               qaxis(X, -breathe * (0.012 if k >= 2 else 0.004)))
    extra_local["neck01"] = qaxis(X, -breathe * 0.01)
    extra_local["head"] = qmul(look, nod)

    for i, b in enumerate(rig.bones):
        par = b["parent"]
        pw = world[par] if par >= 0 else np.array([0, 0, 0, 1.0])
        nm = b["name"]
        if i == root_i:
            w = want_root
        elif nm in want:
            w = want[nm]
        else:
            w = qmul(pw, extra_local.get(nm, np.array([0, 0, 0, 1.0])))
        world[i] = w
        local[i] = qmul(qinv(pw), w)
    bob = p["bob"] * (c2 if p.get("bob_double", True) else c) + p.get("drop", 0)
    sway = p.get("sway", 0) * s
    return local, (sway, bob, 0.0)


CLIPS = {
    "idle": dict(duration=4.0, fps=15, leg_swing=0.0, knee=0.0, knee_base=0.03, hip_twist=0.0, hip_roll=0.025,
                 lean=0.02, arm_out=0.16, arm_swing=0.03, elbow=0.18, curl=0.35, bob=0.004, bob_double=False,
                 breathe=1.0, look=0.25, look_freq=1, sway=0.012, drop=-0.005),
    "walk": dict(duration=1.05, fps=30, leg_swing=0.42, knee=0.95, knee_base=0.06, knee_phase=0.7, hip_twist=0.07,
                 hip_roll=0.03, lean=0.05, arm_out=0.14, arm_swing=0.32, elbow=0.22, elbow_swing=0.25, curl=0.4,
                 bob=0.022, foot_roll=0.25, head_bob=0.01, sway=0.015, drop=-0.012),
    "run": dict(duration=0.66, fps=30, leg_swing=0.75, knee=1.45, knee_base=0.25, knee_phase=0.6, hip_twist=0.12,
                hip_roll=0.03, lean=0.2, arm_out=0.2, arm_swing=0.55, elbow=1.35, elbow_swing=0.2, curl=0.9,
                bob=0.045, foot_roll=0.4, head_bob=0.015, chest_twist=0.08, drop=-0.06),
}


def bake_clip(rig, name, p):
    frames = int(round(p["duration"] * p["fps"]))
    times = np.array([k / p["fps"] for k in range(frames + 1)], dtype=np.float32)
    rots = np.zeros((len(rig.bones), frames + 1, 4), dtype=np.float32)
    trans = np.zeros((frames + 1, 3), dtype=np.float32)
    for k in range(frames + 1):
        t = (k % frames) / frames
        local, (sx, by, bz) = pose_frame(rig, p, t)
        for i in range(len(rig.bones)):
            q = local[i]
            if k > 0 and np.dot(q, rots[i, k - 1]) < 0:
                q = -q
            rots[i, k] = q
        trans[k] = (sx, by, bz)
    return {"name": name, "times": times, "rots": rots, "root_offset": trans}


# ---------------------------------------------------------------------------
# GLB writer (minimal, just what we need)
# ---------------------------------------------------------------------------


class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []
        self.gltf = {
            "asset": {"version": "2.0", "generator": "yaba-life character builder"},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [],
            "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
            "skins": [], "animations": [], "bufferViews": self.views, "accessors": self.accessors,
            "buffers": [{"byteLength": 0}],
        }

    def _align(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def view(self, data, target=None):
        self._align()
        off = len(self.bin)
        self.bin += data
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, atype, target=None, normalized=False, minmax=False):
        arr = np.ascontiguousarray(arr)
        ctype = {np.dtype("float32"): 5126, np.dtype("uint32"): 5125, np.dtype("uint16"): 5123,
                 np.dtype("uint8"): 5121, np.dtype("int16"): 5122, np.dtype("int8"): 5120}[arr.dtype]
        count = arr.shape[0]
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": ctype, "count": count, "type": atype}
        if normalized:
            a["normalized"] = True
        if minmax:
            flat = arr.reshape(count, -1)
            a["min"] = flat.min(axis=0).tolist()
            a["max"] = flat.max(axis=0).tolist()
        self.accessors.append(a)
        return len(self.accessors) - 1

    def image(self, img, mime, quality=88):
        buf = io.BytesIO()
        if mime == "image/jpeg":
            img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
        else:
            img.save(buf, "PNG", optimize=True)
        self.gltf["images"].append({"bufferView": self.view(buf.getvalue()), "mimeType": mime})
        self.gltf["textures"].append({"sampler": 0, "source": len(self.gltf["images"]) - 1})
        return len(self.gltf["textures"]) - 1

    def write(self, path):
        self._align()
        self.gltf["buffers"][0]["byteLength"] = len(self.bin)
        for k in ["textures", "images", "animations", "skins"]:
            if not self.gltf[k]:
                del self.gltf[k]
        js = json.dumps(self.gltf, separators=(",", ":")).encode()
        while len(js) % 4:
            js += b" "
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942))
            f.write(self.bin)


# ---------------------------------------------------------------------------


def inpaint(im, rects):
    """Erase printed logos: fill non-fabric pixels inside rects from their surroundings."""
    from PIL import ImageFilter
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    mask = np.zeros(a.shape[:2], dtype=bool)
    for x0, y0, x1, y1 in rects:
        reg = a[y0:y1, x0:x1]
        lum = reg.mean(axis=2)
        sat = reg.max(axis=2) - reg.min(axis=2)
        m = (lum < np.median(lum) - 18) | (sat > 25)
        # grow the mask a little to catch anti-aliased edges
        mi = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
        mask[y0:y1, x0:x1] = np.asarray(mi) > 0
    keep = (~mask).astype(np.float32)
    out = a.copy()
    for radius in (3, 6, 12):
        num = np.stack([np.asarray(Image.fromarray(np.uint8(a[..., c] * keep)).filter(ImageFilter.GaussianBlur(radius)),
                                   dtype=np.float32) for c in range(3)], axis=2)
        den = np.asarray(Image.fromarray(np.uint8(keep * 255)).filter(ImageFilter.GaussianBlur(radius)),
                         dtype=np.float32)[..., None] / 255
        fill = num / np.maximum(den, 1e-3)
        sel = mask & (den[..., 0] > 0.05)
        out[sel] = fill[sel]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def load_tex(path, size=None, tint=None, gamma=None, erase=None):
    im = Image.open(path)
    im.load()
    if erase:
        im = inpaint(im, erase)
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    if tint is not None or gamma is not None:
        has_alpha = im.mode == "RGBA"
        a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
        rgb = a[..., :3]
        if gamma is not None:
            rgb = rgb ** gamma
        if tint is not None:
            rgb = rgb * np.asarray(tint, dtype=np.float32)
        a[..., :3] = np.clip(rgb, 0, 1)
        im = Image.fromarray((a * 255).astype(np.uint8), "RGBA")
        if not has_alpha:
            im = im.convert("RGB")
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "presets", "tunde.json"))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    cfg = load_json(args.config)
    out = args.out or os.path.join(ROOT, "public", "models", cfg["id"] + ".glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    model = load_json(os.path.join(DATA, "models", "human_full_size.json"))
    base = np.asarray(model["vertices"], dtype=np.float64).reshape(-1, 3)
    verts = apply_targets(base, macro_weights(cfg))

    bones, remap = build_skeleton(model, verts)
    rig = Rig(bones)
    nb = len(bones)
    body_ji, body_jw, body_dense = remap_skin(model["skinIndices"], model["skinWeights"], remap, nb)

    SCALE = 0.1  # MakeHuman decimetres -> metres
    # proxies
    proxies = []
    deleted = np.zeros(base.shape[0], dtype=bool)
    for pr in cfg["proxies"]:
        pj = load_json(os.path.join(DATA, "proxies", pr["path"]))
        dv = pj["metadata"].get("deleteVerts")
        if dv and pr.get("delete_body", True):
            deleted |= np.asarray(dv, dtype=bool)[: base.shape[0]]
        proxies.append((pr, pj))

    glb = GLB()
    nodes = glb.gltf["nodes"]

    # skeleton nodes
    joint_nodes = []
    ground = None
    for b in bones:
        # three.js strips "." from node names, so use "_" up front
        nodes.append({"name": b["name"].replace(".", "_")})
        joint_nodes.append(len(nodes) - 1)

    # body mesh (only the 'body' material, minus vertices hidden by clothes)
    body_tris = parse_faces(model)
    body_mat = [i for i, m in enumerate(model["materials"]) if m.get("DbgName") == "body"][0]
    uvs = np.asarray(model["uvs"][0], dtype=np.float64).reshape(-1, 2)

    def keep_body(vi, mat):
        return mat == body_mat and not any(deleted[v] for v in vi)

    submeshes = []
    body = build_submesh(body_tris, verts, uvs, body_ji, body_jw, keep_body, flip_v=True)
    submeshes.append(("body", body, cfg["skin"]))
    for pr, pj in proxies:
        pv = fit_proxy(pj, verts)
        # skin proxies from the body weights at their reference vertices
        ref = np.asarray(pj["metadata"]["ref_vIdxs"], dtype=np.int64)
        rw = np.asarray(pj["metadata"]["weights"], dtype=np.float64)
        ji, jw = top4(np.clip((body_dense[ref] * rw[:, :, None]).sum(axis=1), 0, None))
        puv = np.asarray(pj["uvs"][0], dtype=np.float64).reshape(-1, 2)
        sm = build_submesh(parse_faces(pj), pv, puv, ji, jw, None, flip_v=True)
        submeshes.append((pr["path"].split("/")[1], sm, pr))

    allpos = np.concatenate([m["position"] for _, m, _ in submeshes])
    ground = allpos[:, 1].min()
    offset = np.array([0, -ground, 0])
    for _, m, _ in submeshes:
        m["position"] = ((m["position"] + offset) * SCALE).astype(np.float32)
        compute_normals(m)

    # joint transforms
    heads = [(b["head"] + offset) * SCALE for b in bones]
    for i, b in enumerate(bones):
        par = b["parent"]
        t = heads[i] - (heads[par] if par >= 0 else 0)
        nodes[joint_nodes[i]]["translation"] = [float(x) for x in t]
        if par >= 0:
            nodes[joint_nodes[par]].setdefault("children", []).append(joint_nodes[i])
    ibm = np.zeros((nb, 16), dtype=np.float32)
    for i in range(nb):
        m = np.eye(4, dtype=np.float32)
        m[:3, 3] = -heads[i]
        ibm[i] = m.T.reshape(-1)  # column major
    root_joint = joint_nodes[0]
    glb.gltf["skins"].append({"joints": joint_nodes, "inverseBindMatrices": glb.accessor(ibm, "MAT4"),
                              "skeleton": root_joint})

    # materials
    prims = []
    for name, m, mc in submeshes:
        mat = {"name": name, "pbrMetallicRoughness": {"metallicFactor": 0.0,
                                                       "roughnessFactor": mc.get("roughness", 0.8)}}
        tex_cfg = mc.get("texture")
        if tex_cfg:
            src = os.path.join(DATA, tex_cfg["file"]) if not tex_cfg["file"].startswith("/") else tex_cfg["file"]
            im = load_tex(src, tex_cfg.get("size"), tex_cfg.get("tint"), tex_cfg.get("gamma"), tex_cfg.get("erase"))
            alpha = im.mode == "RGBA" and mc.get("alpha")
            ti = glb.image(im, "image/png" if alpha else "image/jpeg", tex_cfg.get("quality", 88))
            mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": ti}
            if alpha:
                mat["alphaMode"] = mc["alpha"]
                if mc["alpha"] == "MASK":
                    mat["alphaCutoff"] = mc.get("cutoff", 0.5)
                mat["doubleSided"] = True
        if mc.get("normal"):
            im = load_tex(os.path.join(DATA, mc["normal"]["file"]), mc["normal"].get("size"))
            mat["normalTexture"] = {"index": glb.image(im, "image/jpeg", 90), "scale": mc["normal"].get("scale", 1.0)}
        if mc.get("color"):
            mat["pbrMetallicRoughness"]["baseColorFactor"] = mc["color"]
        glb.gltf["materials"].append(mat)
        attrs = {
            "POSITION": glb.accessor(m["position"], "VEC3", 34962, minmax=True),
            "NORMAL": glb.accessor(m["normal"], "VEC3", 34962),
            "TEXCOORD_0": glb.accessor(m["uv"], "VEC2", 34962),
            "JOINTS_0": glb.accessor(m["joints"].astype(np.uint8 if nb < 256 else np.uint16), "VEC4", 34962),
            "WEIGHTS_0": glb.accessor(m["weights"], "VEC4", 34962),
        }
        idx = m["index"].astype(np.uint16 if m["position"].shape[0] < 65536 else np.uint32)
        prims.append({"attributes": attrs, "indices": glb.accessor(idx, "SCALAR", 34963),
                      "material": len(glb.gltf["materials"]) - 1})
    glb.gltf["meshes"].append({"name": cfg["id"], "primitives": prims})
    nodes.append({"name": cfg["id"] + "_mesh", "mesh": 0, "skin": 0})
    mesh_node = len(nodes) - 1
    nodes.append({"name": cfg["id"], "children": [root_joint, mesh_node]})
    glb.gltf["scenes"][0]["nodes"] = [len(nodes) - 1]

    # animations
    root_rest = np.asarray(nodes[root_joint]["translation"], dtype=np.float32)
    for cname, p in CLIPS.items():
        clip = bake_clip(rig, cname, p)
        tacc = glb.accessor(clip["times"], "SCALAR", minmax=True)
        samplers, channels = [], []
        for i in range(nb):
            r = clip["rots"][i]
            if np.allclose(r, r[0], atol=1e-5) and np.allclose(r[0], [0, 0, 0, 1], atol=1e-5):
                continue
            samplers.append({"input": tacc, "output": glb.accessor(r.astype(np.float32), "VEC4"),
                             "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": joint_nodes[i], "path": "rotation"}})
        tr = (clip["root_offset"] + root_rest).astype(np.float32)
        samplers.append({"input": tacc, "output": glb.accessor(tr, "VEC3"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": root_joint, "path": "translation"}})
        glb.gltf["animations"].append({"name": cname, "samplers": samplers, "channels": channels})

    glb.write(out)
    tri = sum(len(m["index"]) // 3 for _, m, _ in submeshes)
    print(f"wrote {out}: {os.path.getsize(out) / 1024:.0f} KB, {nb} bones, {tri} triangles, "
          f"height {(allpos[:, 1].max() - ground) * SCALE:.2f} m")


if __name__ == "__main__":
    main()
