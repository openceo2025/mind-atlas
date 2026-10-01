/**
 * Shaders for the knowledge galaxy. Everything is drawn as light on a near
 * black sky: points and lines add up where they are dense, so a branch reads
 * as a nucleus and a bundle of relations reads as a filament.
 *
 * Level of detail is measured in screen pixels per "unit" (the typical
 * distance between a note and its parent), so it behaves the same for a
 * notebook of ten notes and one of a thousand.
 *
 * The galaxy plane is z = 0 and the camera looks straight down -z; deeper
 * notes sit slightly behind it, which gives the map a little parallax.
 */

export const POINT_VERTEX = /* glsl */ `
attribute vec3 color;
attribute float aSize;
attribute float aMin;
attribute float aTier;
attribute float aSeed;
attribute float aStatus;
attribute float aHi;
attribute float aDim;
uniform float uTime;
uniform float uScale;
uniform float uDpr;
uniform float uUnit;
uniform float uFocus;
uniform float uReduced;
varying vec3 vColor;
varying float vAlpha;
varying float vStatus;
varying float vHi;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(1.0, -mv.z);
  float ppu = uUnit * uScale / d;
  float running = aStatus > 0.5 && aStatus < 1.5 ? 1.0 : 0.0;
  float breathe = 1.0 + (0.05 + running * 0.1) * sin(uTime * (0.8 + running * 2.4) + aSeed * 6.2832) * (1.0 - uReduced);
  float px = max(aSize * uScale / d, aMin) * breathe;
  px = min(px, 54.0) * (1.0 + aHi * 0.32);
  gl_PointSize = px * uDpr;
  float lod = 1.0;
  if (aTier > 2.5) lod = mix(0.16, 1.0, smoothstep(5.0, 15.0, ppu));
  else if (aTier > 1.5) lod = mix(0.45, 1.0, smoothstep(2.5, 8.0, ppu));
  float dim = mix(1.0, 0.13 + 0.87 * aHi, uFocus);
  vAlpha = lod * dim * aDim;
  vColor = color;
  vStatus = aStatus;
  vHi = aHi;
  gl_Position = projectionMatrix * mv;
}
`;

export const POINT_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uBlend;
uniform float uRings;
uniform float uReduced;
varying vec3 vColor;
varying float vAlpha;
varying float vStatus;
varying float vHi;
float band(float r, float inner, float outer) {
  return smoothstep(inner - 0.05, inner, r) * (1.0 - smoothstep(outer, outer + 0.05, r));
}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // A white-hot core inside a coloured corona with a long, soft falloff.
  float core = 1.0 - smoothstep(0.05, 0.2, r);
  float corona = exp(-r * r * 11.0) * 0.72 + exp(-r * r * 3.2) * 0.16;
  vec3 c = mix(vColor, vec3(1.0), core * 0.82);
  float a = core * 0.95 + corona;
  if (uRings > 0.01) {
    if (vStatus > 1.5 && vStatus < 2.5) {
      float beat = 0.55 + 0.45 * sin(uTime * 3.4) * (1.0 - uReduced);
      float ring = band(r, 0.62, 0.74) * uRings;
      c = mix(c, vec3(1.0, 0.33, 0.34), ring);
      a += ring * 0.85 * beat;
    } else if (vStatus > 2.5 && vStatus < 3.5) {
      float ring = band(r, 0.64, 0.74) * uRings;
      c = mix(c, vec3(1.0, 0.8, 0.36), ring * 0.9);
      a += ring * 0.6;
    }
  }
  if (vHi > 0.5) {
    float ring = band(r, 0.84, 0.9);
    c = mix(c, vec3(0.86, 0.95, 1.0), ring);
    a += ring * 0.55 * vHi;
  }
  gl_FragColor = vec4(c, a * vAlpha * uBlend);
}
`;

export const HUB_VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColorSeed; // rgb, seed
attribute vec3 iShape;     // world size, min px, kind (0 space, 1 branch)
attribute vec4 iMetrics;   // progress, risk, awaiting, running
attribute vec4 iState;     // highlight, dim, at risk, selected
uniform float uScale;
uniform float uFocus;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vMetrics;
varying float vAlpha;
varying float vSeed;
varying float vKind;
varying float vAtRisk;
varying float vSelected;
varying float vHi;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float d = max(1.0, -mv.z);
  float kind = iShape.z;
  float minWorld = iShape.y * d / uScale;
  // Up close a hub stays a landmark, not a wall.
  float maxWorld = (kind < 0.5 ? 210.0 : 118.0) * d / uScale;
  float size = min(max(iShape.x, minWorld), maxWorld) * (1.0 + iState.x * uFocus * 0.18);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vColor = iColorSeed.rgb;
  vSeed = iColorSeed.a;
  vMetrics = iMetrics;
  vKind = kind;
  vAtRisk = iState.z;
  vSelected = iState.w;
  vHi = iState.x;
  // A space's own halo steps back once you are inside the space.
  float lod = kind < 0.5 ? mix(0.4, 1.0, 1.0 - smoothstep(260.0, 900.0, iShape.x * uScale / d)) : 1.0;
  vAlpha = mix(1.0, 0.2 + 0.8 * iState.x, uFocus) * iState.y * lod;
}
`;

