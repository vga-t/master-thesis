import * as BABYLON from "babylonjs";

const _stopsCache = new Map();

export const twoToneConfig = {
    minValue: 0,
    maxValue: 1,
    colorMapping(value, paletteList, colIndex, intervals = 4) {
        const { minValue, maxValue } = this;

        // clamp input value
        const v = Math.max(minValue, Math.min(maxValue, value));
        const pIdx = colIndex % paletteList.length;
        const orig = paletteList[pIdx];
        const cacheKey = `${pIdx}_${intervals}`;
        let stops = _stopsCache.get(cacheKey);

        if (!stops) {
            const P = orig.length;
            stops = [];
            for (let j = 0; j <= intervals; j++) {
                const tStop = intervals > 0 ? (j / intervals) : 0;
                if (P <= 1) {
                    stops.push(orig[0] ?? [0, 0, 0]);
                } else {
                    const scaled = tStop * (P - 1);
                    const idx = Math.min(P - 2, Math.max(0, Math.floor(scaled)));
                    const f = scaled - idx;
                    const c1 = orig[idx];
                    const c2 = orig[idx + 1] ?? orig[idx];
                    stops.push([
                        (c1[0] ?? 0) + ((c2[0] ?? 0) - (c1[0] ?? 0)) * f,
                        (c1[1] ?? 0) + ((c2[1] ?? 0) - (c1[1] ?? 0)) * f,
                        (c1[2] ?? 0) + ((c2[2] ?? 0) - (c1[2] ?? 0)) * f
                    ]);
                }
            }
            _stopsCache.set(cacheKey, stops);
        }

        const scaled = (v - minValue) / (maxValue - minValue) * intervals;
        let i = Math.floor(scaled);
        if (i >= intervals) i = intervals - 1;
        const t = scaled - i;

        const c1 = stops[i];
        const c2 = stops[i + 1];
        return { c1, c2, splitRatio: t };
    },

    colorList: [[[247, 251, 255],
    [222, 235, 247],
    [198, 219, 239],
    [158, 202, 225],
    [107, 174, 214],
    [66, 146, 198],
    [33, 113, 181],
    [8, 81, 156],
    [8, 48, 107]],
    [[247, 252, 245],
    [229, 245, 224],
    [199, 233, 192],
    [161, 217, 155],
    [116, 196, 118],
    [65, 171, 93],
    [35, 139, 69],
    [0, 109, 44],
    [0, 68, 27]],
    [[255, 255, 255],
    [240, 240, 240],
    [217, 217, 217],
    [189, 189, 189],
    [150, 150, 150],
    [115, 115, 115],
    [82, 82, 82],
    [37, 37, 37],
    [0, 0, 0]],
    [[255, 245, 235],
    [254, 230, 206],
    [253, 208, 162],
    [253, 174, 107],
    [253, 141, 60],
    [241, 105, 19],
    [217, 72, 1],
    [166, 54, 3],
    [127, 39, 4]],
    [[252, 251, 253],
    [239, 237, 245],
    [218, 218, 235],
    [188, 189, 220],
    [158, 154, 200],
    [128, 125, 186],
    [106, 81, 163],
    [84, 39, 143],
    [63, 0, 125]],
    [[255, 245, 240],
    [254, 224, 210],
    [252, 187, 161],
    [252, 146, 114],
    [251, 106, 74],
    [239, 59, 44],
    [203, 24, 29],
    [165, 15, 21],
    [103, 0, 13]]]

};

export class TwoToneVisualization {
    constructor(layout, { twoToneConfig }, scene) {
        this.layout = layout;
        this.config = twoToneConfig;
        this.scene = scene;

        this._currentCellWidth = layout.cellWidth;
        this._currentCellHeight = layout.cellHeight;

        // Set of thin instance indices to hide (make transparent)
        this._hiddenCellIndices = new Set();

        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneTwoTone",
            { height: 1, width: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );

        this._initShaders();
        this._applyShaderMaterial();

        this._buffers = {
            split: new Float32Array(0),
            color1: new Float32Array(0),
            color2: new Float32Array(0)
        };

        // Precomputed buffers for entire dataset (computed once, sliced during scroll)
        this._precomputed = {
            split: null,
            color1: null,
            color2: null,
            paletteCount: null,
            intervals: null,
            totalRows: 0,
            totalCols: 0
        };

        this._lastPaletteCount = 6;
        this._lastIntervals = undefined;

        // Dirty flag: when invisible updates are skipped, this stores the pending changeType
        this._dirtyChangeType = null;

        this._removeObserver = this.layout.addObserver((snapshot, changeType = "geometry_and_data") =>
            this._handleLayoutUpdate(snapshot, changeType)
        );
    }

