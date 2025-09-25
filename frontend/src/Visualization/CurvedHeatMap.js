import * as BABYLON from "babylonjs";

// Renders the full grid as a single curved plane; each cell's final color is baked into a small data texture.
// This version implements lens distortion in the VERTEX SHADER.
export class CurvedHeatMapVisualization {
    constructor(layout, { heatMapConfig }, scene) {
        this.layout = layout;
        this.scene = scene;
        this.config = heatMapConfig;

        const { dataArray } = layout.computeCellPositions();
        this.dataArray = dataArray; // normalized values in [0,1]

        this.numCols = layout.numCols;
        this.numRows = layout.numRows - 1; // visual rows exclude the CSV header row
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.arcAngle = layout.arcAngle;
        this.radius = layout.radius;

        this.height = this.cellHeight * this.numRows;
        this.arcLength = this.radius * this.arcAngle;

        // NOTE: For vertex-shader distortion, these subdivisions are CRITICAL for quality.
        const subX = Math.max(this.numCols, 256);
        const subY = Math.max(this.numRows, 64);
        this.mesh = BABYLON.MeshBuilder.CreateGround("curvedHeatPlane", {
            width: this.arcLength,
            height: this.height,
            subdivisionsX: subX,
            subdivisionsY: subY
        }, scene);

        this._curvePlaneGeometry();
        this._applyDataTextureAndShader();
    }

    _curvePlaneGeometry() {
        const mesh = this.mesh;
        const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        const w = this.arcLength;
        const h = this.height;
        const centerYOffset = this.layout.groundOffset + (this.numRows / 2 + 0.5) * this.cellHeight;

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

    _applyDataTextureAndShader() {
        // --- This part remains the same: Bake cell colors into a texture on the CPU ---
        const width = this.numCols;
        const height = this.numRows;
        const pixels = new Uint8Array(width * height * 4);
        const colorListLength = this.config.colorListLength ?? (this.config.colorList?.length || 1);
        const neutral = [128, 128, 128];

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const idx = r * width + c;
                const value = this.dataArray[idx];
                const colKey = this.layout.columnKeys[c];
                const meta = this.layout.columnMetadata[colKey];
                const colorIndex = c % colorListLength;
                let rgb;
                switch (meta.type) {
                    case 'numeric':
                    case 'date': {
                        rgb = this.config.colorMapping(value, colorIndex);
                        rgb = [
                            Math.round(255 * Math.max(0, Math.min(1, rgb[0]))),
                            Math.round(255 * Math.max(0, Math.min(1, rgb[1]))),
                            Math.round(255 * Math.max(0, Math.min(1, rgb[2])))
                        ];
                        break;
                    }
                    case 'categorical': {
                        const baseColor = this.config.colorList[colorIndex];
                        const categoryIndex = Math.round(value * Math.max(0, (meta.categories.length - 1)));
                        const lightness = 40 + (categoryIndex % 5) * 10;
                        baseColor.l = lightness;
                        const [r0, g0, b0] = baseColor.srgb;
                        rgb = [Math.round(255 * r0), Math.round(255 * g0), Math.round(255 * b0)];
                        break;
                    }
                    case 'constant':
                    default: {
                        rgb = neutral;
                        break;
                    }
                }
                const o = idx * 4;
                pixels[o + 0] = rgb[0];
                pixels[o + 1] = rgb[1];
                pixels[o + 2] = rgb[2];
                pixels[o + 3] = 255;
            }
        }

        const texture = new BABYLON.RawTexture(
            pixels, width, height, BABYLON.Engine.TEXTUREFORMAT_RGBA,
            this.scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE
        );
        texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this._dataTexture = texture;

        // --- SHADER DEFINITIONS ARE MODIFIED HERE ---

        // --- VERTEX SHADER ---
        // Now handles the distortion logic and passes distorted UVs to the fragment shader.
        BABYLON.Effect.ShadersStore["curvedHeatVertexShader"] = `
            precision highp float;
            attribute vec3 position;
            attribute vec2 uv;

            uniform mat4 worldViewProjection;
            uniform float uEnableCartesian;
            uniform float uFocusCol;
            uniform float uFocusRow;
            uniform float uD;
            
            varying vec2 vUV; // Will pass the *distorted* UV to the fragment shader

            // Distortion function is now in the vertex shader
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
                // Apply distortion to the vertex's UV coordinate
                float ux = uv.x; // Horizontal distortion is commented out in original
                float vy = (uEnableCartesian > 0.5) ? distort1D(uv.y, uFocusRow, uD) : uv.y;
                
                // Pass the newly calculated, distorted UV to the fragment shader
                vUV = vec2(ux, vy);

                gl_Position = worldViewProjection * vec4(position, 1.0);
            }
        `;

        // --- FRAGMENT SHADER ---
        // Now simplified: it just receives the pre-distorted UV and samples the texture.
        BABYLON.Effect.ShadersStore["curvedHeatFragmentShader"] = `
            precision highp float;
            varying vec2 vUV; // Receives the interpolated, pre-distorted UV
            
            uniform sampler2D texData;
            uniform float uCols;
            uniform float uRows;

            void main() {
                // The received vUV is already distorted.
                // We still perform the cell-center sampling to avoid bleeding.
                vec2 cellCoord = vec2(floor(vUV.x * uCols), floor(vUV.y * uRows));
                vec2 uvCell = vec2((cellCoord.x + 0.5)/uCols, (cellCoord.y + 0.5)/uRows);
                
                gl_FragColor = texture2D(texData, uvCell);
            }
        `;

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
        mat.setTexture("texData", texture);
        mat.setFloat("uCols", this.numCols);
        mat.setFloat("uRows", this.numRows);
        mat.setFloat("uEnableCartesian", 0.0);
        mat.setFloat("uFocusCol", 0.5);
        mat.setFloat("uFocusRow", 0.5);
        mat.setFloat("uD", 3.5);
        this.mesh.material = mat;
    }

    render() {
        // No-op: construction already applied data texture.
    }

    dispose() {
        if (this.mesh) this.mesh.dispose();
        if (this._dataTexture) this._dataTexture.dispose();
    }

    // API methods remain unchanged as they correctly set uniforms on the material
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
        if (this.mesh && this.mesh.material && typeof this.mesh.material.setFloat === 'function') {
            this.mesh.material.setFloat("uD", d);
        }
    }
}

export default CurvedHeatMapVisualization;