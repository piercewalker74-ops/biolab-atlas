# Recipe — Cinematic Volumetric 3D Scene
### Reference build: "The Repair Engine" (BioLab Atlas hero, Part I)

A complete, reproducible teardown of how the scene was made. **Documentation only** —
no build, no governance edit, touches no constitution/palette/registry. This is the
spec for a post-audit promotion into the palette/library.

**Stack:** three.js `0.160.0` (ESM via importmap + `examples/jsm` addons), a single
`<canvas>`, two `gpt-image-1` PNG plates, ~640 lines of inline module script. No build
step, no bundler, no framework.

**Tag legend**
- **RELIABLE** — proven by use in this build; rebuildable cold from this doc.
- **NEEDS-ASSET** — reliable technique, but depends on a generated plate (gpt-image-1).
- **ASPIRATIONAL** — designed/specified here but not yet built or proven.

---

## 0. Scene skeleton & global config — RELIABLE

```js
renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // cap DPR=2 — the #1 perf lever
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;                     // see §6 bloom lesson
renderer.outputColorSpace = THREE.SRGBColorSpace;
camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
```

Layer order (z-index), bottom→top: `#scene` (canvas) → `#bokeh` (plate, screen blend)
→ `#grain` + `.vignette` (CSS overlays). The 3D is one layer; everything cinematic on
top of it is cheap CSS/compositing. **This split is the core idea** — the GPU draws the
volumetric core, the DOM does the film-grade atmosphere for free.

Tone mapping is **ACES Filmic**, not Linear. With emissive geometry this is what keeps
the midtones from clipping and gives the filmic roll-off. Exposure is the master dimmer.

---

## 1. Geometry

### 1.1 DNA double helix — RELIABLE

Parametric, not modeled. One function defines a point on either strand at fraction
`t ∈ [0,1]`; everything else samples it.

```js
const TURNS=5.2, RISE=26, RADIUS=3.05, N=120;       // N = length of the recA seq string
const twist = TURNS * Math.PI * 2;

function strandPt(t, s){                              // s = 0 | 1 (the two strands)
  const a = t*twist + (s ? 2.35 : 0);                // 2.35 rad groove offset → real B-DNA look
  const flare = breakFlare(t) * (s ? -1 : 1);        // strands pull APART across the break
  const r = RADIUS + flare*1.7;
  return new THREE.Vector3(Math.cos(a)*r, (t-0.5)*RISE, Math.sin(a)*r + flare*1.1);
}
```

- **Backbones**: for each strand, sample 161 points → `CatmullRomCurve3` →
  `TubeGeometry(curve, 420, 0.12, 12, false)`. 420 path segments, radius 0.12, 12 radial.
  Two tubes total. The 2.35-rad phase offset between strands is what reads as the
  major/minor groove — do not skip it, a 0.0 or π offset looks fake.
- **Base-pair rungs**: for each base `i`, a `CylinderGeometry(0.075,0.075,len,10,1,true)`
  (open-ended) between `strandPt(t,0)` and `strandPt(t,1)`, oriented with
  `quaternion.setFromUnitVectors(Y_up, dir.normalize())`. Color from the sequence (§2.2).
- **Phosphate nodes**: a shared `SphereGeometry(0.165,16,16)` instance placed at every
  backbone sample on both strands (240 of them).

> **Rebuild note:** the helix is built once at load and parented to a `helix` group that
> slow-spins (`helix.rotation.y += dt*0.10`). The geometry never regenerates per frame.

### 1.2 The break (radiation damage) — RELIABLE

A Gaussian "flare" band centered in the helix drives three coupled effects from one curve:

```js
const BREAK_A=0.40, BREAK_B=0.55;                    // shattered band, in t
function breakFlare(t){                               // 0 outside → 1 in the break
  const c=(BREAK_A+BREAK_B)/2, w=(BREAK_B-BREAK_A)*1.7;
  return Math.exp(-((t-c)/w)**2);
}
const inBreak = t => t>BREAK_A && t<BREAK_B;
```

1. **Strands flare apart** — `flare` widens `r` and offsets `z`, opposite-signed per
   strand, so the ladder visibly splits open at the break.
