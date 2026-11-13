import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';

/**
 * 描画（v0.3 で見直し）
 * - 色：sRGB 出力 ＋ Khronos PBR Neutral トーンマッピング（白飛び・色あせを抑え、玩具の色を鮮やかに）
 * - 環境光：室内 HDRI（Poly Haven「empty_play_room」）の映り込みのみ。ヘミライトは弱く
 * - 影：太陽（窓）光の PCF ソフトシャドウ ＋ N8AO（接地の陰）
 * - Bloom は既定で無し（白っぽくなる原因だった）。高画質のみ強い光源にだけ控えめに
 */
export const QUALITY = {
  low: { pixelRatio: 1, shadow: 1024, ao: false, bloom: false, dof: false, smaa: false, shadowRange: 40 },
  mid: { pixelRatio: 1, shadow: 2048, ao: true, aoHalf: true, bloom: false, dof: false, smaa: true, shadowRange: 55 },
  high: { pixelRatio: 1.5, shadow: 4096, ao: true, aoHalf: false, bloom: true, dof: true, smaa: true, shadowRange: 70 },
};

export class Renderer {
  constructor(canvas, scene, camera) {
    this.scene = scene; this.camera = camera;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(r);
    scene.environmentIntensity = 0.55;
    new RGBELoader().load(`${import.meta.env.BASE_URL}assets/hdri/empty_play_room_1k.hdr`, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = this.pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
    });
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
    const comp = (this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 })));
    this.ao = null; this.bokeh = null; this.bloom = null;
    if (Q.ao) {
      this.ao = new N8AOPass(this.scene, this.camera, w, h);
      this.ao.configuration.aoRadius = 1.6;
      this.ao.configuration.distanceFalloff = 0.6;
      this.ao.configuration.intensity = 2.2;
      this.ao.configuration.color = new THREE.Color('#1a0e06');
      this.ao.configuration.halfRes = !!Q.aoHalf;
      this.ao.configuration.gammaCorrection = false;
      this.ao.setQualityMode(Q.aoHalf ? 'Low' : 'Medium');
      comp.addPass(this.ao);
    } else comp.addPass(new RenderPass(this.scene, this.camera));
    if (Q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.3, 2.2); comp.addPass(this.bloom); }
    if (Q.dof) { this.bokeh = new BokehPass(this.scene, this.camera, { focus: 20, aperture: 0.0005, maxblur: 0.005 }); this.bokeh.enabled = false; comp.addPass(this.bokeh); }
    comp.addPass(new OutputPass());
    if (Q.smaa) comp.addPass(new SMAAPass(w * r.getPixelRatio(), h * r.getPixelRatio()));
    this.resize();
  }

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
    const step = ((this.shadowRange * 2) / this.shadowSize) * 4;
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
