// 极简 glTF 2.0 二进制（.glb）写出器：无三方依赖，可在 Node 里直接产出引擎无关的建筑资产。
// 支持：三角形网格（POSITION/NORMAL/TEXCOORD_0 + 索引）、PBR 材质（baseColor/roughness/metalness）、节点层级。
// 用途：把逐栋建模结果导出成 .glb，three.js / Unity / Unreal 都能直接导入（不返工的关键）。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const COMP = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const ARR = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export class GlbBuilder {
  constructor(name = 'asset') {
    this.name = name;
    this.nodes = [];
    this.meshes = [];
    this.materials = [];
    this.accessors = [];
    this.bufferViews = [];
    this.chunks = [];   // {data:Buffer, target}
    this.byteLength = 0;
  }

  _view(buf, target) {
    // 4 字节对齐
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) { this.chunks.push({ data: Buffer.alloc(pad, 0), target: null }); this.byteLength += pad; }
    const offset = this.byteLength;
    this.chunks.push({ data: buf, target });
    this.byteLength += buf.length;
    this.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    return this.bufferViews.length - 1;
  }

  _accessor(viewIdx, componentType, count, type, extra = {}) {
    const a = { bufferView: viewIdx, componentType, count, type, ...extra };
    this.accessors.push(a);
    return this.accessors.length - 1;
  }

  /**
   * 添加一个网格节点
   * @param {object} o
   * @param {Float32Array} o.position  xyz
   * @param {Float32Array} o.normal    xyz
   * @param {Float32Array} [o.uv]      uv
   * @param {Uint32Array|Uint16Array} o.index
   * @param {object} o.material {name,color:[r,g,b,a],roughness,metalness,emissive:[r,g,b]}
   * @param {number[]} [o.translation] [x,y,z]
   * @param {number[]} [o.scale]
   */
  addMesh(o) {
    const vCount = o.position.length / 3;
    const pv = this._view(Buffer.from(o.position.buffer, o.position.byteOffset, o.position.byteLength), 34962);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < o.position.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = o.position[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    const attrs = { POSITION: this._accessor(pv, 5126, vCount, 'VEC3', { min, max }) };
    if (o.normal) {
      const nv = this._view(Buffer.from(o.normal.buffer, o.normal.byteOffset, o.normal.byteLength), 34962);
      attrs.NORMAL = this._accessor(nv, 5126, vCount, 'VEC3');
    }
    if (o.uv) {
      const uv = this._view(Buffer.from(o.uv.buffer, o.uv.byteOffset, o.uv.byteLength), 34962);
      attrs.TEXCOORD_0 = this._accessor(uv, 5126, o.uv.length / 2, 'VEC2');
    }
    const idxBuf = Buffer.from(o.index.buffer, o.index.byteOffset, o.index.byteLength);
    const iv = this._view(idxBuf, 34963);
    const compType = o.index instanceof Uint16Array ? 5123 : 5125;
    const indices = this._accessor(iv, compType, o.index.length, 'SCALAR');

    let matIdx = -1;
    if (o.material) {
      const m = o.material;
      const pbr = {
        baseColorFactor: m.color || [0.8, 0.8, 0.8, 1],
        metallicFactor: m.metalness ?? 0.0,
        roughnessFactor: m.roughness ?? 0.85,
      };
      if (m.emissive) pbr.emissiveFactor = m.emissive;
      if (m.emissiveStrength) pbr.emissiveStrength = m.emissiveStrength;
      this.materials.push({ name: m.name || ('mat' + this.materials.length), pbrMetallicRoughness: pbr, doubleSided: !!m.doubleSided });
      matIdx = this.materials.length - 1;
    }

    this.meshes.push({ name: o.name || ('mesh' + this.meshes.length), primitives: [{ attributes: attrs, indices, ...(matIdx >= 0 ? { material: matIdx } : {}) }] });
    const node = {
      name: o.name || ('node' + this.nodes.length),
      mesh: this.meshes.length - 1,
      ...(o.translation ? { translation: o.translation } : {}),
      ...(o.scale ? { scale: o.scale } : {}),
      ...(o.rotation ? { rotation: o.rotation } : {}),
    };
    this.nodes.push(node);
    return this.nodes.length - 1;
  }

  /** 包成 scene 并写出 */
  write(path) {
    const buffer = Buffer.concat(this.chunks.map((c) => c.data));
    const gltf = {
      asset: { version: '2.0', generator: 'zuel-campus glb-builder' },
      scene: 0,
      scenes: [{ nodes: this.nodes.map((_, i) => i) }],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: buffer.length }],
    };
    let json = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jpad = (4 - (json.length % 4)) % 4;
    if (jpad) json = Buffer.concat([json, Buffer.alloc(jpad, 0x20)]);
    const bin = buffer;
    const bpad = (4 - (bin.length % 4)) % 4;
    const binPadded = bpad ? Buffer.concat([bin, Buffer.alloc(bpad, 0)]) : bin;

    const total = 12 + 8 + json.length + 8 + binPadded.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    const jsonHdr = Buffer.alloc(8);
    jsonHdr.writeUInt32LE(json.length, 0);
    jsonHdr.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
    const binHdr = Buffer.alloc(8);
    binHdr.writeUInt32LE(binPadded.length, 0);
    binHdr.writeUInt32LE(0x004e4942, 4); // 'BIN'
    const out = Buffer.concat([header, jsonHdr, json, binHdr, binPadded]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, out);
    return { path, bytes: out.length, meshes: this.meshes.length, tris: this.accessors.filter((a) => a.type === 'SCALAR').reduce((s, a) => s + a.count, 0) / 3 };
  }
}

/** 校验 .glb 结构（magic/版本/块长度/JSON 可解析/accessor 边界） */
export function validateGlb(path, buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) return { ok: false, reason: 'magic' };
  const ver = buf.readUInt32LE(4), len = buf.readUInt32LE(8);
  if (ver !== 2) return { ok: false, reason: 'version' };
  if (len !== buf.length) return { ok: false, reason: `length ${len} != ${buf.length}` };
  const jl = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) return { ok: false, reason: 'json chunk type' };
  const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
  const binOff = 20 + jl;
  const bl = buf.readUInt32LE(binOff);
  const binLen = buf.length - binOff - 8;
  if (bl !== binLen) return { ok: false, reason: `bin length mismatch ${bl}/${binLen}` };
  let tris = 0;
  for (const m of json.meshes) for (const p of m.primitives) {
    const acc = json.accessors[p.indices];
    tris += acc.count / 3;
    const bv = json.bufferViews[acc.bufferView];
    if (bv.byteOffset + bv.byteLength > bl) return { ok: false, reason: 'accessor out of range' };
  }
  return { ok: true, meshes: json.meshes.length, materials: (json.materials || []).length, tris, bytes: buf.length };
}