    /**
     * Precompute TwoTone colors for the entire dataset.
     * Call this once after data load or when palette/intervals change.
     * During scroll, slices of the precomputed buffers are used for rendering.
     */
    precomputeFullDataset(paletteCount = 6, intervals = undefined) {
        const totalRows = this.layout.totalRows;
        const totalCols = this.layout.totalCols;
        const precomputedData = this.layout.getPrecomputedNormalizedData?.();

        if (!precomputedData || totalRows === 0 || totalCols === 0) {
            this._precomputed.split = null;
            this._precomputed.color1 = null;
            this._precomputed.color2 = null;
            return;
        }

        const totalCount = totalRows * totalCols;

        // Allocate precomputed buffers
        this._precomputed.split = new Float32Array(totalCount);
        this._precomputed.color1 = new Float32Array(totalCount * 4);
        this._precomputed.color2 = new Float32Array(totalCount * 4);
        this._precomputed.paletteCount = paletteCount;
        this._precomputed.intervals = intervals;
        this._precomputed.totalRows = totalRows;
        this._precomputed.totalCols = totalCols;

        const neutralColor = [1, 1, 1];
        const paletteListRaw = this.config.colorList.slice(0, Math.max(1, paletteCount ?? this.config.colorList.length));
        const paletteList = paletteListRaw.length ? paletteListRaw : this.config.colorList;

        const splitArr = this._precomputed.split;
        const color1Arr = this._precomputed.color1;
        const color2Arr = this._precomputed.color2;

        // Pre-cache column metadata
        const colMeta = this.layout.columnKeys.map(key => this.layout.columnMetadata[key]);

        for (let idx = 0; idx < totalCount; idx++) {
            const value = precomputedData[idx];
            const colIndex = idx % totalCols;
            const meta = colMeta[colIndex];
            const globalCol = colIndex;

            let split = 1.0;
            let colorOne = neutralColor;
            let colorTwo = neutralColor;

            switch (meta?.type) {
                case "numeric":
                case "date": {
                    const mapping = this.config.colorMapping(value, paletteList, globalCol, intervals);
                    colorOne = mapping?.c1 ?? neutralColor;
                    colorTwo = mapping?.c2 ?? neutralColor;
                    split = mapping?.splitRatio ?? 1.0;
                    break;
                }
                case "categorical": {
                    const palette = paletteList[globalCol % paletteList.length] ?? neutralColor;
                    const categoryIndex = meta.categories?.length > 1 ? Math.round(value * (meta.categories.length - 1)) : 0;
                    const picked = palette[categoryIndex % palette.length] ?? neutralColor;
                    colorOne = picked;
                    colorTwo = picked;
                    split = 1.0;
                    break;
                }
                case "constant":
                default:
                    break;
            }

            splitArr[idx] = split;

            const offset = idx * 4;
            color1Arr[offset + 0] = (colorOne[0] ?? neutralColor[0]) / 255;
            color1Arr[offset + 1] = (colorOne[1] ?? neutralColor[1]) / 255;
            color1Arr[offset + 2] = (colorOne[2] ?? neutralColor[2]) / 255;
            color1Arr[offset + 3] = 1; // Alpha set during render based on hidden cells

            color2Arr[offset + 0] = (colorTwo[0] ?? neutralColor[0]) / 255;
            color2Arr[offset + 1] = (colorTwo[1] ?? neutralColor[1]) / 255;
            color2Arr[offset + 2] = (colorTwo[2] ?? neutralColor[2]) / 255;
            color2Arr[offset + 3] = 1;
        }
    }

