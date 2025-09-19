import * as BABYLON from "babylonjs";

// Shared fisheye distortion GLSL snippet applied after world * position
// Distorts along local X axis for column mode or local Y axis for row mode by scaling offsets from instance center.
// focusCol / focusRow < 0 disables the effect.

BABYLON.Effect.ShadersStore["heatmapFisheyeVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
attribute vec4 world0; // thin instance world matrix columns
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute float colIndex; // per-instance column index
attribute float rowIndex; // per-instance row index
uniform mat4 viewProjection;
uniform int fisheyeMode; // 0 = column, 1 = row, else disabled
uniform float focusCol;
uniform float focusRow;
uniform float sigma;      // gaussian sigma in index units
uniform float scaleMax;   // scale at focus
uniform float scaleMin;   // scale far away
uniform int useWarp;      // if 1, sample remapped center & scale from LUTs
uniform sampler2D warpCenters; // 1D texture storing remapped centers (normalized -1..1 domain)
uniform sampler2D warpScales;  // 1D texture storing local scale factors per index
uniform float indexCount;      // number of columns or rows depending on mode
varying vec4 vColor;

// Gaussian weight
float weight(float d, float s) {
    return exp(-0.5 * (d / s) * (d / s));
}

void main(void) {
    mat4 world = mat4(world0, world1, world2, world3);
    vec4 worldPos4 = world * vec4(position, 1.0);
    vec3 center = world3.xyz; // translation
    vec3 worldPos = worldPos4.xyz;
    // Basis vectors (not normalized if non-uniform scale present)
    vec3 axisX = world0.xyz; 
    vec3 axisY = world1.xyz;
    // Normalize for projection (avoid division by zero)
    float lenX = length(axisX); if (lenX < 1e-6) axisX = vec3(1.0,0.0,0.0); else axisX /= lenX;
    float lenY = length(axisY); if (lenY < 1e-6) axisY = vec3(0.0,1.0,0.0); else axisY /= lenY;

    if (useWarp == 1 && indexCount > 0.0) {
        // Warp mode uses precomputed, collision-free center mapping & local scale
        if (fisheyeMode == 0 && focusCol >= 0.0) {
            float t = (colIndex + 0.5) / indexCount; // sample coordinate
            float newCenterNorm = texture2D(warpCenters, vec2(t, 0.0)).r; // -1..1 normalized
            float localScale = texture2D(warpScales, vec2(t, 0.0)).r;      // scale factor for width
            // Reconstruct axis center from normalized coordinate along X axis length (use angle-agnostic linear span)
            vec3 offset = worldPos - center;
            float projX = dot(offset, axisX);
            vec3 rem = offset - projX * axisX;
            projX *= localScale;
            // Shift center along axisX by difference between projected center and new center (approx remap)
            float currentNorm = (colIndex + 0.5) / indexCount * 2.0 - 1.0; // original normalized center
            float deltaNorm = newCenterNorm - currentNorm;
            worldPos = center + rem + projX * axisX + deltaNorm * axisX * lenX; // lenX rescales to world magnitude
        } else if (fisheyeMode == 1 && focusRow >= 0.0) {
            float t = (rowIndex + 0.5) / indexCount;
            float newCenterNorm = texture2D(warpCenters, vec2(t, 0.0)).r;
            float localScale = texture2D(warpScales, vec2(t, 0.0)).r;
            vec3 offset = worldPos - center;
            float projY = dot(offset, axisY);
            vec3 rem = offset - projY * axisY;
            projY *= localScale;
            float currentNorm = (rowIndex + 0.5) / indexCount * 2.0 - 1.0;
            float deltaNorm = newCenterNorm - currentNorm;
            worldPos = center + rem + projY * axisY + deltaNorm * axisY * lenY;
        }
    } else {
        // Legacy analytic fisheye scaling (may produce overlaps)
        if (fisheyeMode == 0 && focusCol >= 0.0) {
            float d = colIndex - focusCol;
            float w = weight(d, sigma);
            float s = mix(scaleMin, scaleMax, w); // scale factor along X axis
            vec3 offset = worldPos - center;
            float projX = dot(offset, axisX);
            vec3 rem = offset - projX * axisX;
            projX *= s;
            worldPos = center + rem + projX * axisX;
        } else if (fisheyeMode == 1 && focusRow >= 0.0) {
            float d = rowIndex - focusRow;
            float w = weight(d, sigma);
            float s = mix(scaleMin, scaleMax, w); // scale factor along Y axis
            vec3 offset = worldPos - center;
            float projY = dot(offset, axisY);
            vec3 rem = offset - projY * axisY;
            projY *= s;
            worldPos = center + rem + projY * axisY;
        }
    }

    gl_Position = viewProjection * vec4(worldPos, 1.0);
    vColor = color;
}
`;

BABYLON.Effect.ShadersStore["heatmapFisheyeFragmentShader"] = `
precision highp float;
varying vec4 vColor;
void main(void) {
    gl_FragColor = vColor;
}
`;

// TwoTone variant extends original twoTone shader with fisheye logic.
BABYLON.Effect.ShadersStore["twoToneFisheyeVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute float split;
attribute vec4 splitColor1;
attribute vec4 splitColor2;
attribute float colIndex;
attribute float rowIndex;
uniform mat4 viewProjection;
uniform int fisheyeMode; // 0 column 1 row
uniform float focusCol;
uniform float focusRow;
uniform float sigma;
uniform float scaleMax;
uniform float scaleMin;
uniform int useWarp;
uniform sampler2D warpCenters;
uniform sampler2D warpScales;
uniform float indexCount;
varying vec2 vUV;
varying float vSplit;
varying vec4 vColor1;
varying vec4 vColor2;

float weight(float d, float s) { return exp(-0.5 * (d / s) * (d / s)); }

void main(void) {
    mat4 world = mat4(world0, world1, world2, world3);
    vec4 wp4 = world * vec4(position, 1.0);
    vec3 center = world3.xyz;
    vec3 wp = wp4.xyz;
    vec3 axisX = world0.xyz; float lenX = length(axisX); if (lenX < 1e-6) axisX = vec3(1.0,0.0,0.0); else axisX /= lenX;
    vec3 axisY = world1.xyz; float lenY = length(axisY); if (lenY < 1e-6) axisY = vec3(0.0,1.0,0.0); else axisY /= lenY;
    if (useWarp == 1 && indexCount > 0.0) {
        if (fisheyeMode == 0 && focusCol >= 0.0) {
            float t = (colIndex + 0.5) / indexCount;
            float newCenterNorm = texture2D(warpCenters, vec2(t,0.0)).r;
            float localScale = texture2D(warpScales, vec2(t,0.0)).r;
            vec3 off = wp - center; float projX = dot(off, axisX); vec3 rem = off - projX * axisX; projX *= localScale;
            float currentNorm = (colIndex + 0.5)/indexCount*2.0 - 1.0; float deltaNorm = newCenterNorm - currentNorm;
            wp = center + rem + projX * axisX + deltaNorm * axisX * lenX;
        } else if (fisheyeMode == 1 && focusRow >= 0.0) {
            float t = (rowIndex + 0.5) / indexCount;
            float newCenterNorm = texture2D(warpCenters, vec2(t,0.0)).r;
            float localScale = texture2D(warpScales, vec2(t,0.0)).r;
            vec3 off = wp - center; float projY = dot(off, axisY); vec3 rem = off - projY * axisY; projY *= localScale;
            float currentNorm = (rowIndex + 0.5)/indexCount*2.0 - 1.0; float deltaNorm = newCenterNorm - currentNorm;
            wp = center + rem + projY * axisY + deltaNorm * axisY * lenY;
        }
    } else {
        if (fisheyeMode == 0 && focusCol >= 0.0) {
            float d = colIndex - focusCol; float w = weight(d, sigma); float s = mix(scaleMin, scaleMax, w);
            vec3 off = wp - center; float projX = dot(off, axisX); vec3 rem = off - projX * axisX; projX *= s; wp = center + rem + projX * axisX;
        } else if (fisheyeMode == 1 && focusRow >= 0.0) {
            float d = rowIndex - focusRow; float w = weight(d, sigma); float s = mix(scaleMin, scaleMax, w);
            vec3 off = wp - center; float projY = dot(off, axisY); vec3 rem = off - projY * axisY; projY *= s; wp = center + rem + projY * axisY;
        }
    }
    gl_Position = viewProjection * vec4(wp, 1.0);
    vUV = uv; vSplit = split; vColor1 = splitColor1; vColor2 = splitColor2; }
`;

BABYLON.Effect.ShadersStore["twoToneFisheyeFragmentShader"] = `
precision highp float;
varying vec2 vUV;
varying float vSplit;
varying vec4 vColor1;
varying vec4 vColor2;
void main(void) {
    if (vUV.x > vSplit) {
        gl_FragColor = vColor1;
    } else {
        gl_FragColor = vColor2;
    }
}
`;

export function createHeatmapFisheyeMaterial(scene) {
    const mat = new BABYLON.ShaderMaterial("heatmapFisheyeMat", scene, { vertex: "heatmapFisheye", fragment: "heatmapFisheye" }, {
        attributes: ["position", "uv", "color", "world0", "world1", "world2", "world3", "colIndex", "rowIndex"],
        uniforms: ["viewProjection", "fisheyeMode", "focusCol", "focusRow", "sigma", "scaleMax", "scaleMin", "useWarp", "indexCount"],
        samplers: ["warpCenters", "warpScales"]
    });
    mat.setInt("fisheyeMode", -1);
    mat.setFloat("focusCol", -1.0);
    mat.setFloat("focusRow", -1.0);
    mat.setFloat("sigma", 1.4);
    mat.setFloat("scaleMax", 3.5);
    mat.setFloat("scaleMin", 0.4);
    mat.setFloat("indexCount", 0.0);
    mat.setInt("useWarp", 0);
    return mat;
}

export function createTwoToneFisheyeMaterial(scene) {
    const mat = new BABYLON.ShaderMaterial("twoToneFisheyeMat", scene, { vertex: "twoToneFisheye", fragment: "twoToneFisheye" }, {
        attributes: ["position", "uv", "world0", "world1", "world2", "world3", "split", "splitColor1", "splitColor2", "colIndex", "rowIndex"],
        uniforms: ["viewProjection", "fisheyeMode", "focusCol", "focusRow", "sigma", "scaleMax", "scaleMin", "useWarp", "indexCount"],
        samplers: ["warpCenters", "warpScales"]
    });
    mat.setInt("fisheyeMode", -1);
    mat.setFloat("focusCol", -1.0);
    mat.setFloat("focusRow", -1.0);
    mat.setFloat("sigma", 1.4);
    mat.setFloat("scaleMax", 3.5);
    mat.setFloat("scaleMin", 0.4);
    mat.setFloat("indexCount", 0.0);
    mat.setInt("useWarp", 0);
    return mat;
}

// Helper: build non-overlapping warp arrays given focus & gaussian params.
// Returns { centers: Float32Array (N), scales: Float32Array (N) }
export function buildWarpLUT(count, focusIndex, sigma = 1.4, scaleMax = 3.5, scaleMin = 0.4) {
    const centers = new Float32Array(count);
    const scales = new Float32Array(count);
    if (focusIndex < 0 || focusIndex >= count) {
        for (let i = 0; i < count; i++) { centers[i] = (i + 0.5) / count * 2 - 1; scales[i] = 1.0; }
        return { centers, scales };
    }
    // First pass: compute target widths via gaussian interpolation.
    const widths = new Array(count);
    let total = 0;
    for (let i = 0; i < count; i++) {
        const d = Math.abs(i - focusIndex);
        const w = Math.exp(-0.5 * (d / sigma) * (d / sigma));
        const s = scaleMin + (scaleMax - scaleMin) * w; // width scaling
        widths[i] = s;
        total += s;
    }
    // Normalize widths to preserve total span = 2 (normalized -1..1)
    const normFactor = 2.0 / total;
    for (let i = 0; i < count; i++) widths[i] *= normFactor;
    // Second pass: compute centers by cumulative placement (no overlap)
    let cursor = -1.0;
    for (let i = 0; i < count; i++) {
        const w = widths[i];
        const c = cursor + w / 2.0;
        centers[i] = c; // already in -1..1
        scales[i] = w * count / 2.0; // convert normalized width back to relative scale vs original baseline (baseline ~ 2/count)
        cursor += w;
    }
    return { centers, scales };
}

export function applyWarpLUTToMaterial(mat, scene, centers, scales, count) {
    const engine = scene.getEngine();
    // Create 1D textures (implemented as 2D  (count x 1))
    const centersTex = new BABYLON.RawTexture(centers, count, 1, BABYLON.Engine.TEXTUREFORMAT_RED, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE, BABYLON.Engine.TEXTURETYPE_FLOAT);
    const scalesTex = new BABYLON.RawTexture(scales, count, 1, BABYLON.Engine.TEXTUREFORMAT_RED, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE, BABYLON.Engine.TEXTURETYPE_FLOAT);
    mat.setTexture("warpCenters", centersTex);
    mat.setTexture("warpScales", scalesTex);
    mat.setFloat("indexCount", count);
    mat.setInt("useWarp", 1);
}

export function clearWarp(mat) {
    if (!mat) return;
    mat.setInt("useWarp", 0);
    mat.setFloat("indexCount", 0.0);
}
