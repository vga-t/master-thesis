import * as BABYLON from "babylonjs";
import { heatMapConfig } from "./HeatMap.js";
import { twoToneConfig } from "./TwoTone.js";

const DEFAULT_WIDTH = 0.9;
const DEFAULT_HEIGHT = 0.55;
const MIN_WIDTH = 0.4;
const MIN_HEIGHT = 0.25;
const MAX_WIDTH = 2.2;
const MAX_HEIGHT = 1.5;
const MAX_ROWS = 256;

const HANDLE_SPECS = [
    { name: "topLeft", signX: -1, signY: 1 },
    { name: "topRight", signX: 1, signY: 1 },
    { name: "bottomLeft", signX: -1, signY: -1 },
    { name: "bottomRight", signX: 1, signY: -1 }
];

class MinimapVisualization {
    constructor(layout, scene) {
        this.layout = layout;
        this.scene = scene;
        this._mode = "heatmap";
        this._visible = false;
        this._width = DEFAULT_WIDTH;
        this._height = DEFAULT_HEIGHT;
        this._lastViewportInput = null;

        this.root = new BABYLON.TransformNode("minimapRoot", scene);
        this.root.rotationQuaternion = BABYLON.Quaternion.Identity();

        this.mainMesh = BABYLON.MeshBuilder.CreatePlane("minimapPlane", { width: 1, height: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        this.mainMesh.parent = this.root;
        this.mainMesh.isPickable = true;
        this.mainMesh.metadata = { minimap: true, kind: "main" };

        this._material = new BABYLON.StandardMaterial("minimapMaterial", scene);
        this._material.disableLighting = true;
        this._material.backFaceCulling = false;
        this._material.specularColor = new BABYLON.Color3(0, 0, 0);
        this._material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.mainMesh.material = this._material;

        this.viewportMesh = BABYLON.MeshBuilder.CreatePlane("minimapViewport", { width: 1, height: 1 }, scene);
        this.viewportMesh.parent = this.root;
        this.viewportMesh.isPickable = true;
        this.viewportMesh.metadata = { minimap: true, kind: "viewport" };
        const viewportMat = new BABYLON.StandardMaterial("minimapViewportMat", scene);
        viewportMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 1.0);
        viewportMat.alpha = 0.35;
        viewportMat.disableLighting = true;
        viewportMat.backFaceCulling = false;
        this.viewportMesh.material = viewportMat;

        this.handles = HANDLE_SPECS.map(spec => {
            const mesh = BABYLON.MeshBuilder.CreateBox(`minimapHandle_${spec.name}`, { size: 0.05 }, scene);
            mesh.parent = this.root;
            mesh.isPickable = true;
            mesh.metadata = { minimap: true, kind: "handle", handle: spec.name, signX: spec.signX, signY: spec.signY };
            const mat = new BABYLON.StandardMaterial(`minimapHandleMat_${spec.name}`, scene);
            mat.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.9);
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
            mat.disableLighting = true;
            mesh.material = mat;
            return mesh;
        });

        this.root.setEnabled(false);

        this._aggregated = this._aggregateData();
        this._heatmapTexture = this._createHeatmapTexture(this._aggregated);
        this._twoToneTexture = this._createTwoToneTexture(this._aggregated);
        this._applyTexture();
        this._applyDimensions();
    }

    setVisible(visible) {
        this._visible = !!visible;
        this.root.setEnabled(this._visible);
    }

    isVisible() {
        return this._visible;
    }

    setMode(mode) {
        if (mode !== "heatmap" && mode !== "twotone") return;
        if (this._mode === mode) return;
        this._mode = mode;
        this._applyTexture();
    }

    setRootPosition(position) {
        if (!position) return;
        this.root.position.copyFrom(position);
    }

    setForward(direction) {
        if (!direction) return;
        const forward = direction.clone();
        if (forward.lengthSquared() < 1e-6) forward.copyFrom(BABYLON.Axis.Z);
        forward.normalize();
        const up = BABYLON.Axis.Y.clone();
        let right = BABYLON.Vector3.Cross(up, forward);
        if (right.lengthSquared() < 1e-6) {
            // Forward is parallel to up; adjust up vector slightly
            up.x += 0.0001;
            right = BABYLON.Vector3.Cross(up, forward);
        }
        right.normalize();
        const adjustedUp = BABYLON.Vector3.Cross(forward, right).normalize();
        const orientation = BABYLON.Quaternion.FromLookDirectionLH(forward, adjustedUp);
        if (orientation) {
            this.root.rotationQuaternion = orientation;
        }
    }

    getRootPosition() {
        return this.root.getAbsolutePosition().clone();
    }

