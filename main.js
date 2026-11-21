// Rendering + interaction only. All geometry and every number shown here comes
// from src/core.mjs; this file never re-derives a contact decision.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  analyzeScenario, perturbScenario, signatureOf, toNumber, buildChain,
} from './src/core.mjs';

const scenarios = (await (await fetch('./data/scenarios.json')).json()).scenarios;
const reference = await (await fetch('./data/reference.json')).json();

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 40, 90);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
camera.position.set(13, 16, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 8, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x10141c, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(8, 18, 10);
scene.add(key);
const rim = new THREE.DirectionalLight(0x66aaff, 0.7);
rim.position.set(-12, 6, -14);
scene.add(rim);

const group = new THREE.Group();
scene.add(group);

function disposeGroup() {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    if (child.material) child.material.dispose();
  }
}

function build(scenarioIndex, round) {
  disposeGroup();
  const base = scenarios[scenarioIndex];
  const scenario = perturbScenario(base, round);
  const result = analyzeScenario(scenario);

  const bodyMat = [
    new THREE.MeshStandardMaterial({ color: 0x33415c, roughness: 0.55, metalness: 0.25 }),
    new THREE.MeshStandardMaterial({ color: 0x3e4f70, roughness: 0.55, metalness: 0.25 }),
  ];
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x7d8aa3, transparent: true, opacity: 0.55 });
  const loopMat = new THREE.LineBasicMaterial({ color: 0x4fe3c1 });
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });

  const { settled } = buildChain(scenario);
  settled.forEach((b, i) => {
    const w = toNumber(b.hx) * 2, h = toNumber(b.h), d = toNumber(b.hz) * 2;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, bodyMat[i % 2]);
    mesh.position.set(toNumber(b.cx), (toNumber(b.y0) + toNumber(b.y1)) / 2, toNumber(b.cz));
    mesh.rotation.y = Math.atan2(toNumber(b.s), toNumber(b.c));
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);
  });

  result.interfaces.forEach((it) => {
    if (it.manifoldPoints.length < 3) return;
    const y = toNumber(settled[it.index].y1) + 0.004;
    const pts = it.manifoldPoints.map((p) => new THREE.Vector3(toNumber(p.x), y, toNumber(p.z)));
    const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), loopMat);
    group.add(loop);
    for (const p of pts) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), dotMat);
      dot.position.copy(p);
      group.add(dot);
    }
  });

  const n = result.interfaces.length;
  const contained = result.interfaces.filter((it) => it.contains).length;
  const margins = result.interfaces.map((it) => it.margin).sort((a, b) => a - b);
  const sig = signatureOf(result);
  const refSig = reference.scenarios[scenarioIndex].signature;
  const same = round === 0 ? sig === refSig : null;

  document.getElementById('scName').textContent = base.id;
  document.getElementById('rName').textContent = String(round);
  document.getElementById('stats').innerHTML = `
    <div><span class="k">bodies</span> <span class="v">${result.bodies}</span>
         <span class="k">interfaces</span> <span class="v">${n}</span></div>
    <div><span class="k">CoM contained</span> <span class="v">${contained}/${n}</span>
         <span class="k">min margin</span> <span class="v">${margins[0].toFixed(4)}</span></div>
    <div><span class="k">median margin</span> <span class="v">${margins[Math.floor(n / 2)].toFixed(4)}</span></div>
    <div><span class="k">signature</span> <span class="${same === false ? 'warn' : 'v'}">${same === null ? 'perturbed round' : same ? 'node/browser match' : 'MISMATCH'}</span></div>`;
}

let sc = 0, round = 0;
build(sc, round);
document.getElementById('sc').addEventListener('input', (e) => { sc = +e.target.value; build(sc, round); });
document.getElementById('round').addEventListener('input', (e) => { round = +e.target.value; build(sc, round); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
