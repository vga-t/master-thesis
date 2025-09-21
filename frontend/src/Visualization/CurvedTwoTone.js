import * as BABYLON from "babylonjs";

// Single curved plane, two-tone per cell via data texture:
// We pack split ratio in alpha, and store two colors per cell via a 2x width texture (left half = color2, right half = color1),
// or simpler: store both colors horizontally per cell.
export class CurvedTwoToneVisualization {
    constructor(layout, { twoToneConfig }, scene) {
        this.layout = layout;
        this.scene = scene;
        this.config = twoToneConfig;

        const { dataArray } = layout.computeCellPositions();
        this.dataArray = dataArray;
        this.numCols = layout.numCols;
        this.visualRows = layout.numRows - 1;
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.arcAngle = layout.arcAngle;
        this.radius = layout.radius;

        this.visualHeight = this.cellHeight * this.visualRows;
        this.arcLength = this.radius * this.arcAngle;

        // Ground mesh with enough subdivisions for smooth curve
        const subX = Math.max(this.numCols, 64);
        const subY = Math.max(this.visualRows, 8);
        this.mesh = BABYLON.MeshBuilder.CreateGround("curvedTwoTonePlane", {
            width: this.arcLength,
            height: this.visualHeight,
            subdivisionsX: subX,
            subdivisionsY: subY
        }, scene);

        this._curvePlaneGeometry();
        this._createMaterial();
    }

