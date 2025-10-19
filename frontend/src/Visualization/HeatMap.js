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

        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneHeatMap",
            { height: layout.cellHeight, width: layout.cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );
        this.basePlane.material = new BABYLON.StandardMaterial("planeMaterial", scene);

        this._removeObserver = this.layout.addObserver(snapshot => this.render(snapshot));
    }

    render(snapshot = this.layout.getVisibleSnapshot()) {
        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this.basePlane.thinInstanceSetBuffer("matrix", new Float32Array(0), 16);
            this.basePlane.thinInstanceSetBuffer("color", new Float32Array(0), 4);
            return;
        }

        const { positionMatrix, normalizedData, columnKeys, colCount } = snapshot;
        const colorsArr = new Float32Array(normalizedData.length * 4);
        const neutralColor = [0.5, 0.5, 0.5];

        for (let idx = 0; idx < normalizedData.length; idx++) {
            const value = normalizedData[idx];
            const colIndex = idx % colCount;
            const colKey = columnKeys[colIndex];
            const meta = this.layout.columnMetadata[colKey];
            const colorIndex = colIndex % this.colorListLength;

            let r = neutralColor[0];
            let g = neutralColor[1];
            let b = neutralColor[2];

            switch (meta?.type) {
                case "numeric":
                case "date": {
                    const mapped = this.colorMapping(value, colorIndex) ?? [0.5, 0.5, 0.5];
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

        this.basePlane.thinInstanceSetBuffer("matrix", positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("color", colorsArr, 4);
    }

    dispose() {
        this._removeObserver?.();
        this.basePlane.dispose();
    }
}