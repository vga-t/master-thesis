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
        const { positionMatrix, dataArray } = layout.computeCellPositions();
        this.positionMatrix = positionMatrix;
        this.dataArray = dataArray;
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
        this.basePlane.position = new BABYLON.Vector3(0, 3, 0);
        this.basePlane.material = new BABYLON.StandardMaterial("planeMaterial", scene);
        // remove invisibility to show the heatmap
        // this.basePlane.isVisible = false;
    }

    render() {
        // generate [r,g,b,1] for each cell
        const colorsArr = this.dataArray.flatMap((data, index) => {
            const [r, g, b] = this.colorMapping(data, index % this.numCols % this.colorListLength);
            return [r, g, b, 1];
        });

        this.basePlane.thinInstanceSetBuffer("matrix", this.positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("color", colorsArr, 4);
    }
}