    _curvePlaneGeometry() {
        const mesh = this.mesh;
        const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        const w = this.arcLength;
        const h = this.visualHeight;

        const centerYOffset = this.layout.groundOffset + (this.visualRows / 2 + 0.5) * this.cellHeight;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i + 0];
            const z = positions[i + 2];
            const u = (x + w / 2) / w;
            const angle = (u - 0.5) * this.arcAngle;
            const newX = this.radius * Math.sin(angle);
            const newZ = this.radius * Math.cos(angle) - this.radius;
            const newY = z + centerYOffset;
            positions[i + 0] = newX;
            positions[i + 1] = newY;
            positions[i + 2] = newZ;
        }
        mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }

    _createMaterial() {
        // Custom shader: sample split and two colors textures
        BABYLON.Effect.ShadersStore["curvedTwoToneVertexShader"] = `
            precision highp float;
            attribute vec3 position;
            attribute vec2 uv;
            uniform mat4 worldViewProjection;
            varying vec2 vUV;
            void main() {
                vUV = uv;
                gl_Position = worldViewProjection * vec4(position, 1.0);
            }
        `;
        BABYLON.Effect.ShadersStore["curvedTwoToneFragmentShader"] = `
            precision highp float;
            varying vec2 vUV;
            uniform sampler2D texSplit;
            uniform sampler2D texC1;
            uniform sampler2D texC2;
            uniform float uCols;
            uniform float uRows;
            uniform float uEnableCartesian; // 0 or 1
            uniform float uFocusCol; // normalized [0,1]
            uniform float uFocusRow; // normalized [0,1]
            uniform float uAlpha;     // legacy exponent (kept for compatibility, not used if uD>0)
            uniform float uD;         // degree of magnification (>=1). Higher -> narrower focus, stronger lens

            // Degree-based cartesian lens inspired by provided 2D implementation
            float distort1D_cart(float x, float focus, float D) {
                float dnorm = abs(x - focus);
                if (dnorm < 1e-6) return focus;
                float Dmax = (x < focus) ? focus : (1.0 - focus);
                // Pull sample coordinates toward focus near pointer: new distance = dnorm * scale (scale in 0..1)
                float scale = (D + 1.0) / (D + (Dmax / dnorm));
                float signv = sign(x - focus);
                float x2 = focus + signv * (dnorm * scale);
                return clamp(x2, 0.0, 1.0);
            }
            float distort1D_pow(float x, float focus, float alpha) {
                float d = x - focus;
                float ad = abs(d);
                float s = sign(d);
                float nd = s * pow(ad, alpha);
                return clamp(focus + nd, 0.0, 1.0);
            }
            float distort1D(float x, float focus, float alpha, float D) {
                return (D > 0.0) ? distort1D_cart(x, focus, D) : distort1D_pow(x, focus, alpha);
            }
            void main() {
                // Centered sampling per cell to avoid neighbor bleeding
                float ux = (uEnableCartesian > 0.5) ? distort1D(vUV.x, uFocusCol, uAlpha, uD) : vUV.x;
                float vy = (uEnableCartesian > 0.5) ? distort1D(vUV.y, uFocusRow, uAlpha, uD) : vUV.y;

                vec2 cellCoord = vec2(floor(ux * uCols), floor(vy * uRows));
                vec2 uvCell = vec2((cellCoord.x + 0.5)/uCols, (cellCoord.y + 0.5)/uRows);

                vec4 s = texture2D(texSplit, uvCell);
                float split = s.r; // 0..1
                vec4 c1 = texture2D(texC1, uvCell);
                vec4 c2 = texture2D(texC2, uvCell);
                // Compute local U within the current cell (so split acts per cell, like instanced planes)
                float cellU = fract(ux * uCols);
                gl_FragColor = (cellU > split) ? c1 : c2;
            }
        `;

        const mat = new BABYLON.ShaderMaterial("curvedTwoToneMat", this.scene, {
            vertex: "curvedTwoTone",
            fragment: "curvedTwoTone"
        }, {
            attributes: ["position", "uv"],
            uniforms: ["worldViewProjection", "uCols", "uRows", "uEnableCartesian", "uFocusCol", "uFocusRow", "uAlpha", "uD"],
            samplers: ["texSplit", "texC1", "texC2"]
        });
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        mat.setFloat("uCols", this.numCols);
        mat.setFloat("uRows", this.visualRows);
        mat.setFloat("uEnableCartesian", 0.0);
        mat.setFloat("uFocusCol", 0.5);
        mat.setFloat("uFocusRow", 0.5);
        mat.setFloat("uAlpha", 0.6);
        mat.setFloat("uD", 3.5);
        this.mesh.material = mat;
    }

    render(paletteCount = 5, intervals = 3) {
        // Build/refresh textures consistent with TwoTone.js
        const width = this.numCols;
        const height = this.visualRows;

        const splitPixels = new Uint8Array(width * height * 4);
        const c1Pixels = new Uint8Array(width * height * 4);
        const c2Pixels = new Uint8Array(width * height * 4);

        const paletteList = this.config.colorList.slice(0, paletteCount);
        const neutral = [255, 255, 255];

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const idx = r * width + c;
                const value = this.dataArray[idx];
                const colKey = this.layout.columnKeys[c];
                const meta = this.layout.columnMetadata[colKey];

                let c1 = neutral, c2 = neutral, split = 1.0;
                if (meta.type === 'numeric' || meta.type === 'date') {
                    const { c1: cc1, c2: cc2, splitRatio } = this.config.colorMapping(value, paletteList, c, intervals);
                    c1 = cc1; c2 = cc2; split = splitRatio;
                } else if (meta.type === 'categorical') {
                    const palette = paletteList[c % paletteList.length];
                    const categoryIndex = Math.round(value * (meta.categories.length - 1));
                    const color = palette[categoryIndex % palette.length];
                    c1 = color; c2 = color; split = 1.0;
                } else { // constant
                    c1 = neutral; c2 = neutral; split = 1.0;
                }

                const o = idx * 4;
                splitPixels[o + 0] = Math.round(Math.max(0, Math.min(1, split)) * 255);
                splitPixels[o + 1] = 0;
                splitPixels[o + 2] = 0;
                splitPixels[o + 3] = 255;

                c1Pixels[o + 0] = c1[0];
                c1Pixels[o + 1] = c1[1];
                c1Pixels[o + 2] = c1[2];
                c1Pixels[o + 3] = 255;

                c2Pixels[o + 0] = c2[0];
                c2Pixels[o + 1] = c2[1];
                c2Pixels[o + 2] = c2[2];
                c2Pixels[o + 3] = 255;
            }
        }

        const mkTex = (px) => {
            const t = new BABYLON.RawTexture(
                px, width, height,
                BABYLON.Engine.TEXTUREFORMAT_RGBA,
                this.scene,
                false,
                true,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            t.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            return t;
        };

        // Dispose previous if present
        if (this._texSplit) this._texSplit.dispose();
        if (this._texC1) this._texC1.dispose();
        if (this._texC2) this._texC2.dispose();
        this._texSplit = mkTex(splitPixels);
        this._texC1 = mkTex(c1Pixels);
        this._texC2 = mkTex(c2Pixels);

        const mat = this.mesh.material;
        if (mat && mat.setTexture) {
            mat.setTexture("texSplit", this._texSplit);
            mat.setTexture("texC1", this._texC1);
            mat.setTexture("texC2", this._texC2);
        }
    }

    dispose() {
        if (this.mesh) this.mesh.dispose();
        if (this._texSplit) this._texSplit.dispose();
        if (this._texC1) this._texC1.dispose();
        if (this._texC2) this._texC2.dispose();
    }

    // API to control cartesian distortion
    setCartesianEnabled(enabled) {
        const mat = this.mesh?.material;
        if (mat && mat.setFloat) mat.setFloat("uEnableCartesian", enabled ? 1.0 : 0.0);
    }
    setCartesianFocus(colNorm, rowNorm) {
        const mat = this.mesh?.material;
        if (mat && mat.setFloat) {
            mat.setFloat("uFocusCol", Math.max(0, Math.min(1, colNorm)));
            mat.setFloat("uFocusRow", Math.max(0, Math.min(1, rowNorm)));
        }
    }
    setCartesianAlpha(alpha) {
        const mat = this.mesh?.material;
        if (mat && mat.setFloat) mat.setFloat("uAlpha", Math.max(0.05, Math.min(0.95, alpha)));
    }
    setCartesianD(d) {
        const mat = this.mesh?.material;
        if (mat && mat.setFloat) mat.setFloat("uD", Math.max(0.1, d));
    }
}

export default CurvedTwoToneVisualization;
