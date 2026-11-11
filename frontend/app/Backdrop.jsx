"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// The knowledge graph as particles. Each colour is one layer of the chain: CVE, CWE, CAPEC, ATT&CK.
const LAYERS = [
  { color: "#f59e0b", share: 0.46, shell: 2.15, column: -2.7 }, // CVE: specific bugs (outer shell)
  { color: "#ec4899", share: 0.2, shell: 1.6, column: -0.9 },   // CWE: the coding mistakes
  { color: "#8b5cf6", share: 0.17, shell: 1.1, column: 0.9 },   // CAPEC: how attacks work
  { color: "#14b8a6", share: 0.17, shell: 0.62, column: 2.7 },  // ATT&CK: what attackers do (core)
];
const COUNT = 9000;


// Shape A, "sphere": nested shells, bugs outside, attacker actions at the core.
// Shape B, "chain": four discs left to right, the path a bug takes to an attacker action.
function buildShapes() {
  const sphere = new Float32Array(COUNT * 3);
  const chain = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let i = 0;
  LAYERS.forEach((layer, li) => {
    const n = li === LAYERS.length - 1 ? COUNT - i : Math.round(COUNT * layer.share);
    const c = new THREE.Color(layer.color);
    for (let k = 0; k < n; k++, i++) {
      const y = 1 - (k / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * k;
      const jitter = 1 + (Math.random() - 0.5) * 0.06;
      sphere.set([Math.cos(th) * r * layer.shell * jitter, y * layer.shell * jitter, Math.sin(th) * r * layer.shell * jitter], i * 3);
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * (0.55 + layer.share * 1.6);
      chain.set([layer.column + (Math.random() - 0.5) * 0.18, Math.sin(a) * d, Math.cos(a) * d], i * 3);
      colors.set([c.r, c.g, c.b], i * 3);
      seeds[i] = Math.random();
    }
  });
  return { sphere, chain, colors, seeds };
}

const VERTEX = `
uniform float uTime, uMorph, uPixel, uPulse;
attribute vec3 aChain;
attribute float aSeed; // "color" is declared by three.js because vertexColors is on
varying vec3 vColor;
varying float vFade;
void main() {
  // each particle starts its morph a little later than the last, so the shape flows instead of jumping
  float m = smoothstep(aSeed * 0.35, 0.65 + aSeed * 0.35, uMorph);
  vec3 p = mix(position, aChain, m);
  p += 0.035 * vec3(sin(uTime * 0.8 + aSeed * 40.0), cos(uTime * 0.7 + aSeed * 31.0), sin(uTime * 0.6 + aSeed * 23.0));
  p *= 1.0 + uPulse * 0.06 * sin(aSeed * 6.28 + uTime * 4.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * (2.2 + aSeed * 2.4) * (6.0 / -mv.z);
  vColor = color;
  vFade = smoothstep(9.0, 4.0, -mv.z);
}`;

const FRAGMENT = `
varying vec3 vColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d) * (0.35 + 0.55 * vFade);
  gl_FragColor = vec4(vColor, a);
}`;

// `hidden` fades the particle sphere out, e.g. while a chat is on screen, so text stays clean
export default function Backdrop({ shape = "sphere", hidden = false }) {
  const mount = useRef(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const el = mount.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Without WebGL (old GPU, blocked driver, some remote desktops) keep only the CSS glow
    // instead of throwing, which would blank the whole page.
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.set(0, 0, 7);

    const { sphere, chain, colors, seeds } = buildShapes();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sphere, 3));
    geometry.setAttribute("aChain", new THREE.BufferAttribute(chain, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const uniforms = {
      uTime: { value: 0 }, uMorph: { value: shape === "chain" ? 1 : 0 },
      uPixel: { value: renderer.getPixelRatio() }, uPulse: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    const group = new THREE.Group();
    group.add(points);
    scene.add(group);

    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Pull the camera back on narrow screens so the whole shape stays visible
      camera.position.z = w < 700 ? 10.5 : 7;
      camera.updateProjectionMatrix();
    }
    resize();

    // Entrance: particles gather from a wide cloud into the shape
    group.scale.setScalar(still ? 1 : 2.4);
    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: still ? 0 : 2.4, ease: "expo.out" });

    // The pointer tilts the shape a little, smoothed by GSAP
    const tiltX = gsap.quickTo(group.rotation, "x", { duration: 1.2, ease: "power3.out" });
    const offsetY = gsap.quickTo(points.rotation, "y", { duration: 1.2, ease: "power3.out" });
    const onMove = (e) => {
      tiltX((e.clientY / window.innerHeight - 0.5) * 0.35);
      offsetY((e.clientX / window.innerWidth - 0.5) * 0.6);
    };

    // On pages with sections, scrolling turns the sphere into the CVE -> ATT&CK chain
    let trigger = null;
    if (shape === "scroll") {
      trigger = ScrollTrigger.create({
        start: 0, end: () => window.innerHeight * 1.2, scrub: 1.2,
        onUpdate: (self) => { uniforms.uMorph.value = self.progress; },
      });
    }

    // Other components ask for a pulse, e.g. when an answer arrives
    const onPulse = () => gsap.fromTo(uniforms.uPulse, { value: 1 }, { value: 0, duration: 1.6, ease: "power2.out" });
    const onShape = (e) => gsap.to(uniforms.uMorph, { value: e.detail === "chain" ? 1 : 0, duration: 2.2, ease: "power3.inOut" });

    let frame = 0;
    const clock = new THREE.Clock();
    function tick() {
      const t = clock.getElapsedTime();
      uniforms.uTime.value = t;
      group.rotation.y = t * 0.06 * (1 - uniforms.uMorph.value * 0.9);
      renderer.render(scene, camera);
      if (!still) frame = requestAnimationFrame(tick);
    }
    tick();

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("graph:pulse", onPulse);
    window.addEventListener("graph:shape", onShape);
    return () => {
      cancelAnimationFrame(frame);
      trigger?.kill();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("graph:pulse", onPulse);
      window.removeEventListener("graph:shape", onShape);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [shape]);

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-mesh" />
      <div ref={mount} className={hidden ? "backdrop-gl hidden" : "backdrop-gl"} />
    </div>
  );
}
