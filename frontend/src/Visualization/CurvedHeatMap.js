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
        this.visualRows = layout.numRows - 1;
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.arcAngle = layout.arcAngle;
        this.radius = layout.radius;

        // The visual height spans only the data rows (exclude header row)
        this.visualHeight = this.cellHeight * this.visualRows;
        this.arcLength = this.radius * this.arcAngle;

        // Build a ground (XZ) with sufficient subdivisions; then curve it along X and lift Z -> Y
        const subX = Math.max(this.numCols, 64);
        const subY = Math.max(this.visualRows, 8);
        this.mesh = BABYLON.MeshBuilder.CreateGround("curvedHeatPlane", {
            width: this.arcLength,
            height: this.visualHeight,
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
    const h = this.visualHeight;

    // Center so bottom edge = groundOffset + 0.5*cellHeight and top edge = groundOffset + (visualRows + 0.5)*cellHeight
    // centerY = groundOffset + (visualRows/2 + 0.5)*cellHeight
    const centerYOffset = this.layout.groundOffset + (this.visualRows / 2 + 0.5) * this.cellHeight;

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
        const height = this.visualRows;
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

        // Use emissive to make it independent of scene lighting
        const mat = new BABYLON.StandardMaterial("curvedHeatMat", this.scene);
        mat.emissiveTexture = texture;
        mat.disableLighting = true;
        mat.backFaceCulling = false;
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
}

export default CurvedHeatMapVisualization;
