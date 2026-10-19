import * as BABYLON from "babylonjs";
import { twoToneConfig } from "./TwoTone";

const normalizeColorComponent = (c) => Math.max(0, Math.min(1, c / 255));
const normalizeColor = (color) => color.map(normalizeColorComponent);
const normalizedPaletteList = twoToneConfig.colorList.map((palette) => palette.map(normalizeColor));

export const heatMapConfig = {
    paletteList: normalizedPaletteList,

    get paletteCount() {
        return this.paletteList.length;
    },

    getPaletteForColumn(columnIndex) {
        if (!this.paletteList.length) return null;
        return this.paletteList[columnIndex % this.paletteList.length];
    },

    clampNormalizedValue(value) {
        if (typeof value !== "number" || Number.isNaN(value)) return 0;
        return Math.min(1, Math.max(0, value));
    },

    interpolatePalette(palette, value) {
        if (!palette || palette.length === 0) return [0.5, 0.5, 0.5];
        if (palette.length === 1) return palette[0];

        const t = this.clampNormalizedValue(value);
        const scaled = t * (palette.length - 1);
        const idx = Math.min(palette.length - 2, Math.floor(scaled));
        const ratio = scaled - idx;

        const c1 = palette[idx];
        const c2 = palette[idx + 1];

        return [
            c1[0] + (c2[0] - c1[0]) * ratio,
            c1[1] + (c2[1] - c1[1]) * ratio,
            c1[2] + (c2[2] - c1[2]) * ratio
        ];
    },

    getNumericColor(value, columnIndex) {
        const palette = this.getPaletteForColumn(columnIndex);
        return this.interpolatePalette(palette, value);
    },

    getCategoryColor(value, columnIndex, categoryCount) {
        const palette = this.getPaletteForColumn(columnIndex);
        if (!palette || palette.length === 0) return [0.5, 0.5, 0.5];
        const clamped = this.clampNormalizedValue(value);
        const lookupIndex = categoryCount > 1
            ? Math.round(clamped * (categoryCount - 1))
            : 0;
        return palette[lookupIndex % palette.length] ?? palette[0];
    }
};


export class HeatMapVisualization {
    constructor(layout, { heatMapConfig }, scene) {
        this.layout = layout;
        this.config = heatMapConfig;
        this.scene = scene;

        this._currentCellWidth = layout.cellWidth;
        this._currentCellHeight = layout.cellHeight;

        // Set of thin instance indices to hide (make transparent)
        this._hiddenCellIndices = new Set();

        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneHeatMap",
            { height: 1, width: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );
        const material = new BABYLON.StandardMaterial("planeMaterial", scene);
        this._configureMaterial(material);
        this.basePlane.material = material;

        this._colorBuffer = new Float32Array(0);

        // Precomputed color buffer for entire dataset (computed once, sliced during scroll)
        this._precomputed = {
            colors: null,
            totalRows: 0,
            totalCols: 0
        };

        // Dirty flag: when invisible updates are skipped, this stores the pending changeType
        this._dirtyChangeType = null;

        this._removeObserver = this.layout.addObserver((snapshot, changeType = "geometry_and_data") =>
            this._handleLayoutUpdate(snapshot, changeType)
        );
    }

    /**
     * Set which cells should be hidden (transparent)
     * @param {Set<number>} hiddenIndices - Set of thin instance indices to hide
     */
    setHiddenCells(hiddenIndices) {
        this._hiddenCellIndices = hiddenIndices instanceof Set ? hiddenIndices : new Set(hiddenIndices);
        // Re-render to apply visibility changes
        const snapshot = this.layout?.getVisibleSnapshot();
        if (snapshot) {
            this.renderData(snapshot);
        }
    }

    /**
     * Clear all hidden cells (make all visible)
     */
    clearHiddenCells() {
        this._hiddenCellIndices.clear();
        const snapshot = this.layout?.getVisibleSnapshot();
        if (snapshot) {
            this.renderData(snapshot);
        }
    }

    _configureMaterial(material) {
        material.disableLighting = true;
        material.useVertexColor = true;
        material.diffuseColor = new BABYLON.Color3(1, 1, 1);
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        material.backFaceCulling = false;
    }