    getPlaneMesh() {
        return this.mainMesh;
    }

    getDimensions() {
        return { width: this._width, height: this._height };
    }

    updateViewport(scrollState, dimensions = {}) {
        if (!scrollState) return;
        const visibleRows = dimensions.visibleRows ?? this.layout.visibleRows ?? 1;
        const visibleCols = dimensions.visibleCols ?? this.layout.visibleCols ?? 1;
        const totalRows = Math.max(visibleRows, dimensions.totalRows ?? this.layout.totalRows ?? visibleRows);
        const totalCols = Math.max(visibleCols, dimensions.totalCols ?? this.layout.totalCols ?? visibleCols);

        const viewportWidthRatio = totalCols > 0 ? visibleCols / totalCols : 1;
        const viewportHeightRatio = totalRows > 0 ? visibleRows / totalRows : 1;

        const viewportWidth = Math.max(0.03, viewportWidthRatio * this._width);
        const viewportHeight = Math.max(0.03, viewportHeightRatio * this._height);

        this.viewportMesh.scaling.x = viewportWidth;
        this.viewportMesh.scaling.y = viewportHeight;

        const maxRowOffset = Math.max(0, scrollState.maxRowOffset ?? totalRows - visibleRows);
        const maxColOffset = Math.max(0, scrollState.maxColOffset ?? totalCols - visibleCols);

        const rowNorm = maxRowOffset > 0 ? (scrollState.rowOffset ?? 0) / maxRowOffset : 0;
        const colNorm = maxColOffset > 0 ? (scrollState.colOffset ?? 0) / maxColOffset : 0;

        const halfWidth = this._width / 2;
        const halfHeight = this._height / 2;
        const availableWidth = Math.max(0, this._width - viewportWidth);
        const availableHeight = Math.max(0, this._height - viewportHeight);

        const centerX = -halfWidth + (viewportWidth / 2) + availableWidth * colNorm;
        const centerY = halfHeight - (viewportHeight / 2) - availableHeight * rowNorm;

        this.viewportMesh.position.x = centerX;
        this.viewportMesh.position.y = centerY;
        this.viewportMesh.position.z = 0.003;

        this._lastViewportInput = {
            scrollState: { ...scrollState },
            dimensions: { visibleRows, visibleCols, totalRows, totalCols }
        };
    }