export const HUB_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uBlend;
uniform float uRings;
uniform float uReduced;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vMetrics;
varying float vAlpha;
varying float vSeed;
varying float vKind;
varying float vAtRisk;
varying float vSelected;
varying float vHi;
const float TAU = 6.28318530718;
float band(float r, float inner, float outer) {
  return smoothstep(inner - 0.012, inner, r) * (1.0 - smoothstep(outer, outer + 0.012, r));
}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float angle = atan(vUv.x, vUv.y);
  float turn = fract(angle / TAU + 1.0);
  float space = 1.0 - step(0.5, vKind);
  float running = min(3.0, vMetrics.w);
  float breathe = 1.0 + (0.05 + running * 0.03) * sin(uTime * (0.7 + running * 0.7) + vSeed * 6.0) * (1.0 - uReduced);
  float glow = exp(-r * r * mix(10.0, 15.0, 1.0 - space) / breathe) * mix(0.62, 0.92, space);
  float corona = exp(-r * r * 3.4) * mix(0.1, 0.2, space);
  float nucleus = exp(-r * r * 140.0) * 1.35;
  vec3 col = mix(vColor, vec3(1.0), nucleus * 0.8 + glow * 0.18);
  float a = glow + corona + nucleus;
  if (space > 0.5) {
    float rays = pow(abs(cos(angle * 2.0 + vSeed * 3.0)), 60.0) * (1.0 - smoothstep(0.02, 0.9, r)) * 0.42;
    rays += pow(abs(cos(angle * 6.0 + vSeed * 9.0)), 22.0) * (1.0 - smoothstep(0.04, 0.72, r)) * 0.16;
    a += rays * breathe;
  }
  if (uRings > 0.01 && vMetrics.x >= 0.0) {
    // Progress: a dim full track with the completed share lit in green.
    float ring = band(r, 0.52, 0.555) * uRings;
    float on = step(turn, vMetrics.x);
    col = mix(col, mix(vColor * 0.55, vec3(0.36, 0.95, 0.66), on), ring);
    a += ring * mix(0.2, 0.9, on);
  }
  if (uRings > 0.01 && vMetrics.y > 0.0) {
    // Risk: red, counter-clockwise from the top.
    float ring = band(r, 0.6, 0.625) * uRings;
    float on = step(1.0 - vMetrics.y, turn);
    col = mix(col, vec3(1.0, 0.36, 0.34), ring * on);
    a += ring * on * 0.85;
  }
  if (uRings > 0.01 && vMetrics.z > 0.5) {
    // People needed: amber satellites on a slow orbit.
    for (int i = 0; i < 5; i++) {
      if (float(i) >= vMetrics.z) break;
      float t = uTime * 0.22 * (1.0 - uReduced) + float(i) / max(1.0, vMetrics.z) * TAU + vSeed * 3.0;
      vec2 dot = vec2(sin(t), cos(t)) * 0.74;
      float s = (1.0 - smoothstep(0.02, 0.045, length(vUv - dot))) * uRings;
      col = mix(col, vec3(1.0, 0.8, 0.32), s);
      a += s;
    }
  }
  if (uRings > 0.01 && vAtRisk > 0.5) {
    float wave = fract(uTime * 0.42 * (1.0 - uReduced) + vSeed);
    float ring = band(r, 0.3 + wave * 0.6, 0.32 + wave * 0.6) * (1.0 - wave) * uRings;
    col = mix(col, vec3(1.0, 0.42, 0.36), ring);
    a += ring * 0.5;
  }
  if (vSelected > 0.5 || vHi > 0.5) {
    float ring = band(r, 0.86, 0.9);
    col = mix(col, vec3(0.88, 0.96, 1.0), ring);
    a += ring * 0.75 * max(vSelected, vHi);
  }
  gl_FragColor = vec4(col, a * vAlpha * uBlend);
}
`;

export const EDGE_VERTEX = /* glsl */ `
attribute vec3 color;
attribute vec4 aMeta;   // alpha, t (0 at source, 1 at target), tier, kind (0 tree, 1 typed flow, 2 candidate, 3 cross-space)
attribute vec2 aMeta2;  // length, seed
attribute vec3 aState;  // highlight, dim, agent speed
uniform float uScale;
uniform float uUnit;
uniform float uFocus;
varying vec3 vColor;
varying float vAlpha;
varying float vT;
varying float vKind;
varying float vLen;
varying float vSeed;
varying float vAgent;
varying float vHi;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(1.0, -mv.z);
  float ppu = uUnit * uScale / d;
  float tier = aMeta.z;
  float kind = aMeta.w;
  float lod = 1.0;
  if (kind > 2.5) lod = smoothstep(3.0, 9.0, ppu);                 // cross-space detail: rivers carry the far view
  else if (tier > 2.5) lod = mix(0.04, 1.0, smoothstep(6.0, 16.0, ppu));
  else if (tier > 1.5) lod = mix(0.35, 1.0, smoothstep(3.0, 9.0, ppu));
  float hi = aState.x;
  float dim = mix(1.0, 0.1 + 0.9 * hi, uFocus);
  vColor = color;
  vT = aMeta.y;
  vKind = kind;
  vLen = aMeta2.x;
  vSeed = aMeta2.y;
  vAgent = aState.z;
  vHi = hi;
  // A highlighted relation shows at every distance.
  vAlpha = aMeta.x * max(lod, hi) * dim * aState.y * (1.0 + hi * uFocus * 0.9);
  gl_Position = projectionMatrix * mv;
}
`;

export const EDGE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uBlend;
uniform float uUnit;
uniform float uReduced;
varying vec3 vColor;
varying float vAlpha;
varying float vT;
varying float vKind;
varying float vLen;
varying float vSeed;
varying float vAgent;
varying float vHi;
void main() {
  float motion = 1.0 - uReduced;
  float a = vAlpha;
  vec3 c = vColor;
  if (vKind < 0.5) {
    // Containment: one quiet pulse climbing from a note to its parent.
    float phase = fract(vT - uTime * 0.16 * motion + vSeed);
    float head = smoothstep(0.0, 0.05, phase) * (1.0 - smoothstep(0.05, 0.2, phase));
    a *= 0.72 + 0.9 * head * motion;
    c += vec3(0.5) * head * motion;
  } else {
    // Relations: waves of light travelling from source to target.
    float waves = max(1.0, vLen / (uUnit * 0.9));
    float phase = fract(vT * waves - uTime * 0.34 * motion + vSeed);
    float head = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.06, 0.26, phase));
    a *= 0.55 + 1.25 * head * motion;
    c += vec3(0.45) * head * motion;
    // Word candidates are dashed: suggested, not established.
    if (vKind > 1.5 && vKind < 2.5 && vHi < 0.5 && fract(vT * vLen / (uUnit * 0.12)) > 0.55) discard;
  }
  if (vAgent > 0.0) {
    float spark = fract(vT - uTime * 0.2 * vAgent * motion + vSeed);
    float s = smoothstep(0.0, 0.02, spark) * (1.0 - smoothstep(0.02, 0.07, spark));
    c += vec3(0.9, 0.96, 1.0) * s * 1.3;
    a += s * 0.5 * vAlpha;
  }
  gl_FragColor = vec4(c, a * uBlend);
}
`;

