import * as BABYLON from "babylonjs";


export class CurvedTwoToneVisualization {
    constructor(layout, { twoToneConfig }, scene) {
        this.layout = layout;
        this.scene = scene;
        this.config = twoToneConfig;

        this.visibleCols = layout.visibleCols;
        this.visibleRows = layout.visibleRows;
        this.cellHeight = layout.cellHeight;
        this.arcAngle = layout.arcAngle;
        this.radius = layout.radius;
        this.arcLength = layout.arcLength;
        this.height = layout.height;

        const subX = Math.max(this.visibleCols, 128);
        const subY = Math.max(this.visibleRows, 64);
        this.mesh = BABYLON.MeshBuilder.CreateGround("curvedTwoTonePlane", {
            width: this.arcLength,
            height: this.height,
            subdivisionsX: subX,
            subdivisionsY: subY
        }, scene);

        this._curvePlaneGeometry();
        this._ensureShaders();
        this._createMaterial();

        this._lastPaletteCount = 6;
        this._lastIntervals = undefined;
        this._removeObserver = this.layout.addObserver(snapshot => {
            this.render(this._lastPaletteCount, this._lastIntervals, snapshot);
        });
    }

    _curvePlaneGeometry() {
        const mesh = this.mesh;
        const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        const w = this.arcLength;

        const a = this.height !== 0 ? (this.cellHeight - this.height) / this.height : 0;
        const centerYOffset = this.layout.groundOffset + this.height / 2;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i + 0];
            const z = positions[i + 2];
            const u = (x + w / 2) / w;
            const angle = (u - 0.5) * this.arcAngle;
            const newX = this.radius * Math.sin(angle);
            const newZ = this.radius * Math.cos(angle) - this.radius;
            const newY = a * z + centerYOffset;
            positions[i + 0] = newX;
            positions[i + 1] = newY;
            positions[i + 2] = newZ;
        }
        mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }

    _ensureShaders() {
        if (!BABYLON.Effect.ShadersStore["curvedTwoToneVertexShader"]) {
            BABYLON.Effect.ShadersStore["curvedTwoToneVertexShader"] = `
                precision highp float;
                attribute vec3 position;
                attribute vec2 uv;
                
                uniform mat4 worldViewProjection;
                uniform float uEnableCartesian;
                uniform float uFocusRow;
                uniform float uFocusCol;
                uniform float uD;

                varying vec2 vUV;

                float distort1D(float x, float focus, float D) {
                    float dnorm = abs(x - focus);
                    if (dnorm < 1e-6) return focus;
                    float Dmax = (x < focus) ? focus : (1.0 - focus);
                    float scale = (D + 1.0) / (D + (Dmax / dnorm));
                    float signv = sign(x - focus);
                    return clamp(focus + signv * (dnorm * scale), 0.0, 1.0);
                }

                void main() {
                    float vy = (uEnableCartesian > 0.5) ? distort1D(uv.y, uFocusRow, uD) : uv.y;
                    vUV = vec2(uv.x, vy);
                    gl_Position = worldViewProjection * vec4(position, 1.0);
                }
            `;
        }

        if (!BABYLON.Effect.ShadersStore["curvedTwoToneFragmentShader"]) {
            BABYLON.Effect.ShadersStore["curvedTwoToneFragmentShader"] = `
                precision highp float;

                varying vec2 vUV;
                
                uniform sampler2D texSplit;
                uniform sampler2D texC1;
                uniform sampler2D texC2;
                uniform float uCols;
                uniform float uRows;

                void main() {
                    vec2 cellCoord = vec2(floor(vUV.x * uCols), floor(vUV.y * uRows));
                    vec2 uvCell = vec2((cellCoord.x + 0.5)/uCols, (cellCoord.y + 0.5)/uRows);

                    vec4 s = texture2D(texSplit, uvCell);
                    float split = s.r;
                    vec4 c1 = texture2D(texC1, uvCell);
                    vec4 c2 = texture2D(texC2, uvCell);
                    float cellU = fract(vUV.x * uCols);
                    vec4 baseColor = (cellU > split) ? c1 : c2;

                    gl_FragColor = baseColor;
                }
            `;
        }
    }

    _createMaterial() {
        const mat = new BABYLON.ShaderMaterial("curvedTwoToneMat", this.scene, {
            vertex: "curvedTwoTone",
            fragment: "curvedTwoTone"
        }, {
            attributes: ["position", "uv"],
            uniforms: ["worldViewProjection", "uCols", "uRows", "uEnableCartesian", "uFocusCol", "uFocusRow", "uD"],
            samplers: ["texSplit", "texC1", "texC2"]
        });

        mat.backFaceCulling = false;
        mat.disableLighting = true;
        mat.setFloat("uCols", this.visibleCols);
        mat.setFloat("uRows", this.visibleRows);
        mat.setFloat("uEnableCartesian", 0.0);
        mat.setFloat("uFocusCol", 0.5);
        mat.setFloat("uFocusRow", 0.5);
        mat.setFloat("uD", 3.5);
        this.mesh.material = mat;
    }

    render(paletteCount = 6, intervals = undefined, snapshot = this.layout.getVisibleSnapshot()) {
        this._lastPaletteCount = paletteCount;
        this._lastIntervals = intervals;

        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._disposeTextures();
            return;
        }

        const width = snapshot.colCount;
        const height = snapshot.rowCount;
        const columnIndices = snapshot.columnIndices;

        const splitPixels = new Uint8Array(width * height * 4);
        const c1Pixels = new Uint8Array(width * height * 4);
        const c2Pixels = new Uint8Array(width * height * 4);

        const paletteListRaw = this.config.colorList.slice(0, Math.max(1, paletteCount));
        const paletteList = paletteListRaw.length ? paletteListRaw : this.config.colorList;
        const neutral = [255, 255, 255];

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const idx = r * width + c;
                const value = snapshot.normalizedData[idx];
                const colKey = snapshot.columnKeys[c];
                const meta = this.layout.columnMetadata[colKey];
                const globalCol = columnIndices[c];

                let colorOne = neutral;
                let colorTwo = neutral;
                let split = 1.0;

                if (meta?.type === "numeric" || meta?.type === "date") {
                    const mapping = this.config.colorMapping(value, paletteList, globalCol, intervals);
                    colorOne = mapping?.c1 ?? neutral;
                    colorTwo = mapping?.c2 ?? neutral;
                    split = mapping?.splitRatio ?? 1.0;
                } else if (meta?.type === "categorical") {
                    const palette = paletteList[globalCol % paletteList.length] ?? neutral;
                    if (Array.isArray(palette[0])) {
                        const categoryIndex = meta.categories.length > 1 ? Math.round(value * (meta.categories.length - 1)) : 0;
                        const picked = palette[categoryIndex % palette.length] ?? neutral;
                        colorOne = picked;
                        colorTwo = picked;
                    } else {
                        colorOne = palette;
                        colorTwo = palette;
                    }
                    split = 1.0;
                }

                const flippedRow = height - 1 - r; // align texture rows with instanced orientation
                const o = (flippedRow * width + c) * 4;
                splitPixels[o + 0] = Math.round(Math.max(0, Math.min(1, split)) * 255);
                splitPixels[o + 1] = 0;
                splitPixels[o + 2] = 0;
                splitPixels[o + 3] = 255;

                c1Pixels[o + 0] = colorOne[0] ?? neutral[0];
                c1Pixels[o + 1] = colorOne[1] ?? neutral[1];
                c1Pixels[o + 2] = colorOne[2] ?? neutral[2];
                c1Pixels[o + 3] = 255;

                c2Pixels[o + 0] = colorTwo[0] ?? neutral[0];
                c2Pixels[o + 1] = colorTwo[1] ?? neutral[1];
                c2Pixels[o + 2] = colorTwo[2] ?? neutral[2];
                c2Pixels[o + 3] = 255;
            }
        }

        const mkTex = (px) => {
            const tex = new BABYLON.RawTexture(
                px,
                width,
                height,
                BABYLON.Engine.TEXTUREFORMAT_RGBA,
                this.scene,
                false,
                true,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            return tex;
        };

        this._disposeTextures();
        this._texSplit = mkTex(splitPixels);
        this._texC1 = mkTex(c1Pixels);
        this._texC2 = mkTex(c2Pixels);

        const mat = this.mesh.material;
        if (mat && mat.setTexture) {
            mat.setTexture("texSplit", this._texSplit);
            mat.setTexture("texC1", this._texC1);
            mat.setTexture("texC2", this._texC2);
            mat.setFloat("uCols", width);
            mat.setFloat("uRows", height);
        }
    }

    _disposeTextures() {
        if (this._texSplit) {
            this._texSplit.dispose();
            this._texSplit = null;
        }
        if (this._texC1) {
            this._texC1.dispose();
            this._texC1 = null;
        }
        if (this._texC2) {
            this._texC2.dispose();
            this._texC2 = null;
        }
    }

    dispose() {
        this._removeObserver?.();
        if (this.mesh) this.mesh.dispose();
        this._disposeTextures();
    }

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
    setCartesianD(d) {
        this._lastD = d;
        if (this.mesh && this.mesh.material && typeof this.mesh.material.setFloat === "function") {
            this.mesh.material.setFloat("uD", d);
        }
    }
}

export default CurvedTwoToneVisualization;