2. **Rungs vanish** — `if (inBreak(t)) continue;` skips rung creation in the band (the
   "missing base pairs"). ~18 of 120 rungs are absent.
3. **Shards** (next).

### 1.3 Shards — RELIABLE

26 `IcosahedronGeometry(0.12 + rand*0.16, 0)` (detail 0 = faceted) scattered around the
break, each cloned material so opacity/emissive can vary. Per-shard `userData`: a random
rotation axis, a `home` position, and a `drift` phase. Animated as slow orbital wobble
around `home` (sin/cos of `now`), plus constant spin. Cheap, reads as floating debris.

### 1.4 RecA repair filament — RELIABLE

A second, tighter, brighter helix threading the break — the "repair in progress."

```js
for(i in 0..120){
  t = BREAK_A-0.03 + (i/120)*((BREAK_B-BREAK_A)+0.06);
  a = t*twist*1.9 + 1.2;     // 1.9× the helix twist → visibly tighter coil
  r = 1.15;                  // inside the main helix radius
  pts.push(vec3(cos(a)*r, (t-0.5)*RISE, sin(a)*r));
}
recaTube = TubeGeometry(CatmullRom(pts), 200, 0.07, 10, false);  // additive shader, §2.4
```

Plus 34 small spheres ("motes") that travel the curve via `recaCurve.getPoint(u)` with
`u = (u0 + now*0.12) % 1`, scaled by `sin(u·π)` so they fade in/out at the ends. The
filament + motes are revealed at `T > 2.0s` in the intro timeline.

---

## 2. Shaders

### 2.1 Glassy fresnel backbone — RELIABLE

A `ShaderMaterial` (transparent) that is mostly transparent in the middle and bright at
grazing angles — reads as a glass ribbon, not a solid glowing tube.

```glsl
// vertex: pass normal (view space), view dir, and world-ish Y
vN = normalize(normalMatrix * normal);
vV = normalize(-(modelViewMatrix*vec4(position,1.)).xyz);
vY = position.y;
// fragment:
float f = pow(1. - max(dot(vN,vV),0.), 2.2);          // fresnel, exponent 2.2
float pulse = .7 + .3*sin(uTime*1.4 + vY*.4);          // slow length-wise shimmer
vec3 c = uColor * (.10 + 1.7*f) * pulse;               // .10 core (near-dark) + 1.7 rim
gl_FragColor = vec4(c, .34 + .6*f);                    // alpha also fresnel-driven
```

**Key uniforms:** `uColor` (a cool near-white, `#bfe9ff`), `uTime`.
**The tuning that matters:** core term `.10` + rim term `1.7`. An early version used
`.32 + 1.5*f` and the tube read as a solid light-stick that blew out under bloom (§6).
Rim-dominant = glass.

### 2.2 Base-pair coloring from the real recA sequence — RELIABLE

The rung colors are **data**, not decoration. The first 120 nt of the real
*D. radiodurans* recA coding sequence is embedded as a string; each rung's color is its
base.

```js
const SEQ = 'ATGAGCAAGGAC...';                         // real recA, 120 nt
const baseCol = b => b==='A'?COL.A : b==='T'?COL.T : b==='G'?COL.G : COL.C;
// COL.A=#2fe0cc teal, T=#5b8bff blue, G=#b08bf0 violet, C=#9fb4c6 slate
// rung material: MeshStandardMaterial({ color:col, emissive:col,
//   emissiveIntensity:0.95, roughness:.4, metalness:0, transparent:true, opacity:.95 })
```

No shader needed — standard material with `emissive=color`. The palette is the brand
A/T/G/C hues pushed luminous for a dark scene.

### 2.3 Transmission + iridescence crystals (RecA rings) — RELIABLE *(perf-heavy, see §7)*

`MeshPhysicalMaterial` with real refraction + thin-film iridescence. The repair machinery.

```js
new THREE.TorusKnotGeometry(rad, tube, 140, 18, 2, 3),
new THREE.MeshPhysicalMaterial({
  metalness:0, roughness:0.06,
  transmission:1, thickness:1.4, ior:1.7,                 // glass refraction
  iridescence:1, iridescenceIOR:1.9, iridescenceThicknessRange:[120,480],
  clearcoat:1, clearcoatRoughness:0.1,
  envMapIntensity:1.6, attenuationColor:tint, attenuationDistance:3
});
```