    /**
     * Check if precomputed data is valid for current settings
     */
    _hasValidPrecomputed(paletteCount, intervals) {
        return this._precomputed.split !== null &&
            this._precomputed.color1 !== null &&
            this._precomputed.color2 !== null &&
            this._precomputed.paletteCount === paletteCount &&
            this._precomputed.intervals === intervals &&
            this._precomputed.totalRows === this.layout.totalRows &&
            this._precomputed.totalCols === this.layout.totalCols;
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
            this.renderData(this._lastPaletteCount, this._lastIntervals, snapshot);
        }
    }

    /**
     * Clear all hidden cells (make all visible)
     */
    clearHiddenCells() {
        this._hiddenCellIndices.clear();
        const snapshot = this.layout?.getVisibleSnapshot();
        if (snapshot) {
            this.renderData(this._lastPaletteCount, this._lastIntervals, snapshot);
        }
    }

    _initShaders() {
        if (!BABYLON.Effect.ShadersStore["twoToneVertexShader"]) {
            BABYLON.Effect.ShadersStore["twoToneVertexShader"] = `
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
                uniform mat4 viewProjection;
                varying vec2 vUV;
                varying float vSplit;
                varying vec4 vColor1;
                varying vec4 vColor2;
                void main(void) {
                    vUV = uv;
                    vSplit = split;
                    vColor1 = splitColor1;
                    vColor2 = splitColor2;
                    mat4 world = mat4(world0, world1, world2, world3);
                    gl_Position = viewProjection * world * vec4(position, 1.0);
                }
            `;
        }

        if (!BABYLON.Effect.ShadersStore["twoToneFragmentShader"]) {
            BABYLON.Effect.ShadersStore["twoToneFragmentShader"] = `
                precision highp float;
                varying vec2 vUV;
                varying float vSplit;
                varying vec4 vColor1;
                varying vec4 vColor2;
                void main(void) {
                    // Use alpha from color for visibility control
                    float alpha = vColor1.a;
                    if (alpha < 0.01) {
                        discard;
                    }
                    if (vUV.x > vSplit) {
                        gl_FragColor = vec4(vColor1.rgb, alpha);
                    } else {
                        gl_FragColor = vec4(vColor2.rgb, alpha);
                    }
                }
            `;
        }
    }

    _applyShaderMaterial() {
        const shaderMat = new BABYLON.ShaderMaterial("twoToneMat", this.scene, {
            vertex: "twoTone",
            fragment: "twoTone"
        }, {
            attributes: ["position", "uv", "world0", "world1", "world2", "world3", "split", "splitColor1", "splitColor2"],
            uniforms: ["viewProjection"]
        });

        this.basePlane.material = shaderMat;
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
            if (!this._dirtyChangeType || changeType === "geometry_and_data" || changeType === "cell_size_changed") {
                this._dirtyChangeType = changeType;
            }
            return;
        }

        // Keep tracked dimensions updated without destroying/recreating the mesh or shader program
        this._currentCellWidth = this.layout.cellWidth;
        this._currentCellHeight = this.layout.cellHeight;

        if (changeType === "data_only") {
            this.renderData(this._lastPaletteCount, this._lastIntervals, snapshot);
            return;
        }

        this.renderGeometry(snapshot);
        this.renderData(this._lastPaletteCount, this._lastIntervals, snapshot);
    }

    _recreateBasePlane(newCellWidth, newCellHeight) {
        // No-op: basePlane is an immutable unit quad scaled by the thin instance matrix, avoiding GPU shader recompilations
        this._currentCellWidth = newCellWidth;
        this._currentCellHeight = newCellHeight;
    }

    render(paletteCount = 6, intervals = undefined, snapshot = this.layout.getVisibleSnapshot()) {
        this._lastPaletteCount = paletteCount;
        this._lastIntervals = intervals;

        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }

        this.renderGeometry(snapshot);
        this.renderData(paletteCount, intervals, snapshot);
    }

    renderGeometry(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }
        this.basePlane.thinInstanceSetBuffer("matrix", snapshot.positionMatrix, 16);
    }

    renderData(paletteCount = this._lastPaletteCount, intervals = this._lastIntervals, snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }

        const { rowCount, colCount, rowOffset, colOffset, columnIndices } = snapshot;
        const count = rowCount * colCount;
        const totalCols = this.layout.totalCols;

        // Resize output buffers if needed
        if (this._buffers.split.length < count) {
            this._buffers.split = new Float32Array(count);
        }
        if (this._buffers.color1.length < count * 4) {
            this._buffers.color1 = new Float32Array(count * 4);
        }
        if (this._buffers.color2.length < count * 4) {
            this._buffers.color2 = new Float32Array(count * 4);
        }

        const splitArr = this._buffers.split.subarray(0, count);
        const color1Arr = this._buffers.color1.subarray(0, count * 4);
        const color2Arr = this._buffers.color2.subarray(0, count * 4);

        // Ensure precomputed data is available with current settings
        if (!this._hasValidPrecomputed(paletteCount, intervals)) {
            this.precomputeFullDataset(paletteCount, intervals);
        }

        // Use precomputed data if available (fast path for scrolling)
        if (this._precomputed.split && this._precomputed.color1 && this._precomputed.color2) {
            const precomputedTotalCols = this._precomputed.totalCols;

            // Copy sliced data from precomputed buffers
            for (let r = 0; r < rowCount; r++) {
                const globalRow = rowOffset + r;
                for (let c = 0; c < colCount; c++) {
                    const globalCol = columnIndices?.[c] ?? (colOffset + c);
                    const srcIdx = globalRow * precomputedTotalCols + globalCol;
                    const dstIdx = r * colCount + c;

                    splitArr[dstIdx] = this._precomputed.split[srcIdx];

                    // Copy colors and apply alpha for hidden cells
                    const alpha = this._hiddenCellIndices.has(dstIdx) ? 0 : 1;
                    const srcOffset = srcIdx * 4;
                    const dstOffset = dstIdx * 4;

                    color1Arr[dstOffset + 0] = this._precomputed.color1[srcOffset + 0];
                    color1Arr[dstOffset + 1] = this._precomputed.color1[srcOffset + 1];
                    color1Arr[dstOffset + 2] = this._precomputed.color1[srcOffset + 2];
                    color1Arr[dstOffset + 3] = alpha;

                    color2Arr[dstOffset + 0] = this._precomputed.color2[srcOffset + 0];
                    color2Arr[dstOffset + 1] = this._precomputed.color2[srcOffset + 1];
                    color2Arr[dstOffset + 2] = this._precomputed.color2[srcOffset + 2];
                    color2Arr[dstOffset + 3] = alpha;
                }
            }
        } else {
            // Fallback: compute on the fly (for dynamic or unavailable precomputed data)
            this._renderDataFallback(snapshot, paletteCount, intervals, splitArr, color1Arr, color2Arr);
        }

        this.basePlane.thinInstanceSetBuffer("split", splitArr, 1);
        this.basePlane.thinInstanceSetBuffer("splitColor1", color1Arr, 4);
        this.basePlane.thinInstanceSetBuffer("splitColor2", color2Arr, 4);
    }

    /**
     * Fallback method for computing colors on-the-fly when precomputed data is unavailable
     */
    _renderDataFallback(snapshot, paletteCount, intervals, splitArr, color1Arr, color2Arr) {
        const { normalizedData, columnKeys, columnIndices, colCount } = snapshot;
        const neutralColor = [1, 1, 1];
        const paletteListRaw = this.config.colorList.slice(0, Math.max(1, paletteCount ?? this.config.colorList.length));
        const paletteList = paletteListRaw.length ? paletteListRaw : this.config.colorList;

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
            const globalCol = colGlobalIndices[colIndex];

            let split = 1.0;
            let colorOne = neutralColor;
            let colorTwo = neutralColor;

            switch (meta?.type) {
                case "numeric":
                case "date": {
                    const mapping = this.config.colorMapping(value, paletteList, globalCol, intervals);
                    colorOne = mapping?.c1 ?? neutralColor;
                    colorTwo = mapping?.c2 ?? neutralColor;
                    split = mapping?.splitRatio ?? 1.0;
                    break;
                }
                case "categorical": {
                    const palette = paletteList[globalCol % paletteList.length] ?? neutralColor;
                    const categoryIndex = meta.categories?.length > 1 ? Math.round(value * (meta.categories.length - 1)) : 0;
                    const picked = palette[categoryIndex % palette.length] ?? neutralColor;
                    colorOne = picked;
                    colorTwo = picked;
                    split = 1.0;
                    break;
                }
                case "constant":
                default:
                    break;
            }

            splitArr[idx] = split;

            // Set alpha to 0 for hidden cells
            const alpha = this._hiddenCellIndices.has(idx) ? 0 : 1;

            const offset = idx * 4;
            color1Arr[offset + 0] = (colorOne[0] ?? neutralColor[0]) / 255;
            color1Arr[offset + 1] = (colorOne[1] ?? neutralColor[1]) / 255;
            color1Arr[offset + 2] = (colorOne[2] ?? neutralColor[2]) / 255;
            color1Arr[offset + 3] = alpha;

            color2Arr[offset + 0] = (colorTwo[0] ?? neutralColor[0]) / 255;
            color2Arr[offset + 1] = (colorTwo[1] ?? neutralColor[1]) / 255;
            color2Arr[offset + 2] = (colorTwo[2] ?? neutralColor[2]) / 255;
            color2Arr[offset + 3] = alpha;
        }
    }

    _clearInstances() {
        this.basePlane.thinInstanceSetBuffer("matrix", new Float32Array(0), 16);
        this.basePlane.thinInstanceSetBuffer("split", new Float32Array(0), 1);
        this.basePlane.thinInstanceSetBuffer("splitColor1", new Float32Array(0), 4);
        this.basePlane.thinInstanceSetBuffer("splitColor2", new Float32Array(0), 4);
    }

    dispose() {
        this._removeObserver?.();
        this.basePlane.dispose();
    }
}
