import * as THREE from 'three';
import { CFG } from '../config.js';

// 計画コースの表示：未建設スロットの半透明ゴースト、線、危険なカーブ、停止地点マーカー、区間テストの範囲。
const MAX = 3200;

export class PlanView {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(CFG.dominoW, CFG.dominoH, CFG.dominoT);
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false });
    this.ghost = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 2;
    const c = new THREE.Color('#fff');
    for (let i = 0; i < MAX; i++) this.ghost.setColorAt(i, c);
    scene.add(this.ghost);
    this.lines = new THREE.Group();
    scene.add(this.lines);
    this.timer = 0;
    this.visible = true;
    // 停止地点マーカー
    this.stopMarker = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 4), new THREE.MeshStandardMaterial({ color: '#ff2d55', emissive: '#ff2d55', emissiveIntensity: 0.8 }));
    cone.rotation.x = Math.PI; cone.position.y = 3;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 32), new THREE.MeshBasicMaterial({ color: '#ff2d55', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    this.stopMarker.add(cone, ring);
    this.stopMarker.visible = false;
    scene.add(this.stopMarker);
    // 描画中のストローク
    this.strokeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', linewidth: 2 }));
    this.strokeLine.renderOrder = 3;
    scene.add(this.strokeLine);
    this.portMarks = new THREE.Group();
    scene.add(this.portMarks);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this.selection = null;
  }

  setStroke(points, valid = true) {
    const arr = [];
    for (const p of points) arr.push(p.x, 0.35, p.z);
    this.strokeLine.geometry.dispose();
    this.strokeLine.geometry = new THREE.BufferGeometry();
    this.strokeLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    this.strokeLine.material.color.set(valid ? '#ffffff' : '#ff4d4d');
  }

  showStop(slot) {
    if (!slot) { this.stopMarker.visible = false; return; }
    this.stopMarker.visible = true;
    this.stopMarker.position.set(slot.x, slot.y || 0, slot.z);
  }

  /** 毎フレーム（軽量）：ゴーストは0.15秒ごとに更新 */
  update(dt, game) {
    this.timer -= dt;
    this.stopMarker.rotation.y += dt * 2;
    this.stopMarker.children[0].position.y = 3 + Math.sin(performance.now() * 0.006) * 0.4;
    this.portMarks.children.forEach((m) => { m.rotation.y += dt * 1.5; });
    if (this.timer > 0) return;
    this.timer = 0.15;
    const course = game.course;
    let n = 0;
    const editing = game.editMode !== 'play';
    const sel = this.selection;
    for (const sl of course.allSlots) {
      const hasStanding = sl.domino && !sl.domino.toppled;
      const selected = sel && sl.order >= sel.a && sl.order <= sel.b;
      if (hasStanding && !selected && !sl.warn) continue;
      if (n >= MAX) break;
      this._e.set(0, sl.yaw, 0);
      this._q.setFromEuler(this._e);
      this._p.set(sl.x, (sl.y || 0) + CFG.dominoH / 2, sl.z);
      const sc = hasStanding ? 1.08 : 1;
      this._s.set(sc, sc, sc);
      this._m.compose(this._p, this._q, this._s);
      this.ghost.setMatrixAt(n, this._m);
      const col = selected ? '#ffe066' : sl.warn ? '#ff4d4d' : sl.domino ? '#ffb4a8' : editing ? '#bfe6ff' : '#e8f6ff';
      this.ghost.setColorAt(n, this._c.set(col));
      n++;
    }
    this.ghost.count = n;
    this.ghost.instanceMatrix.needsUpdate = true;
    this.ghost.instanceColor.needsUpdate = true;
    if (this.linesVersion !== course.version) this.rebuildLines(course);
  }

  rebuildLines(course) {
    this.linesVersion = course.version;
    this.lines.clear();
    for (const s of course.segments) {
      if (s.slots.length < 2) continue;
      const arr = [];
      for (const sl of s.slots) arr.push(sl.x, (sl.y || 0) + 0.04, sl.z);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: s.to ? '#7cd4ff' : '#ffd166', dashSize: 0.4, gapSize: 0.3 }));
      l.computeLineDistances();
      this.lines.add(l);
    }
  }

  /** 線を引ける出口・つなげられる入口を光らせる */
  setPorts(outs, ins, ends) {
    this.portMarks.clear();
    const mk = (p, color) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color }));
      m.rotation.x = Math.PI / 2;
      m.position.set(p.x, 0.25, p.z);
      const g = new THREE.Group(); g.position.set(p.x, 0.25, p.z); m.position.set(0, 0, 0); g.add(m);
      this.portMarks.add(g);
    };
    outs.forEach((o) => mk(o.port, '#3cff8a'));
    ends.forEach((s) => { const l = s.slots[s.slots.length - 1]; mk(l, '#ffd166'); });
    ins.forEach((i) => mk(i.port, '#ff6bcb'));
  }
}