    resizeFromHandle(handleMeta, localPoint) {
        if (!handleMeta || !localPoint) return;
        const affectsX = true;
        const affectsY = true;
        let width = this._width;
        let height = this._height;

        if (affectsX) {
            const newHalfWidth = Math.max(MIN_WIDTH / 2, Math.min(MAX_WIDTH / 2, Math.abs(localPoint.x)));
            width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newHalfWidth * 2));
        }
        if (affectsY) {
            const newHalfHeight = Math.max(MIN_HEIGHT / 2, Math.min(MAX_HEIGHT / 2, Math.abs(localPoint.y)));
            height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHalfHeight * 2));
        }

        this.setDimensions(width, height);
    }

    setDimensions(width, height) {
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
        this._width = clampedWidth;
        this._height = clampedHeight;
        this._applyDimensions();
        if (this._lastViewportInput) {
            this.updateViewport(this._lastViewportInput.scrollState, this._lastViewportInput.dimensions);
        }
    }

    worldToLocal(point) {
        if (!point) return BABYLON.Vector3.Zero();
        const invWorld = this.mainMesh.getWorldMatrix().clone().invert();
        return BABYLON.Vector3.TransformCoordinates(point, invWorld);
    }

    normalizeLocalPoint(local) {
        const halfWidth = this._width / 2;
        const halfHeight = this._height / 2;
        const clampedX = Math.max(-halfWidth, Math.min(halfWidth, local.x));
        const clampedY = Math.max(-halfHeight, Math.min(halfHeight, local.y));
        const colNorm = (clampedX + halfWidth) / (this._width || 1);
        const rowNorm = (halfHeight - clampedY) / (this._height || 1);
        return {
            row: Math.max(0, Math.min(1, rowNorm)),
            col: Math.max(0, Math.min(1, colNorm))
        };
    }

    getPlane() {
        const worldMatrix = this.mainMesh.getWorldMatrix();
        const origin = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.Zero(), worldMatrix);
        const normal = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z.clone(), worldMatrix).normalize();
        return BABYLON.Plane.FromPositionAndNormal(origin, normal);
    }

    previewViewportFromNormalized(rowNorm, colNorm) {
        const halfWidth = this._width / 2;
        const halfHeight = this._height / 2;
        const viewportWidth = this.viewportMesh.scaling.x;
        const viewportHeight = this.viewportMesh.scaling.y;
        const availableWidth = Math.max(0, this._width - viewportWidth);
        const availableHeight = Math.max(0, this._height - viewportHeight);
        const centerX = -halfWidth + (viewportWidth / 2) + availableWidth * colNorm;
        const centerY = halfHeight - (viewportHeight / 2) - availableHeight * rowNorm;
        this.viewportMesh.position.x = centerX;
        this.viewportMesh.position.y = centerY;
    }

    _applyDimensions() {
        this.mainMesh.scaling.x = this._width;
        this.mainMesh.scaling.y = this._height;
        this.handles.forEach(handle => {
            const { signX, signY } = handle.metadata;
            handle.position.x = signX * this._width / 2;
            handle.position.y = signY * this._height / 2;
            handle.position.z = 0.002;
        });
        this.viewportMesh.position.z = 0.003;
    }

    _applyTexture() {
        if (this._mode === "twotone" && this._twoToneTexture) {
            this._material.diffuseTexture = this._twoToneTexture;
        } else if (this._heatmapTexture) {
            this._material.diffuseTexture = this._heatmapTexture;
        }
        if (this._material.diffuseTexture) {
            this._material.diffuseTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            this._material.diffuseTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        }
    }

    _aggregateData() {
        const csvData = Array.isArray(this.layout?.csvData) ? this.layout.csvData : [];
        const columnKeys = Array.isArray(this.layout?.columnKeys) ? this.layout.columnKeys : [];
        const totalRows = csvData.length;
        const totalCols = columnKeys.length;

        if (totalRows === 0 || totalCols === 0) {
            return {
                rows: 1,
                cols: Math.max(1, totalCols || 1),
                averages: new Float32Array(Math.max(1, totalCols || 1)),
                modeValues: new Float32Array(Math.max(1, totalCols || 1)),
                hasMode: new Uint8Array(Math.max(1, totalCols || 1)),
                columnMeta: columnKeys.map(key => this.layout.columnMetadata[key]),
                columnIndices: Array.from({ length: Math.max(1, totalCols || 1) }, (_, i) => i)
            };
        }

        const aggRows = Math.min(MAX_ROWS, Math.max(1, totalRows));
        const aggCols = totalCols;
        const rowScale = totalRows / aggRows;

        const sums = new Float32Array(aggRows * aggCols);
        const counts = new Uint32Array(aggRows * aggCols);
        const categoryMaps = new Array(aggRows * aggCols);
        const cellMeta = new Array(aggRows * aggCols);

        const columnMeta = columnKeys.map(key => this.layout.columnMetadata[key]);

        for (let row = 0; row < totalRows; row++) {
            const destRow = Math.min(aggRows - 1, Math.floor(row / rowScale));
            const rowData = csvData[row] ?? {};
            for (let col = 0; col < aggCols; col++) {
                const key = columnKeys[col];
                const meta = columnMeta[col];
                const value = rowData?.[key];
                const idx = destRow * aggCols + col;
                const normalized = meta?.normalize ? meta.normalize(value) : 0;
                if (Number.isFinite(normalized)) sums[idx] += normalized;
                counts[idx] += 1;
                cellMeta[idx] = meta;
                if (meta?.type === "categorical") {
                    let map = categoryMaps[idx];
                    if (!map) map = categoryMaps[idx] = Object.create(null);
                    const catKey = value == null ? "__missing__" : String(value);
                    map[catKey] = (map[catKey] || 0) + 1;
                }
            }
        }

        const averages = new Float32Array(aggRows * aggCols);
        const modeValues = new Float32Array(aggRows * aggCols);
        const hasMode = new Uint8Array(aggRows * aggCols);

        for (let idx = 0; idx < averages.length; idx++) {
            const count = counts[idx];
            averages[idx] = count ? sums[idx] / count : 0;
            const meta = cellMeta[idx];
            if (meta?.type === "categorical") {
                const map = categoryMaps[idx];
                if (map) {
                    let bestKey = null;
                    let bestCount = -1;
                    for (const key in map) {
                        const freq = map[key];
                        if (freq > bestCount) {
                            bestCount = freq;
                            bestKey = key;
                        }
                    }
                    if (bestKey !== null) {
                        const raw = bestKey === "__missing__" ? undefined : bestKey;
                        const normalized = meta.normalize ? meta.normalize(raw) : 0;
                        if (Number.isFinite(normalized)) {
                            modeValues[idx] = normalized;
                            hasMode[idx] = 1;
                        }
                    }
                }
            }
        }

        return {
            rows: aggRows,
            cols: aggCols,
            averages,
            modeValues,
            hasMode,
            columnMeta,
            columnIndices: Array.from({ length: aggCols }, (_, i) => i)
        };
    }

    _createHeatmapTexture(data) {
        const width = Math.max(1, data.cols);
        const height = Math.max(1, data.rows);
        const buffer = new Uint8ClampedArray(width * height * 4);
        const colorCount = heatMapConfig.colorListLength ?? (heatMapConfig.colorList?.length || 1);

        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const idx = row * width + col;
                const meta = data.columnMeta[col];
                const globalCol = data.columnIndices[col] ?? col;
                const colorIndex = colorCount ? (globalCol % colorCount) : 0;
                let normalized = data.averages[idx];
                if (meta?.type === "categorical" && data.hasMode[idx]) {
                    normalized = data.modeValues[idx];
                }
                normalized = Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : 0;

                let r = 128;
                let g = 128;
                let b = 128;

                if (meta?.type === "categorical") {
                    const baseColor = heatMapConfig.colorList[colorIndex];
                    const categoryCount = meta.categories?.length ?? 1;
                    const categoryIndex = categoryCount > 1 ? Math.round(normalized * (categoryCount - 1)) : 0;
                    const lightness = 40 + (categoryIndex % 5) * 10;
                    baseColor.l = lightness;
                    const srgb = baseColor.srgb;
                    r = Math.round(255 * srgb[0]);
                    g = Math.round(255 * srgb[1]);
                    b = Math.round(255 * srgb[2]);
                } else {
                    const srgb = heatMapConfig.colorMapping(normalized, colorIndex) ?? [0.5, 0.5, 0.5];
                    r = Math.round(255 * Math.max(0, Math.min(1, srgb[0])));
                    g = Math.round(255 * Math.max(0, Math.min(1, srgb[1])));
                    b = Math.round(255 * Math.max(0, Math.min(1, srgb[2])));
                }

                const offset = idx * 4;
                buffer[offset + 0] = r;
                buffer[offset + 1] = g;
                buffer[offset + 2] = b;
                buffer[offset + 3] = 255;
            }
        }

        return this._createDynamicTexture("minimapHeatmapTex", width, height, buffer);
    }

    _createTwoToneTexture(data) {
        const paletteList = twoToneConfig.colorList ?? [];
        const paletteCount = paletteList.length || 1;
        const width = Math.max(1, data.cols);
        const height = Math.max(1, data.rows);
        const buffer = new Uint8ClampedArray(width * height * 4);

        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const idx = row * width + col;
                const meta = data.columnMeta[col];
                const globalCol = data.columnIndices[col] ?? col;

                let normalized = data.averages[idx];
                if (meta?.type === "categorical" && data.hasMode[idx]) {
                    normalized = data.modeValues[idx];
                }
                normalized = Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : 0;

                let r = 220;
                let g = 220;
                let b = 220;

                if (meta?.type === "categorical") {
                    const palette = paletteList[globalCol % paletteCount] ?? [255, 255, 255];
                    if (Array.isArray(palette[0])) {
                        const categoryCount = meta.categories?.length ?? palette.length;
                        const categoryIndex = categoryCount > 1 ? Math.round(normalized * (categoryCount - 1)) : 0;
                        const color = palette[categoryIndex % palette.length] ?? [255, 255, 255];
                        r = color[0];
                        g = color[1];
                        b = color[2];
                    } else {
                        r = palette[0] ?? 255;
                        g = palette[1] ?? 255;
                        b = palette[2] ?? 255;
                    }
                } else {
                    const mapping = twoToneConfig.colorMapping(normalized, paletteList, globalCol, 4);
                    const c1 = mapping?.c1 ?? [255, 255, 255];
                    const c2 = mapping?.c2 ?? [255, 255, 255];
                    const split = mapping?.splitRatio ?? 0.5;
                    r = Math.round(c1[0] * split + c2[0] * (1 - split));
                    g = Math.round(c1[1] * split + c2[1] * (1 - split));
                    b = Math.round(c1[2] * split + c2[2] * (1 - split));
                }

                const offset = idx * 4;
                buffer[offset + 0] = r;
                buffer[offset + 1] = g;
                buffer[offset + 2] = b;
                buffer[offset + 3] = 255;
            }
        }

        return this._createDynamicTexture("minimapTwoToneTex", width, height, buffer);
    }

    _createDynamicTexture(name, width, height, data) {
        const texture = new BABYLON.DynamicTexture(name, { width, height }, this.scene, false, BABYLON.Engine.TEXTUREFORMAT_RGBA);
        const ctx = texture.getContext();
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(data);
        ctx.putImageData(imageData, 0, 0);
        texture.update(false);
        texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        texture.vScale = -1;
        texture.hasAlpha = false;
        return texture;
    }
}

export default MinimapVisualization;
