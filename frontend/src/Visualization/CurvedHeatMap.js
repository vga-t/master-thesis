import * as BABYLON from "babylonjs";

// Renders the full grid as a single curved plane; each cell's final color is baked into a small data texture (width=numCols, height=numRows-1)
export class CurvedHeatMapVisualization {
    constructor(layout, { heatMapConfig }, scene) {
        this.layout = layout;
        this.scene = scene;
        this.config = heatMapConfig;

        const { dataArray } = layout.computeCellPositions();
        this.dataArray = dataArray; // normalized values in [0,1]

        this.numCols = layout.numCols;
        // visual rows exclude the CSV header row
        this.numRows = layout.numRows;
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.arcAngle = layout.arcAngle;
        this.radius = layout.radius;

        // The visual height spans only the data rows (exclude header row)
        this.height = this.cellHeight * this.numRows;
        this.arcLength = this.radius * this.arcAngle;

        // Build a ground (XZ) with sufficient subdivisions; then curve it along X and lift Z -> Y
        const subX = Math.max(this.numCols, 256);
        const subY = Math.max(this.numRows, 64);
        this.mesh = BABYLON.MeshBuilder.CreateGround("curvedHeatPlane", {
            width: this.arcLength,
            height: this.height,
            subdivisionsX: subX,
            subdivisionsY: subY
        }, scene);

        this._curvePlaneGeometry();
        this._applyDataTexture();
    }

    _curvePlaneGeometry() {
        const mesh = this.mesh;
        const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        const w = this.arcLength;
        const h = this.height;

        // Center so bottom edge = groundOffset + 0.5*cellHeight and top edge = groundOffset + (numRows + 0.5)*cellHeight
        // centerY = groundOffset + (numRows/2 + 0.5)*cellHeight
        const centerYOffset = this.layout.groundOffset + (this.numRows / 2 + 0.5) * this.cellHeight;

        // Reposition each vertex from straight XZ ground to cylinder segment along X; map Z -> vertical Y
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i + 0];   // [-w/2, +w/2]
            const z = positions[i + 2];   // [-h/2, +h/2]
            // map x to angle along arc [-arcAngle/2, +arcAngle/2]
            const u = (x + w / 2) / w; // [0,1]
            const angle = (u - 0.5) * this.arcAngle;

            const newX = this.radius * Math.sin(angle);
            const newZ = this.radius * Math.cos(angle) - this.radius; // center the cylinder so chord is around z≈0
            const newY = z + centerYOffset; // elevate Z into Y with offset

            positions[i + 0] = newX;
            positions[i + 1] = newY;
            positions[i + 2] = newZ;
        }

        mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        // Recompute normals for correct lighting (though we'll use emissive texture to be lighting-independent)
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }

    _applyDataTexture() {
        const width = this.numCols;
        const height = this.numRows;
        const size = width * height * 4;
        const pixels = new Uint8Array(size);

        const colorListLength = this.config.colorListLength ?? (this.config.colorList?.length || 1);
        const neutral = [128, 128, 128];

        // Fill texture row-major: top visual row (index 0) should map to the top of the plane.
        // layout.dataArray is flattened row-major (first visual row first), matching our arrangement.
        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const idx = r * width + c;
                const value = this.dataArray[idx];

                // Column metadata determines mapping strategy
                const colKey = this.layout.columnKeys[c];
                const meta = this.layout.columnMetadata[colKey];
                const colorIndex = c % colorListLength;

                let rgb;
                switch (meta.type) {
                    case 'numeric':
                    case 'date': {
                        // Use the provided mapping (expected to return sRGB floats in [0,1])
                        rgb = this.config.colorMapping(value, colorIndex);
                        rgb = [
                            Math.round(255 * Math.max(0, Math.min(1, rgb[0]))),
                            Math.round(255 * Math.max(0, Math.min(1, rgb[1]))),
                            Math.round(255 * Math.max(0, Math.min(1, rgb[2])))
                        ];
                        break;
                    }
                    case 'categorical': {
                        // Keep hue from colorList; vary lightness by category index (simple stride)
                        const baseColor = this.config.colorList[colorIndex];
                        const categoryIndex = Math.round(value * Math.max(0, (meta.categories.length - 1)));
                        const lightness = 40 + (categoryIndex % 5) * 10; // 40..80
                        baseColor.l = lightness;
                        const [r0, g0, b0] = baseColor.srgb;
                        rgb = [
                            Math.round(255 * r0),
                            Math.round(255 * g0),
                            Math.round(255 * b0)
                        ];
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
            pixels,
            width,
            height,
            BABYLON.Engine.TEXTUREFORMAT_RGBA,
            this.scene,
            false, // no mipmaps
            true,  // invertY so row 0 maps to top (v=1)
            BABYLON.Texture.NEAREST_SAMPLINGMODE
        );
        texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this._dataTexture = texture;

        // Shader material to allow optional cartesian distortion during sampling
        BABYLON.Effect.ShadersStore["curvedHeatVertexShader"] = `
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
        BABYLON.Effect.ShadersStore["curvedHeatFragmentShader"] = `
            precision highp float;
            varying vec2 vUV;
            uniform sampler2D texData;
            uniform float uCols;
            uniform float uRows;
            uniform float uEnableCartesian;
            uniform float uFocusCol;
            uniform float uFocusRow;
            uniform float uAlpha;
            uniform float uD;
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
                float ux = (uEnableCartesian > 0.5) ? distort1D(vUV.x, uFocusCol, uAlpha, uD) : vUV.x;
                float vy = (uEnableCartesian > 0.5) ? distort1D(vUV.y, uFocusRow, uAlpha, uD) : vUV.y;
                // sample per-cell center after distortion to avoid bleeding
                vec2 cellCoord = vec2(floor(ux * uCols), floor(vy * uRows));
                vec2 uvCell = vec2((cellCoord.x + 0.5)/uCols, (cellCoord.y + 0.5)/uRows);
                gl_FragColor = texture2D(texData, uvCell);
            }
        `;
        const mat = new BABYLON.ShaderMaterial("curvedHeatMat", this.scene, {
            vertex: "curvedHeat",
            fragment: "curvedHeat"
        }, {
            attributes: ["position", "uv"],
            uniforms: ["worldViewProjection", "uCols", "uRows", "uEnableCartesian", "uFocusCol", "uFocusRow", "uAlpha", "uD"],
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
        mat.setFloat("uAlpha", 1.5);
        mat.setFloat("uD", 3.5);
        this.mesh.material = mat;
        // Ensure UVs run U: left->right, V: top->bottom; CreateGround already sets that convention.
    }

    // If underlying data changes, regenerate texture
    render() {
        // No-op: construction already applied data texture.
        // Left for API parity with other visualizations
    }

    dispose() {
        if (this.mesh) this.mesh.dispose();
        if (this._dataTexture) this._dataTexture.dispose();
    }

    // Cartesian distortion API to align with CurvedTwoTone
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
        this._lastD = d;
        console.log('CurvedHeatMap.setCartesianD', d); // <-- add this line
        if (this.mesh && this.mesh.material && typeof this.mesh.material.setFloat === 'function') {
            this.mesh.material.setFloat("uD", d);
        }
    }
}

export default CurvedHeatMapVisualization;
