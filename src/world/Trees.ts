import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function colored(geo: THREE.BufferGeometry, hex: number, jitter = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 - jitter + Math.random() * jitter * 2;
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Almond / mango style shade tree, ~90 triangles. */
function broadleaf() {
  const trunk = colored(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6, 1, true).translate(0, 1.6, 0), 0x5b4532);
  const parts = [trunk];
  const blobs: [number, number, number, number][] = [
    [0, 4.4, 0, 2.3], [1.3, 3.9, 0.4, 1.6], [-1.2, 4.0, -0.5, 1.7], [0.3, 5.3, -0.6, 1.5],
  ];
  for (const [x, y, z, r] of blobs) {
    const b = new THREE.IcosahedronGeometry(r, 0).scale(1, 0.72, 1).translate(x, y, z);
    parts.push(colored(b, 0x3f6b2e, 0.18));
  }
  return mergeGeometries(parts)!;
}

/** Coconut palm: slim leaning trunk and drooping fronds, ~70 triangles. */
function palm() {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.2, 8, 5, 4, true).translate(0, 4, 0);
  // gentle lean/curve
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + 0.035 * y * y * 0.5);
  }
  parts.push(colored(trunk, 0x7a6650, 0.1));
  const top = new THREE.Vector3(0.035 * 32, 8, 0);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const frond = new THREE.BufferGeometry();
    const L = 3.2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.45);
    const mid = top.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, 0.35, 0));
    const tip = top.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, -1.3, 0));
    const v = [
      top, mid.clone().add(side), mid.clone().sub(side),
      mid.clone().add(side), tip, mid.clone().sub(side),
    ].flatMap((q) => [q.x, q.y, q.z]);
    frond.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    frond.computeVertexNormals();
    parts.push(colored(frond, 0x4f7a2c, 0.15));
  }
  return mergeGeometries(parts)!;
}

export class Trees {
  readonly group = new THREE.Group();
  private geos = [broadleaf(), palm()];
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private dummy = new THREE.Object3D();

  addChunk(data: Float32Array) {
    const counts = [0, 0];
    for (let i = 0; i < data.length; i += 5) counts[data[i + 4]]++;
    for (let type = 0; type < 2; type++) {
      if (!counts[type]) continue;
      const mesh = new THREE.InstancedMesh(this.geos[type], this.material, counts[type]);
      let n = 0;
      for (let i = 0; i < data.length; i += 5) {
        if (data[i + 4] !== type) continue;
        this.dummy.position.set(data[i], 0, data[i + 1]);
        this.dummy.rotation.y = data[i + 3];
        this.dummy.scale.setScalar(data[i + 2]);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(n++, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.kind = 'trees';
      this.group.add(mesh);
    }
  }

  get meshes() {
    return this.group.children;
  }
}
