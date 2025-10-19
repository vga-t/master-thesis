import * as BABYLON from "babylonjs";


export class CurvedHeatMapVisualization {
    constructor(layout, { heatMapConfig }, scene) {
        this.layout = layout;
        this.scene = scene;
        this.config = heatMapConfig;

        this.visibleCols = layout.visibleCols;
        this.visibleRows = layout.visibleRows;
        this.cellHeight = layout.cellHeight;
        this.arcAngle = layout.arcAngle;
        this.radius = layout.radius;
        this.arcLength = layout.arcLength;
        this.height = layout.height;

        const subX = Math.max(this.visibleCols, 256);
        const subY = Math.max(this.visibleRows, 64);
        this.mesh = BABYLON.MeshBuilder.CreateGround("curvedHeatPlane", {
            width: this.arcLength,
            height: this.height,
            subdivisionsX: subX,
            subdivisionsY: subY
        }, scene);

        this._curvePlaneGeometry();
        this._ensureShaders();
        this._createMaterial();

        this._removeObserver = this.layout.addObserver(snapshot => this._updateDataTexture(snapshot));
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
        if (!BABYLON.Effect.ShadersStore["curvedHeatVertexShader"]) {
            BABYLON.Effect.ShadersStore["curvedHeatVertexShader"] = `
                precision highp float;
                attribute vec3 position;
                attribute vec2 uv;

                uniform mat4 worldViewProjection;
                uniform float uEnableCartesian;
                uniform float uFocusCol;
                uniform float uFocusRow;
                uniform float uD;
            
                varying vec2 vUV;

                float distort1D(float x, float focus, float D) {
                    float dnorm = abs(x - focus);
                    if (dnorm < 1e-6) return focus;
                    float Dmax = (x < focus) ? focus : (1.0 - focus);
                    float scale = (D + 1.0) / (D + (Dmax / dnorm));
                    float signv = sign(x - focus);
                    float x2 = focus + signv * (dnorm * scale);
                    return clamp(x2, 0.0, 1.0);
                }

                void main() {
                    float ux = uv.x;
                    float vy = (uEnableCartesian > 0.5) ? distort1D(uv.y, uFocusRow, uD) : uv.y;
                    vUV = vec2(ux, vy);
                    gl_Position = worldViewProjection * vec4(position, 1.0);
                }
            `;
        }

        if (!BABYLON.Effect.ShadersStore["curvedHeatFragmentShader"]) {
            BABYLON.Effect.ShadersStore["curvedHeatFragmentShader"] = `
                precision highp float;
                varying vec2 vUV;

                uniform sampler2D texData;
                uniform float uCols;
                uniform float uRows;

                void main() {
                    vec2 cellCoord = vec2(floor(vUV.x * uCols), floor(vUV.y * uRows));
                    vec2 uvCell = vec2((cellCoord.x + 0.5)/uCols, (cellCoord.y + 0.5)/uRows);
                    gl_FragColor = texture2D(texData, uvCell);
                }
            `;
        }
    }

    _createMaterial() {
        const mat = new BABYLON.ShaderMaterial("curvedHeatMat", this.scene, {
            vertex: "curvedHeat",
            fragment: "curvedHeat"
        }, {
            attributes: ["position", "uv"],
            uniforms: ["worldViewProjection", "uCols", "uRows", "uEnableCartesian", "uFocusCol", "uFocusRow", "uD"],
            samplers: ["texData"]
        });

        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.setFloat("uCols", this.visibleCols);
        mat.setFloat("uRows", this.visibleRows);
        mat.setFloat("uEnableCartesian", 0.0);
        mat.setFloat("uFocusCol", 0.5);
        mat.setFloat("uFocusRow", 0.5);
        mat.setFloat("uD", 3.5);

        this.mesh.material = mat;
    }

    _updateDataTexture(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            if (this._dataTexture) {
                this._dataTexture.dispose();
                this._dataTexture = null;
            }
            return;
        }

        // Determine viewport dimensions and global column indices
        const width = snapshot.colCount;
        const height = snapshot.rowCount;
        const columnIndices = snapshot.columnIndices;
        const pixels = new Uint8Array(width * height * 4);
        const colorListLength = this.config.colorListLength ?? (this.config.colorList?.length || 1);
        const neutral = [128, 128, 128];

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const idx = r * width + c;
                const value = snapshot.normalizedData[idx];
                const colKey = snapshot.columnKeys[c];
                const meta = this.layout.columnMetadata[colKey];
                const globalCol = columnIndices[c];
                const colorIndex = globalCol % colorListLength;

                let rgb = neutral;

                switch (meta?.type) {
                    case "numeric":
                    case "date": {
                        const mapped = this.config.colorMapping(value, colorIndex) ?? [0.5, 0.5, 0.5];
                        rgb = [
                            Math.round(255 * Math.max(0, Math.min(1, mapped[0]))),
                            Math.round(255 * Math.max(0, Math.min(1, mapped[1]))),
                            Math.round(255 * Math.max(0, Math.min(1, mapped[2])))
                        ];
                        break;
                    }
                    case "categorical": {
                        const baseColor = this.config.colorList[colorIndex];
                        const categoryCount = meta.categories.length;
                        const categoryIndex = categoryCount > 1 ? Math.round(value * (categoryCount - 1)) : 0;
                        const lightness = 40 + (categoryIndex % 5) * 10;
                        baseColor.l = lightness;
                        const [r0, g0, b0] = baseColor.srgb;
                        rgb = [Math.round(255 * r0), Math.round(255 * g0), Math.round(255 * b0)];
                        break;
                    }
                    case "constant":
                    default:
                        break;
                }

                const offset = idx * 4;
                pixels[offset + 0] = rgb[0];
                pixels[offset + 1] = rgb[1];
                pixels[offset + 2] = rgb[2];
                pixels[offset + 3] = 255;
            }
        }

        if (!this._dataTexture || this._dataTexture.getSize().width !== width || this._dataTexture.getSize().height !== height) {
            if (this._dataTexture) this._dataTexture.dispose();
            this._dataTexture = new BABYLON.RawTexture(
                pixels,
                width,
                height,
                BABYLON.Engine.TEXTUREFORMAT_RGBA,
                this.scene,
                false,
                true,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            this._dataTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            this._dataTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        } else {
            this._dataTexture.update(pixels);
        }

        const mat = this.mesh.material;
        if (mat) {
            mat.setTexture("texData", this._dataTexture);
            mat.setFloat("uCols", width);
            mat.setFloat("uRows", height);
        }
    }

    render() {
        this._updateDataTexture();
    }

    dispose() {
        this._removeObserver?.();
        if (this.mesh) this.mesh.dispose();
        if (this._dataTexture) this._dataTexture.dispose();
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

export default CurvedHeatMapVisualization;