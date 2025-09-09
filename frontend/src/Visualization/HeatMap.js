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
        const { positionMatrix, dataArray, columnMetadata } = layout.computeCellPositions();
        this.positionMatrix = positionMatrix;
        this.dataArray = dataArray;
        this.config = heatMapConfig; // Store config
        this.layout = layout; // Store layout for metadata
        this.colorMapping = heatMapConfig.colorMapping.bind(heatMapConfig);
        this.colorListLength = heatMapConfig.colorListLength;
        // set cell dimensions from layout
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.numCols = layout.numCols;
        this.numRows = layout.numRows;
        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneHeatMap",
            { height: this.cellHeight, width: this.cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );
        // this.basePlane.position = new BABYLON.Vector3(0, 3, 0);
        this.basePlane.material = new BABYLON.StandardMaterial("planeMaterial", scene);
        // remove invisibility to show the heatmap
        // this.basePlane.isVisible = false;
    }

    render() {
        const colorsArr = [];
        const neutralColor = [0.5, 0.5, 0.5]; // Gray for constant columns

        for (let idx = 0; idx < this.dataArray.length; idx++) {
            const data = this.dataArray[idx];
            const colIndex = idx % this.numCols;
            const colKey = this.layout.columnKeys[colIndex];
            const meta = this.layout.columnMetadata[colKey];
            const colorIndex = colIndex % this.colorListLength;

            switch (meta.type) {
                case 'numeric':
                case 'date': {
                    const [r, g, b] = this.colorMapping(data, colorIndex);
                    colorsArr.push(r, g, b, 1);
                    break;
                }
                case 'categorical': {
                    // Use hue from colorList, but keep lightness constant for categories
                    const baseColor = this.config.colorList[colorIndex];
                    const categoryIndex = Math.round(data * (meta.categories.length - 1));
                    // Simple variation to distinguish categories, e.g., by lightness steps
                    const lightness = 40 + (categoryIndex % 5) * 10;
                    baseColor.l = lightness;
                    const [r, g, b] = baseColor.srgb;
                    colorsArr.push(r, g, b, 1);
                    break;
                }
                case 'constant':
                default: {
                    colorsArr.push(...neutralColor, 1);
                    break;
                }
            }
        }

        this.basePlane.thinInstanceSetBuffer("matrix", this.positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("color", colorsArr, 4);
    }
}