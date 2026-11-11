"use client";

import { useEffect, useRef } from "react";

// Real CVE -> CWE -> CAPEC -> ATT&CK paths from our dataset, drawn as live attack paths on each side.
const PATHS = [
  ["CVE-2024-0001", "CWE-1188", "CAPEC-665", "T1211"],
  ["CVE-2024-0002", "CWE-287", "CAPEC-114", "T1548"],
  ["CVE-2024-0031", "CWE-20", "CAPEC-13", "T1574.006"],
  ["CVE-2024-0138", "CWE-862", "CAPEC-665", "T1211"],
  ["CVE-2024-0194", "CWE-434", "CAPEC-1", "T1574.010"],
  ["CVE-2024-0195", "CWE-94", "CAPEC-35", "T1027.006"],
];
// One colour per step of the chain: CVE, CWE, CAPEC, ATT&CK
const COLORS = ["#f5a524", "#f472b6", "#8b5cf6", "#14b8a6"];

// Flowing mesh gradient: blue, indigo and teal on the sides, a calm light centre for the text.
const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FRAGMENT = `
precision highp float;
uniform vec2 r;
uniform float t;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<5;k++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  vec2 p=uv*vec2(r.x/r.y,1.);
  float s=t*.045;
  vec2 q=vec2(fbm(p*1.3+s),fbm(p*1.3-s+4.3));
  float m=fbm(p*1.7+q*1.8+vec2(s*.7,-s*.5));
  vec3 cream=vec3(.988,.985,.975);
  vec3 sky=vec3(.40,.60,1.);
  vec3 indigo=vec3(.36,.33,.93);
  vec3 teal=vec3(.16,.80,.74);
  vec3 violet=vec3(.70,.47,.99);
  vec3 c=mix(sky,indigo,smoothstep(.25,.78,m));
  c=mix(c,teal,smoothstep(.55,.86,q.x)*.6);
  c=mix(c,violet,smoothstep(.45,.9,q.y)*(1.-uv.y)*.9);
  float side=abs(uv.x-.5)*2.;
  float glow=length((uv-vec2(.5,.56))*vec2(1.25,1.8));
  c=mix(cream,c,smoothstep(.12,.82,glow)*(.5+.5*side));
  c=mix(c,cream,smoothstep(.74,1.,uv.y)*.85);
  gl_FragColor=vec4(c,1.);
}`;

