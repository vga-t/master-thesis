import * as BABYLON from "babylonjs";

/**
 * Focus+Context manager: dynamically rescales rows (thin instances) around a focused row.
 * - Precomputes decomposed transforms for every cell (scale, rotation, translation)
 * - On focus row change, builds a new matrix buffer with adjusted Y scale factors
 * - Applies to all provided visualization base planes (e.g., heatMap, twoTone)
 */
export class FocusContext {
    /**
     * @param {object} layout - Layout instance (expects numRows, numCols, cellHeight, height).
     * @param {Array<{basePlane: BABYLON.Mesh, positionMatrix: number[]|Float32Array}>} visualizations
     * @param {object} config - Optional configuration.
     *   config.distanceScale: map distance->scaleFactor (relative multiplier on original Y scale)
     *   config.outsideScale: scale for rows outside configured distances
     *   config.applyAxis: axes to scale (default only Y)
     */
    constructor(layout, visualizations, config = {}) {
        this.layout = layout;
        this.visualizations = visualizations.filter(v => v && v.basePlane);
        this.numCols = layout.numCols;
        this.numRows = layout.numRows;

        const defaultConfig = {
            distanceScale: { 0: 4.0, 1: 2.0, 2: 1.5, 3: 1.2 },
            outsideScale: 1.0,
            applyAxis: { x: false, y: true, z: false }
        };
        this.config = { ...defaultConfig, ...config, distanceScale: { ...defaultConfig.distanceScale, ...config.distanceScale } };

        // Precompute decomposed transforms per visualization
        // Structure: perVisDecomp[vizIndex][instanceIndex] = {scale: Vector3, rot: Quaternion, trans: Vector3}
        this.perVisDecomp = [];
        this._precompute();
        this._lastFocusedRow = null;
    }

    _precompute() {
        this.perVisDecomp.length = 0;
        const instanceCount = this.numCols * this.numRows;
        const tmpScale = new BABYLON.Vector3();
        const tmpRot = new BABYLON.Quaternion();
        const tmpTrans = new BABYLON.Vector3();

        this.visualizations.forEach(viz => {
            const matrices = viz.positionMatrix; // array of 16 * instanceCount
            const decompList = new Array(instanceCount);
            for (let i = 0; i < instanceCount; i++) {
                const offset = i * 16;
                const m = BABYLON.Matrix.FromArray(matrices, offset);
                m.decompose(tmpScale, tmpRot, tmpTrans);
                // Store clones to avoid mutation on reuse
                decompList[i] = {
                    scale: tmpScale.clone(),
                    rot: tmpRot.clone(),
                    trans: tmpTrans.clone()
                };
            }
            this.perVisDecomp.push(decompList);
        });
    }

    /**
     * Compute scale multiplier (relative) for a row given focused row.
     */
    _rowScaleMultiplier(row, focusedRow) {
        const dist = Math.abs(row - focusedRow);
        const table = this.config.distanceScale;
        return table.hasOwnProperty(dist) ? table[dist] : this.config.outsideScale;
    }

    /**
     * Apply focus scaling for a focused row. No-op if same as last row.
     * @param {number} focusedRow
     */
    apply(focusedRow) {
        if (focusedRow == null || focusedRow < 0 || focusedRow >= this.numRows) return;
        if (focusedRow === this._lastFocusedRow) return; // avoid redundant work
        this._lastFocusedRow = focusedRow;

        const instanceCount = this.numCols * this.numRows;
        const { applyAxis } = this.config;

        this.visualizations.forEach((viz, vIdx) => {
            const decompList = this.perVisDecomp[vIdx];
            const newMatrices = new Float32Array(instanceCount * 16);
            for (let i = 0; i < instanceCount; i++) {
                const row = Math.floor(i / this.numCols);
                const mult = this._rowScaleMultiplier(row, focusedRow);
                const base = decompList[i];
                // Construct new scale
                const newScale = base.scale.clone();
                if (applyAxis.x) newScale.x *= mult;
                if (applyAxis.y) newScale.y *= mult;
                if (applyAxis.z) newScale.z *= mult;
                const composed = BABYLON.Matrix.Compose(newScale, base.rot, base.trans);
                composed.copyToArray(newMatrices, i * 16);
            }
            viz.basePlane.thinInstanceSetBuffer("matrix", newMatrices, 16);
        });
    }
}

export default FocusContext;