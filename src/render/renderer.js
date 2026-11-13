import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * 描画：環境マップ（光沢の映り込み）、やわらかい影、ポストプロセス（AO・ブルーム・被写界深度）。
 * 画質：low / mid / high
 */
export const QUALITY = {
  low: { pixelRatio: 1, shadow: 1024, ao: false, bloom: false, dof: false, shadowRange: 40 },
  mid: { pixelRatio: 1.25, shadow: 2048, ao: false, bloom: true, dof: false, shadowRange: 55 },
  high: { pixelRatio: 1.75, shadow: 4096, ao: true, bloom: true, dof: true, shadowRange: 70 },
};

export class Renderer {
  constructor(canvas, scene, camera) {
    this.scene = scene; this.camera = camera;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    this.dofFocus = 20;
    this.dofOn = false;
    this.setQuality('mid');
  }

  setQuality(q) {
    this.q = q;
    const Q = QUALITY[q];
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
    this.shadowSize = Q.shadow;
    this.shadowRange = Q.shadowRange;
    if (this.sun) this.applyShadow(this.sun);
    const w = window.innerWidth, h = window.innerHeight;
    const comp = (this.composer = new EffectComposer(r));
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null; this.bokeh = null; this.bloom = null;
    if (Q.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, w, h);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.8;
      this.ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1 });
      comp.addPass(this.ao);
    }
    if (Q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.4, 1.05);
      comp.addPass(this.bloom);
    }
    if (Q.dof) {
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 20, aperture: 0.0006, maxblur: 0.006 });
      this.bokeh.enabled = false;
      comp.addPass(this.bokeh);
    }
    comp.addPass(new OutputPass());
    this.resize();
  }

  /** ステージの太陽光の影を設定（影の範囲はカメラ注目点に追従させる） */
  useSun(sun) { this.sun = sun; this.applyShadow(sun); }
  applyShadow(sun) {
    sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    const c = sun.shadow.camera, R = this.shadowRange;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 400;
    c.updateProjectionMatrix();
  }
  followShadow(target, offset) {
    if (!this.sun) return;
    // テクセル単位にスナップして影のちらつきを防ぐ
    const step = (this.shadowRange * 2) / this.shadowSize * 4;
    const x = Math.round(target.x / step) * step, z = Math.round(target.z / step) * step;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + offset.x, offset.y, z + offset.z);
    this.sun.target.updateMatrixWorld();
  }

  setDof(on, focus) {
    if (!this.bokeh) return;
    this.bokeh.enabled = on;
    if (on) this.bokeh.uniforms.focus.value += (focus - this.bokeh.uniforms.focus.value) * 0.2;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }

  render() { this.composer.render(); }
  info() { const i = this.renderer.info.render; return { calls: i.calls, tris: i.triangles }; }
}