    /**
     * Call when this visualization becomes visible after being hidden.
     * Replays any skipped layout updates.
     */
    catchUp() {
        if (!this._dirtyChangeType) return;
        const changeType = this._dirtyChangeType;
        this._dirtyChangeType = null;
        const snapshot = this.layout.getVisibleSnapshot();
        if (snapshot) this._handleLayoutUpdate(snapshot, changeType);
    }

    _handleLayoutUpdate(snapshot, changeType = "geometry_and_data") {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }

        // Skip expensive work when not visible; remember the most significant pending change
        if (!this.basePlane.isVisible) {
            // Escalate: geometry_and_data > cell_size_changed > data_only
            if (!this._dirtyChangeType || changeType === "geometry_and_data" || changeType === "cell_size_changed") {
                this._dirtyChangeType = changeType;
            }
            return;
        }

        // Keep tracked dimensions updated without destroying/recreating the mesh
        this._currentCellWidth = this.layout.cellWidth;
        this._currentCellHeight = this.layout.cellHeight;

        if (changeType === "data_only") {
            this.renderData(snapshot);
            return;
        }

        this.renderGeometry(snapshot);
        this.renderData(snapshot);
    }

    _recreateBasePlane(newCellWidth, newCellHeight) {
        // No-op: basePlane is an immutable unit quad scaled by the thin instance matrix
        this._currentCellWidth = newCellWidth;
        this._currentCellHeight = newCellHeight;
    }

    render(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot) {
            this._clearInstances();
            return;
        }
        this.renderGeometry(snapshot);
        this.renderData(snapshot);
    }

    renderGeometry(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }
        this.basePlane.thinInstanceSetBuffer("matrix", snapshot.positionMatrix, 16);
    }

    /**
     * Precompute HeatMap colors for the entire dataset.
     * Call this once after data load; during scroll, slices of precomputed buffers are used.
     */
    precomputeFullDataset() {
        const totalRows = this.layout.totalRows;
        const totalCols = this.layout.totalCols;
        const precomputedData = this.layout.getPrecomputedNormalizedData?.();

        if (!precomputedData || totalRows === 0 || totalCols === 0) {
            this._precomputed.colors = null;
            return;
        }

        const totalCount = totalRows * totalCols;
        this._precomputed.colors = new Float32Array(totalCount * 4);
        this._precomputed.totalRows = totalRows;
        this._precomputed.totalCols = totalCols;

        const neutralColor = [0.5, 0.5, 0.5];
        const colorsArr = this._precomputed.colors;

        // Pre-cache column metadata
        const colMeta = this.layout.columnKeys.map(key => this.layout.columnMetadata[key]);

        for (let idx = 0; idx < totalCount; idx++) {
            const value = precomputedData[idx];
            const colIndex = idx % totalCols;
            const meta = colMeta[colIndex];
            const globalColIndex = colIndex;

            let r = neutralColor[0];
            let g = neutralColor[1];
            let b = neutralColor[2];

            switch (meta?.type) {
                case "numeric":
                case "date": {
                    const mapped = this.config.getNumericColor(value, globalColIndex) ?? neutralColor;
                    r = mapped[0];
                    g = mapped[1];
                    b = mapped[2];
                    break;
                }
                case "categorical": {
                    const categoryCount = meta.categories?.length ?? 0;
                    const mapped = this.config.getCategoryColor(value, globalColIndex, categoryCount) ?? neutralColor;
                    r = mapped[0];
                    g = mapped[1];
                    b = mapped[2];
                    break;
                }
                case "constant":
                default:
                    break;
            }

            const offset = idx * 4;
            colorsArr[offset + 0] = r;
            colorsArr[offset + 1] = g;
            colorsArr[offset + 2] = b;
            colorsArr[offset + 3] = 1; // Alpha set during render based on hidden cells
        }
    }

    /**
     * Check if precomputed data is valid
     */
    _hasValidPrecomputed() {
        return this._precomputed.colors !== null &&
            this._precomputed.totalRows === this.layout.totalRows &&
            this._precomputed.totalCols === this.layout.totalCols;
    }

    renderData(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }

        const { rowCount, colCount, rowOffset, colOffset, columnIndices } = snapshot;
        const count = rowCount * colCount;
        const requiredSize = count * 4;

        if (this._colorBuffer.length < requiredSize) {
            this._colorBuffer = new Float32Array(requiredSize);
        }
        const colorsArr = this._colorBuffer.subarray(0, requiredSize);

        // Ensure precomputed data is available
        if (!this._hasValidPrecomputed()) {
            this.precomputeFullDataset();
        }

        // Use precomputed data if available (fast path for scrolling)
        if (this._precomputed.colors) {
            const precomputedTotalCols = this._precomputed.totalCols;

            // Copy sliced data from precomputed buffer
            for (let r = 0; r < rowCount; r++) {
                const globalRow = rowOffset + r;
                for (let c = 0; c < colCount; c++) {
                    const globalCol = columnIndices?.[c] ?? (colOffset + c);
                    const srcIdx = globalRow * precomputedTotalCols + globalCol;
                    const dstIdx = r * colCount + c;

                    const srcOffset = srcIdx * 4;
                    const dstOffset = dstIdx * 4;

                    colorsArr[dstOffset + 0] = this._precomputed.colors[srcOffset + 0];
                    colorsArr[dstOffset + 1] = this._precomputed.colors[srcOffset + 1];
                    colorsArr[dstOffset + 2] = this._precomputed.colors[srcOffset + 2];
                    // Apply alpha for hidden cells
                    colorsArr[dstOffset + 3] = this._hiddenCellIndices.has(dstIdx) ? 0 : 1;
                }
            }
        } else {
            // Fallback: compute on the fly
            this._renderDataFallback(snapshot, colorsArr);
        }

        this.basePlane.thinInstanceSetBuffer("color", colorsArr, 4);
    }

    /**
     * Fallback method for computing colors on-the-fly when precomputed data is unavailable
     */
    _renderDataFallback(snapshot, colorsArr) {
        const { normalizedData, columnKeys, columnIndices, colCount } = snapshot;
        const neutralColor = [0.5, 0.5, 0.5];

        // Pre-calculate column metadata and global indices
        const colMeta = [];
        const colGlobalIndices = [];
        for (let c = 0; c < colCount; c++) {
            const colKey = columnKeys[c];
            colMeta.push(this.layout.columnMetadata[colKey]);
            colGlobalIndices.push(columnIndices[c]);
        }

        for (let idx = 0; idx < normalizedData.length; idx++) {
            const value = normalizedData[idx];
            const colIndex = idx % colCount;
            const meta = colMeta[colIndex];
            const globalColIndex = colGlobalIndices[colIndex];

            let r = neutralColor[0];
            let g = neutralColor[1];
            let b = neutralColor[2];

            switch (meta?.type) {
                case "numeric":
                case "date": {
                    const mapped = this.config.getNumericColor(value, globalColIndex) ?? neutralColor;
                    r = mapped[0];
                    g = mapped[1];
                    b = mapped[2];
                    break;
                }
                case "categorical": {
                    const categoryCount = meta.categories?.length ?? 0;
                    const mapped = this.config.getCategoryColor(value, globalColIndex, categoryCount) ?? neutralColor;
                    r = mapped[0];
                    g = mapped[1];
                    b = mapped[2];
                    break;
                }
                case "constant":
                default:
                    break;
            }

            const offset = idx * 4;
            colorsArr[offset + 0] = r;
            colorsArr[offset + 1] = g;
            colorsArr[offset + 2] = b;
            // Set alpha to 0 for hidden cells
            colorsArr[offset + 3] = this._hiddenCellIndices.has(idx) ? 0 : 1;
        }
    }

    _clearInstances() {
        this.basePlane.thinInstanceSetBuffer("matrix", new Float32Array(0), 16);
        this.basePlane.thinInstanceSetBuffer("color", new Float32Array(0), 4);
    }

    dispose() {
        this._removeObserver?.();
        this.basePlane.dispose();
    }
}