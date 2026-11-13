"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// The knowledge graph drawn as 9,000 dots. Each colour is one layer of the chain:
// bugs (CVE) on the outer shell, attacker actions (ATT&CK) at the core.
const LAYERS = [
  { color: "#f59e0b", share: 0.46, shell: 2.15, column: -2.7 }, // CVE: specific bugs
  { color: "#ec4899", share: 0.2, shell: 1.6, column: -0.9 },   // CWE: the coding mistakes
  { color: "#8b5cf6", share: 0.17, shell: 1.1, column: 0.9 },   // CAPEC: how attacks work
  { color: "#14b8a6", share: 0.17, shell: 0.62, column: 2.7 },  // ATT&CK: what attackers do
];
const COUNT = 9000;

// Two positions for every dot: on its sphere shell, and in its column of the left-to-right chain
function buildShapes() {
  const sphere = new Float32Array(COUNT * 3);
  const chain = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const golden = Math.PI * (3 - Math.sqrt(5)); // spreads points evenly over a sphere
  let i = 0;
  LAYERS.forEach((layer, li) => {
    const n = li === LAYERS.length - 1 ? COUNT - i : Math.round(COUNT * layer.share);
    const c = new THREE.Color(layer.color);
    for (let k = 0; k < n; k++, i++) {
      const y = 1 - (k / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y) * layer.shell;
      sphere.set([Math.cos(golden * k) * r, y * layer.shell, Math.sin(golden * k) * r], i * 3);
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * (0.55 + layer.share * 1.6);
      chain.set([layer.column + (Math.random() - 0.5) * 0.18, Math.sin(a) * d, Math.cos(a) * d], i * 3);
      colors.set([c.r, c.g, c.b], i * 3);
      seeds[i] = Math.random();
    }
  });
  return { sphere, chain, colors, seeds };
}

// Runs on the graphics card for every dot: blends sphere -> chain and adds a gentle wobble
const VERTEX = `
uniform float uTime, uMorph, uPixel;
attribute vec3 aChain;
attribute float aSeed;
varying vec3 vColor;
void main() {
  float m = smoothstep(aSeed * 0.35, 0.65 + aSeed * 0.35, uMorph); // dots move one after another
  vec3 p = mix(position, aChain, m);
  p += 0.035 * vec3(sin(uTime * 0.8 + aSeed * 40.0), cos(uTime * 0.7 + aSeed * 31.0), sin(uTime * 0.6 + aSeed * 23.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * (2.2 + aSeed * 2.4) * (6.0 / -mv.z);
  vColor = color;
}`;

// Draws each dot as a soft round point
const FRAGMENT = `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, smoothstep(0.5, 0.15, d) * 0.8);
}`;

// shape="scroll": scrolling the page turns the sphere into the chain. hidden: fade the dots out.
export default function Backdrop({ shape = "sphere", hidden = false }) {
  const mount = useRef(null);

  useEffect(() => {
    const el = mount.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL on this computer: keep only the CSS gradient instead of crashing the page
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    const { sphere, chain, colors, seeds } = buildShapes();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sphere, 3));
    geometry.setAttribute("aChain", new THREE.BufferAttribute(chain, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const uniforms = { uTime: { value: 0 }, uMorph: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } };
    const material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, vertexColors: true,
    });
    const dots = new THREE.Points(geometry, material);
    scene.add(dots);

    function resize() {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.position.z = window.innerWidth < 700 ? 10.5 : 7; // further back on phones so it fits
      camera.updateProjectionMatrix();
    }

    // Where the animation should go; each frame moves a little toward these (smooth easing)
    const goal = { tiltX: 0, turnY: 0, morph: 0 };
    let scale = 2.4; // starts spread out, gathers into the sphere
    const onMove = (e) => {
      goal.tiltX = (e.clientY / window.innerHeight - 0.5) * 0.35;
      goal.turnY = (e.clientX / window.innerWidth - 0.5) * 0.6;
    };
    const onScroll = () => {
      if (shape === "scroll") goal.morph = Math.min(1, window.scrollY / (window.innerHeight * 1.2));
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let frame = 0;
    function tick() {
      const t = clock.getElapsedTime();
      scale += (1 - scale) * 0.04;
      dots.scale.setScalar(still ? 1 : scale);
      dots.rotation.x += (goal.tiltX - dots.rotation.x) * 0.05;
      dots.rotation.y += (t * 0.06 + goal.turnY - dots.rotation.y) * 0.05;
      uniforms.uMorph.value += (goal.morph - uniforms.uMorph.value) * 0.06;
      uniforms.uTime.value = t;
      renderer.render(scene, camera);
      if (!still) frame = requestAnimationFrame(tick);
    }

    resize();
    tick();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("scroll", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
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