`transmission:1` is what makes it refract the background/env (NOT `opacity`). It requires
an environment (§4) to have anything to bend. **Cost:** each transmissive mesh triggers
an extra render of the scene to a transmission target per frame — 2 here. This is the
single most expensive material choice in the scene.

### 2.4 Additive filament shader — RELIABLE

The RecA tube uses `AdditiveBlending`, `depthWrite:false`, a traveling wave:

```glsl
float wave = sin(vUv.x*60. - uTime*4.)*.5 + .5;
gl_FragColor = vec4(uColor * (.45 + .55*wave) * 1.6, (.45+.55*wave)*.9);  // gold #f4bd5a
```

Additive + depthWrite-off is the generic recipe for any glowing energy thread; it never
occludes and always reads as light.

---

## 3. GPGPU particle system (the dust) — RELIABLE

`GPUComputationRenderer` ping-pongs particle **positions** in a float texture; a curl-noise
flow field advects them; a render `ShaderMaterial` reads that texture in its vertex shader.

### 3.1 Setup

```js
const WIDTH = 160;                 // texture is 160×160 → 25,600 particles
const gpu = new GPUComputationRenderer(WIDTH, WIDTH, renderer);
const dt0 = gpu.createTexture();   // seed: random points in a shell, .w = life seed
// fill dt0.image.data (RGBA float per texel): xyz = spawn pos, w = life ∈ [0,1]
const posVar = gpu.addVariable('texturePosition', positionFragmentShader, dt0);
gpu.setVariableDependencies(posVar, [posVar]);       // self-referential (reads its own prev)
posVar.material.uniforms.uTime  = { value:0 };
posVar.material.uniforms.uDelta = { value:0 };
posVar.wrapS = posVar.wrapT = THREE.RepeatWrapping;
gpu.init();                                           // returns an error string on failure — log it
```

Only **one** variable (position). Velocity is computed analytically from curl noise each
step rather than stored — halves the texture bandwidth and avoids a 2nd ping-pong target.

### 3.2 The simulation shader (per particle, per frame)

```glsl
// 1. read prev state
vec4 s = texture2D(texturePosition, uv); vec3 p = s.xyz; float life = s.w;
// 2. curl-noise flow (divergence-free → swirls, never collapses to points)
vec3 flow = curl(p*0.05 + vec3(0., uTime*0.04, 0.)) * 2.2;
flow.y += 0.5;                                         // gentle global rise
// 3. attraction toward the break (origin): smoothstep ramps pull on by distance
vec3 toC = -p; float d = length(toC)+.001;
flow += normalize(toC) * smoothstep(40., 8., d) * 1.4;   // strong near, off far
// 4. integrate + age
p += flow * uDelta;  life -= uDelta*0.06;
// 5. respawn when dead or escaped (deterministic from uv → no Math.random in GLSL)
if(life<0. || length(p)>46.){ p = reseedShell(uv); life = 1.; }
gl_FragColor = vec4(p, life);
```

**Curl noise = THE gotcha.** Curl of a scalar is meaningless; you need a **vec3
potential** field, then finite-difference its curl:

```glsl
vec3 snoiseVec3(vec3 x){ return vec3(
  noise(x),
  noise(vec3(x.y-19.1, x.z+33.4, x.x+47.2)),          // decorrelated offsets
  noise(vec3(x.z+74.2, x.x-124.5, x.y+99.4))); }
vec3 curl(vec3 p){ float e=.6; vec3 dx=vec3(e,0,0),dy=vec3(0,e,0),dz=vec3(0,0,e);
  vec3 x0=snoiseVec3(p-dx),x1=snoiseVec3(p+dx);
  vec3 y0=snoiseVec3(p-dy),y1=snoiseVec3(p+dy);
  vec3 z0=snoiseVec3(p-dz),z1=snoiseVec3(p+dz);
  return normalize(vec3(
    (y1.z-y0.z)-(z1.y-z0.y),
    (z1.x-z0.x)-(x1.z-x0.z),
    (x1.y-x0.y)-(y1.x-y0.x)) / (2.*e) + 1e-5); }
```