function startGradient(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
  if (!gl) return null; // the CSS gradient on <body> stays visible instead
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const res = gl.getUniformLocation(prog, "r");
  const time = gl.getUniformLocation(prog, "t");
  canvas.style.opacity = "1";
  return (t) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(res, canvas.width, canvas.height);
    gl.uniform1f(time, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

// Lay the chains out in two side bands; each node drifts around its home spot.
function layout(w, h) {
  const band = Math.min(w * 0.27, 440);
  const chains = PATHS.map((ids, i) => {
    const right = i % 2 === 1;
    const slot = Math.floor(i / 2);
    const top = h * (0.12 + slot * 0.27);
    return ids.map((id, j) => {
      const x = band * (0.16 + 0.21 * j) + Math.sin(i * 7 + j * 3) * band * 0.05;
      const y = top + (j % 2 ? 0.7 : 0.15) * h * 0.2 + Math.cos(i * 5 + j) * 14;
      return { id, kind: j, right, x: right ? w - x : x, y, phase: i * 1.7 + j * 2.3 };
    });
  });
  const dust = Array.from({ length: 80 }, (_, k) => {
    const right = k % 2 === 1;
    const x = Math.random() * band * 1.1;
    return { x: right ? w - x : x, y: Math.random() * h, speed: 6 + Math.random() * 14, size: 0.6 + Math.random() * 1.6 };
  });
  return { band, chains, dust };
}

export default function Backdrop() {
  const gradientRef = useRef(null);
  const graphRef = useRef(null);

  useEffect(() => {
    const bg = gradientRef.current;
    const fg = graphRef.current;
    const ctx = fg.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const drawGradient = startGradient(bg);
    const pointer = { x: -9999, y: -9999 };
    let w = 0, h = 0, dpr = 1, scene = null, frame = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      for (const c of [bg, fg]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      bg.width = Math.round(w * dpr * 0.5); // the gradient is soft, half resolution looks the same
      bg.height = Math.round(h * dpr * 0.5);
      scene = layout(w, h);
    }

    // 1 at the screen edge, fading to 0 towards the centre column
    const edgeFade = (x) => {
      const d = Math.min(x, w - x);
      return 1 - Math.min(1, Math.max(0, (d - scene.band * 0.7) / (scene.band * 0.5)));
    };

    function drawGraph(t) {
      const small = w < 760;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      for (const d of scene.dust) {
        const y = (((d.y - t * d.speed) % h) + h) % h;
        ctx.globalAlpha = edgeFade(d.x) * 0.55 * (small ? 0.5 : 1);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(d.x + Math.sin(t * 0.5 + y * 0.02) * 6, y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }

      scene.chains.forEach((chain, ci) => {
        const pts = chain.map((nd) => {
          let x = nd.x + Math.sin(t * 0.42 + nd.phase) * 9;
          let y = nd.y + Math.cos(t * 0.35 + nd.phase * 1.3) * 9;
          const dx = pointer.x - x, dy = pointer.y - y, dist = Math.hypot(dx, dy);
          const near = Math.max(0, 1 - dist / 160);
          x += dx * near * 0.12;
          y += dy * near * 0.12;
          return { ...nd, x, y, near };
        });
        const fade = edgeFade(pts[0].x) * (small ? 0.45 : 1);

        // Links of the attack path
        ctx.globalAlpha = 0.55 * fade;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 5]);
        ctx.lineDashOffset = -t * 18;
        ctx.beginPath();
        pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        ctx.setLineDash([]);

        // A pulse runs along the path: the exploit moving from bug to attacker action
        const u = ((t * 0.38 + ci * 0.7) % (pts.length + 0.8)) - 0.4;
        const at = (s) => {
          const k = Math.max(0, Math.min(pts.length - 1.001, s));
          const a = pts[Math.floor(k)], b = pts[Math.floor(k) + 1], f = k - Math.floor(k);
          return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, kind: Math.round(k) };
        };
        if (u >= 0 && u <= pts.length - 1) {
          for (let s = 0; s < 14; s++) {
            const p = at(u - s * 0.03);
            ctx.globalAlpha = fade * (1 - s / 14) * 0.9;
            ctx.fillStyle = COLORS[p.kind];
            ctx.shadowColor = COLORS[p.kind];
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.6 - s * 0.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        }

        // Nodes, lit up as the pulse passes or the pointer comes near
        pts.forEach((p, j) => {
          const lit = Math.max(p.near, Math.max(0, 1 - Math.abs(u - j) * 2));
          const r = 5 + lit * 3;
          ctx.globalAlpha = fade;
          ctx.shadowColor = COLORS[j];
          ctx.shadowBlur = 10 + lit * 18;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = COLORS[j];
          ctx.stroke();

          if (small) return;
          ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
          const tw = ctx.measureText(p.id).width;
          const lx = p.right ? p.x - r - 10 - tw - 12 : p.x + r + 10;
          ctx.globalAlpha = fade * (0.72 + lit * 0.28);
          ctx.fillStyle = "rgba(255,255,255,0.78)";
          ctx.beginPath();
          ctx.roundRect(lx, p.y - 10, tw + 12, 20, 10);
          ctx.fill();
          ctx.fillStyle = "#1b2140";
          ctx.fillText(p.id, lx + 6, p.y + 4);
        });
      });
    }

    function tick(now) {
      const t = now / 1000;
      drawGradient?.(t);
      drawGraph(t);
      if (!still) frame = requestAnimationFrame(tick);
    }

    const onMove = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; };
    const onLeave = () => { pointer.x = pointer.y = -9999; };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <>
      <canvas ref={gradientRef} className="backdrop gradient" aria-hidden="true" />
      <canvas ref={graphRef} className="backdrop graph" aria-hidden="true" />
    </>
  );
}