export const TERRITORY_VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute float iRadius;
uniform float uScale;
varying vec2 vUv;
varying vec3 vColor;
varying float vVisibility;
void main() {
  vec3 world = iPos + vec3(position.xy * iRadius * 2.0, -2.0);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float apparent = iRadius * uScale / max(1.0, -mv.z);
  // Strongest from afar, where a space is one patch of the map.
  vVisibility = mix(0.07, 1.0, 1.0 - smoothstep(160.0, 620.0, apparent));
  vUv = position.xy * 2.0;
  vColor = iColor;
}
`;

export const TERRITORY_FRAGMENT = /* glsl */ `
uniform float uBlend;
varying vec2 vUv;
varying vec3 vColor;
varying float vVisibility;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float body = (1.0 - smoothstep(0.0, 1.0, r)) * 0.55;
  float rim = smoothstep(0.86, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r)) * 0.14;
  gl_FragColor = vec4(vColor, (body * body + rim) * vVisibility * uBlend);
}
`;

export const RIVER_VERTEX = /* glsl */ `
attribute vec3 color;
attribute vec2 aRiver; // across (-1..1), along (0..1)
varying vec3 vColor;
varying vec2 vRiver;
void main() {
  vColor = color;
  vRiver = aRiver;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIVER_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uReduced;
varying vec3 vColor;
varying vec2 vRiver;
void main() {
  float across = abs(vRiver.x);
  float body = 1.0 - across * across;
  float core = 1.0 - smoothstep(0.0, 0.32, across);
  float current = 0.78 + 0.22 * sin((vRiver.y * 9.0 - uTime * 0.28 * (1.0 - uReduced)) * 6.28318);
  float ends = smoothstep(0.0, 0.1, vRiver.y) * (1.0 - smoothstep(0.9, 1.0, vRiver.y));
  float a = uOpacity * (body * 0.5 + core * 0.5) * current * ends;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.3), a);
}
`;