`noise()` is a standard gradient/value noise (8 corner hashes + trilinear). **First
attempt wrote `noise(p+dy).z` — treating a float as a vec3 → silent shader-compile
failure, blank scene.** This cost a debug cycle; see §8.

### 3.3 The render pass

Geometry is a `BufferGeometry` of `PCOUNT` vertices carrying a `ref` attribute (the
particle's texel UV) and a `rnd` attribute. The vertex shader looks up its position:

```glsl
vec4 s = texture2D(texturePosition, ref); vec3 p = s.xyz;     // <-- position from sim texture
float tw = .6 + .4*sin(uTime*2. + rnd*30.);                   // twinkle
gl_PointSize = uSize*(.18+.5*rnd)*tw / (-mv.z);               // perspective size attenuation
// fragment: soft round sprite via smoothstep(.5,0,dist), AdditiveBlending, depthWrite:false
```

`uSize = innerHeight * 0.05` (recompute on resize). One draw call for all 25,600 points.

---

## 4. Compositing & depth — reads as volumetric

### 4.1 Environment / reflection map (gpt-image-1 plate) — NEEDS-ASSET

```js
texLoader.load('assets/plate-env.png', tex => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.environment = pmrem.fromEquirectangular(tex).texture;   // PMREM → IBL for crystals
  // distant parallax backdrop: a big BackSide sphere using the same texture
  bg = Mesh(SphereGeometry(120,40,24),
            MeshBasicMaterial({ map:tex, side:THREE.BackSide, color:0x2a3a47, depthWrite:false }));
});
```

The plate does double duty: (a) `PMREMGenerator` turns it into the image-based-lighting
env that the transmission crystals refract/reflect; (b) it's mapped onto a 120-radius
backdrop sphere that slow-spins for parallax. The plate is **not a true 360° equirect** —
the reflections are approximate but pleasing; tag NEEDS-ASSET because the look depends on
the generated plate existing.

### 4.2 Bokeh foreground (gpt-image-1 plate) — NEEDS-ASSET

A DOM layer, not 3D:

```css
#bokeh{ position:fixed; inset:-8%; z-index:1;
  background:url("assets/plate-bokeh.png") center/cover;
  mix-blend-mode:screen; opacity:.42; }     /* screen blend → blacks drop out, orbs glow */
```

Parallaxed against pointer movement: `transform: translate(-mx*26px, -my*22px)`. Because
it's `screen`-blended over the canvas, the dark plate background is invisible and only the
teal/amber orbs composite in — instant depth-of-field foreground for ~0 GPU cost.

### 4.3 The volumetric read = three depth bands

1. **Far:** backdrop sphere (env plate) — slow parallax.
2. **Mid:** the 3D scene (helix, crystals, dust) — full camera orbit + DPR.
3. **Near:** bokeh DOM layer — pointer parallax, screen blend.

Camera does auto-orbit + dolly-in intro + breathing + pointer parallax + drag, all eased
(`cur += (tgt-cur)*0.05`). The three bands moving at different rates is what sells volume.

---

## 5. Lighting — RELIABLE

```js
AmbientLight(0x35506a, 0.7);
DirectionalLight(0xcfeaff, 1.5)  @ (6,10,8)    // cool key
DirectionalLight(0x4f6c86, 1.1)  @ (-8,-4,-6)  // rim
PointLight(0x2fe0cc, 11, 30, 2)                // teal, orbits the break
PointLight(0xf4bd5a,  9, 26, 2)                // gold, orbits the break
```

The two point lights orbit the break on lissajous paths (`sin/cos` of `now`), so the
specular highlights crawl across the crystals and rungs — cheap motion-in-stillness.
*(Point-light intensities were 18/14 first; dropped to 11/9 as part of the bloom fix.)*

---

## 6. Grade stack (EffectComposer) — RELIABLE

Chain order: `RenderPass → UnrealBloomPass → custom GradePass`.

```js
bloom = new UnrealBloomPass(vec2(w,h), 0.66, 0.55, 0.55);   // strength, radius, THRESHOLD
// GradePass (full-screen quad):
vec2 d = vUv-.5; float r2 = dot(d,d);
vec2 off = d * uAberr * (1. + r2*2.);                       // uAberr = 0.0016, radial CA
c.r = tex(vUv+off).r; c.g = tex(vUv).g; c.b = tex(vUv-off).b;
float vig = smoothstep(1.05, 0.35, r2*2.0);
c *= mix(.72, 1.05, vig);                                   // vignette
c = pow(c, vec3(.96));                                      // tiny lift
```

ACES tone mapping happens on the renderer (before composer), exposure 1.04.

### 6.1 The bloom-tuning lesson (load-bearing)

**First pass:** `UnrealBloom(0.95, 0.62, 0.0)` + exposure `1.12` + backbone core `.32`
+ rung emissive `1.25` + point lights `18/14`. Result: the **upper helix blew to flat
white** — base-pair colors and the double-strand ladder were gone, just a glowing blob.

**Root cause:** bloom **threshold 0.0** means *every* lit pixel blooms; with emissive
geometry the whole helix is "highlight," so it all halates and merges.

**The fix (five coupled knobs, not one):**
| knob | before → after | effect |
|---|---|---|
| bloom threshold | 0.0 → **0.55** | only the brightest cores bloom; midtones stay crisp |
| bloom strength | 0.95 → **0.66** | less halo spread |
| exposure | 1.12 → **1.04** | pulls the whole image off the clip ceiling |
| backbone core | `.32+1.5f` → **`.10+1.7f`** | tube goes dark-core/bright-rim (glass, not stick) |
| rung emissive / lights | 1.25→0.95 / 18,14→11,9 | fewer pixels above threshold |

**Generalizable law:** *with emissive geometry, bloom threshold 0 is a trap.* Raise the
threshold to gate bloom to genuine highlights and let ACES hold the midtones; tune
emissive **down** in concert so structure survives the glow.

---

## 7. Performance profile & graceful degradation

### 7.1 Measured cost (this build, as written)

| cost center | count | note |
|---|---|---|
| Draw calls | **~410** | dominated by **un-instanced** meshes: 240 nodes + ~102 rungs + 26 shards + 34 motes |
| Particles | 25,600 | **1 draw call**, additive |
| GPGPU compute | 1 pass / frame | 160×160; curl does **18 `noise()` evals/particle** (6× `snoiseVec3` × 3) — the heaviest kernel |
| Transmission | **2 meshes** | each = an extra full-scene render to a transmission target |
| Bloom | 1 pass | multi-mip gaussian (≈5 blur levels) |
| GradePass | 1 pass | cheap (3 taps + math) |
| DPR | capped at 2 | quadratic fill-rate driver |

**Headline:** the framerate killers on weak hardware are, in order: (1) **DPR/fill-rate**,
(2) the **2 transmission passes**, (3) the **curl-noise kernel** at 25.6k, (4) **~410 draw
calls** from not instancing. The polygon count itself is trivial.

### 7.2 Graceful-degradation ladder — ASPIRATIONAL (specified, not built)

Detect tier once at load (UA mobile test + `devicePixelRatio` + an optional 30-frame FPS
probe), then pick a level:

- **HIGH (desktop/dGPU):** as shipped. DPR 2, 25.6k particles, 2 transmission crystals,
  full bloom.
- **MEDIUM (laptop iGPU / high-end phone):**
  - DPR → `min(dpr, 1.5)`.
  - Particles `WIDTH 160 → 96` (≈9.2k).
  - Crystals: **drop `transmission`**, swap to `MeshStandardMaterial` with `envMap` +
    emissive fresnel (keeps the iridescent *look*, kills the extra scene render).
  - Bloom resolution halved.
  - **Instance** nodes/rungs/shards/motes via `InstancedMesh` → ~410 draws collapse to ~5.
    *(This is the single highest-ROI optimization and should arguably be done at all tiers.)*
- **LOW (budget phone):**
  - DPR 1, particles `WIDTH 48` (≈2.3k) or off.
  - No transmission, no bloom (or a cheap single-pass additive glow).
  - Helix backbone as a solid emissive tube (drop the fresnel alpha blend).
- **2.5D-SAFE fallback (no WebGL2 / no float render target / FPS probe fails):**
  Render **none** of the 3D. Show a **pre-baked still** of the hero (a captured frame or
  a gpt-image-1 plate) as a CSS background, keep the `#bokeh` + `#grain` + `.vignette`
  layers, and add a pointer-parallax tilt on the still + bokeh. The composited-depth
  trick (§4.3) still reads as volumetric with zero shaders. This is the phone-safe floor.

### 7.3 Capability gates to check before HIGH

- `renderer.capabilities.isWebGL2` (GPUComputationRenderer wants WebGL2).
- Float **render-target** support. On many phones only **half-float** is renderable —
  set the compute target to `HalfFloatType`. Caveat: half-float position precision near
  ±40 units is ~0.03, which can show as faint particle stepping; keep the sim volume
  smaller on mobile to stay in good precision range.
- `MeshPhysicalMaterial.transmission` needs `scene.environment` set or the crystals are
  black — gate crystals behind "env plate loaded."

---

## 8. Gotchas that will bite a rebuild

1. **Curl noise needs a vec3 potential.** `noise()` returns a float; `noise(p).z` is a
   compile error and three logs it as a shader-validation failure with a *blank scene* and
   no JS exception. Build `snoiseVec3` (3 decorrelated samples) first. *(§3.2)*
2. **Bloom threshold 0 + emissive = white-out.** The whole §6.1 lesson. Budget a tuning
   pass; it's five coupled knobs, not one slider.
3. **Headless swiftshader ≠ real GPU.** QA in headless Chromium falls back to software
   WebGL (deprecation warning, needs `--enable-unsafe-swiftshader`), and it
   **under-renders transmission and bloom** and throws `ReadPixels` GPU-stall warnings.
   Screenshots there *understate* the scene — judge final look on a real GPU, but trust
   headless for *structure/compile* checks. Don't tune bloom from swiftshader output.
4. **MCP console logs accumulate across navigations.** A stale shader error persisted
   after the fix and looked like the fix failed — `clear:true` the logs (or re-confirm the
   served file) before trusting an error.
5. **Transmission is the hidden 2× render.** Two crystals = two extra scene renders/frame.
   It's the first thing to cut on mobile, not the particles.
6. **importmap pin.** addons (`EffectComposer`, `UnrealBloomPass`, `GPUComputationRenderer`)
   must come from the **same** `three@0.160.0` path as the core, or you get dual-instance
   `THREE` bugs. Pin both.
7. **Un-instanced mesh sprawl.** 240 nodes + 102 rungs as individual `Mesh`es works but is
   ~400 draw calls; fine on desktop, the first mobile bottleneck after fill-rate. Instance
   them.
8. **DPR is quadratic.** `setPixelRatio(min(dpr,2))` is already the cap; on mobile drop to
   1.5 or 1 before touching anything else — it's the cheapest big win.
9. **Windows env:** `ImageMagick convert` is shadowed by the Windows `convert.exe` (disk
   tool) — use Python PIL for the asset-gate quadrant crops. Bash tool cwd persists across
   calls (a `cd assets` earlier broke later relative paths). CRLF warnings on commit are
   benign.

---

## 9. Promotion checklist (for the post-audit palette/library entry)

- [ ] Extract `strandPt`/`breakFlare` as a parametric-helix primitive (params: turns,
      rise, radius, groove offset, break band).
- [ ] Extract the GPGPU curl-dust as a self-contained module (inputs: count, flow scale,
      attractor position+strength, bounds) with the `snoiseVec3`/`curl` baked in.
- [ ] Extract the GradePass (CA + vignette + lift) as a reusable `ShaderPass`.
- [ ] Ship the tier detector + degradation ladder (§7.2) as part of the primitive, with
      the **2.5D-safe still** fallback mandatory.
- [ ] Document the two plates as NEEDS-ASSET dependencies with their gpt-image-1 prompts
      (`tools/genplate.mjs`) and the gate (quadrant-crop @100%).
- [ ] Bake in the bloom law (§6.1) as a default: ACES + threshold ≥ 0.5 for emissive scenes.

*End of recipe. Documentation only — no code, palette, or registry was changed.*
