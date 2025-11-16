import * as BABYLON from "babylonjs";
import Color from "colorjs.io";

export const heatMapConfig = {
    colorComponentRange: [35, 65],

    colorList: [
        new Color("hsl", [0, 100, 0], 1),
        new Color("hsl", [60, 100, 0.5], 1),
        new Color("hsl", [120, 100, 0.5], 1),
        new Color("hsl", [240, 100, 0.5], 1),
        new Color("hsl", [180, 100, 0.5], 1)
    ],

    get colorListLength() {
        return this.colorList.length;
    },

    colorMapping(dataValue, colorIndex) {
        const lightnessValue = this.colorComponentRange[0] * (1 - dataValue) + this.colorComponentRange[1] * dataValue;
        this.colorList[colorIndex].l = lightnessValue;
        return this.colorList[colorIndex].srgb;
    }
};


export class HeatMapVisualization {
    constructor(layout, { heatMapConfig }, scene) {
        this.layout = layout;
        this.config = heatMapConfig;
        this.scene = scene;
        this.colorMapping = heatMapConfig.colorMapping.bind(heatMapConfig);
        this.colorListLength = heatMapConfig.colorListLength;

        this._currentCellWidth = layout.cellWidth;
        this._currentCellHeight = layout.cellHeight;

        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneHeatMap",
            { height: layout.cellHeight, width: layout.cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );
        this.basePlane.material = new BABYLON.StandardMaterial("planeMaterial", scene);

        this._colorBuffer = new Float32Array(0);

        this._removeObserver = this.layout.addObserver((snapshot, changeType = "geometry_and_data") =>
            this._handleLayoutUpdate(snapshot, changeType)
        );
    }

    _handleLayoutUpdate(snapshot, changeType = "geometry_and_data") {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }

        // Check if cell dimensions changed and recreate basePlane to avoid z-fighting
        if (changeType === "cell_size_changed" || changeType === "geometry_and_data") {
            const newCellWidth = this.layout.cellWidth;
            const newCellHeight = this.layout.cellHeight;

            if (Math.abs(newCellWidth - this._currentCellWidth) > 1e-6 ||
                Math.abs(newCellHeight - this._currentCellHeight) > 1e-6) {
                this._recreateBasePlane(newCellWidth, newCellHeight);
            }
        }

        if (changeType === "data_only") {
            this.renderData(snapshot);
            return;
        }

        this.renderGeometry(snapshot);
        this.renderData(snapshot);
    }

    _recreateBasePlane(newCellWidth, newCellHeight) {
        // Store current material and visibility state
        const material = this.basePlane.material;
        const isPickable = this.basePlane.isPickable;
        const isVisible = this.basePlane.isVisible;

        // Clear instances first to prevent z-fighting
        this._clearInstances();

        // Dispose old mesh
        this.basePlane.dispose(false, false); // Don't dispose material or children

        // Create new mesh with updated dimensions
        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneHeatMap",
            { height: newCellHeight, width: newCellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            this.scene
        );

        // Restore properties
        this.basePlane.material = material;
        this.basePlane.isPickable = isPickable;
        this.basePlane.isVisible = isVisible;
        this.basePlane.thinInstanceEnablePicking = true;

        // Update tracked dimensions
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

    renderData(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this._clearInstances();
            return;
        }

        const { normalizedData, columnKeys, columnIndices, colCount } = snapshot;
        const requiredSize = normalizedData.length * 4;

        if (this._colorBuffer.length < requiredSize) {
            this._colorBuffer = new Float32Array(requiredSize);
        }
        const colorsArr = this._colorBuffer.subarray(0, requiredSize);

        const neutralColor = [0.5, 0.5, 0.5];

        // Pre-calculate column metadata and color indices
        const colMeta = [];
        const colColorIndices = [];
        for (let c = 0; c < colCount; c++) {
            const colKey = columnKeys[c];
            colMeta.push(this.layout.columnMetadata[colKey]);
            colColorIndices.push(columnIndices[c] % this.colorListLength);
        }

        for (let idx = 0; idx < normalizedData.length; idx++) {
            const value = normalizedData[idx];
            const colIndex = idx % colCount;
            const meta = colMeta[colIndex];
            const colorIndex = colColorIndices[colIndex];

            let r = neutralColor[0];
            let g = neutralColor[1];
            let b = neutralColor[2];

            switch (meta?.type) {
                case "numeric":
                case "date": {
                    const mapped = this.colorMapping(value, colorIndex) ?? neutralColor;
                    r = mapped[0];
                    g = mapped[1];
                    b = mapped[2];
                    break;
                }
                case "categorical": {
                    const baseColor = this.config.colorList[colorIndex];
                    const categoryIndex = meta.categories.length > 1 ? Math.round(value * (meta.categories.length - 1)) : 0;
                    const lightness = 40 + (categoryIndex % 5) * 10;
                    baseColor.l = lightness;
                    const [cr, cg, cb] = baseColor.srgb;
                    r = cr;
                    g = cg;
                    b = cb;
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
            colorsArr[offset + 3] = 1;
        }

        this.basePlane.thinInstanceSetBuffer("color", colorsArr, 4);
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