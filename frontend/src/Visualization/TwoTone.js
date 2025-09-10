import * as BABYLON from "babylonjs";
import Color from "colorjs.io";


export const twoToneConfig = {

    minValue: 0,
    maxValue: 1,
    intervals: 8,
    colorMapping(value, paletteList, colIndex) {
        const A = (this.maxValue - this.minValue) / this.intervals;

        const v = Math.max(this.minValue, Math.min(this.maxValue, value));
        let i = Math.floor((v - this.minValue) / A);
        if (i >= this.intervals) i = this.intervals - 1;

        const splitRatio = (v - (this.minValue + A * i)) / A;
        const palette = paletteList[colIndex % paletteList.length];

        // Normalize here
        const c1 = palette[i];
        const c2 = palette[Math.min(i + 1, palette.length - 1)];

        return { c1, c2, splitRatio };
    }
    ,

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
        const { positionMatrix, dataArray, columnMetadata } = layout.computeCellPositions();
        this.positionMatrix = positionMatrix;
        this.dataArray = dataArray;
        this.config = twoToneConfig;
        this.scene = scene;
        this.layout = layout;

        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.numCols = layout.numCols;
        this.numRows = layout.numRows;

        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneTwoTone",
            { height: this.cellHeight, width: this.cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );


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

        BABYLON.Effect.ShadersStore["twoToneFragmentShader"] = `
            precision highp float;
            varying vec2 vUV;
            varying float vSplit;
            varying vec4 vColor1;
            varying vec4 vColor2;
            void main(void) {
                if (vUV.x > vSplit) {
                    gl_FragColor = vColor1;
                } else {
                    gl_FragColor = vColor2;
                }
            }
        `;

        const shaderMat = new BABYLON.ShaderMaterial("twoToneMat", scene, {
            vertex: "twoTone",
            fragment: "twoTone"
        }, {
            attributes: ["position", "uv", "world0", "world1", "world2", "world3", "split", "splitColor1", "splitColor2"],
            uniforms: ["viewProjection"]
        });

        this.basePlane.material = shaderMat;
    }

    render(paletteCount = 5) {
        const splitArr = [];
        const color1Arr = [];
        const color2Arr = [];
        const neutralColor = [1, 1, 1];
        const paletteList = this.config.colorList.slice(0, paletteCount);
        console.log(`first element in dataArray: ${this.dataArray.slice(0, 18)}`);
        for (let idx = 0; idx < this.dataArray.length; idx++) {
            const value = this.dataArray[idx];
            const colIndex = idx % this.numCols;
            const colKey = this.layout.columnKeys[colIndex];
            const meta = this.layout.columnMetadata[colKey];



            switch (meta.type) {
                case 'numeric':
                case 'date': {
                    const { c1, c2, splitRatio } = this.config.colorMapping(value, paletteList, colIndex);
                    color1Arr.push(c1[0] / 255, c1[1] / 255, c1[2] / 255, 1);
                    color2Arr.push(c2[0] / 255, c2[1] / 255, c2[2] / 255, 1);
                    splitArr.push(splitRatio);
                    break;
                }
                case 'categorical': {
                    const palette = paletteList[colIndex % paletteList.length];
                    // Use normalized value to pick a color from the palette
                    const categoryIndex = Math.round(value * (meta.categories.length - 1));
                    const color = palette[categoryIndex % palette.length];
                    // Use same color for c1 and c2 to create a solid fill
                    color1Arr.push(color[0] / 255, color[1] / 255, color[2] / 255, 1);
                    color2Arr.push(color[0] / 255, color[1] / 255, color[2] / 255, 1);
                    splitArr.push(1.0); // Full bar
                    break;
                }
                case 'constant':
                default: {
                    // Use a neutral color for constant data
                    color1Arr.push(...neutralColor, 1);
                    color2Arr.push(...neutralColor, 1);
                    splitArr.push(1.0); // Full bar
                    break;
                }
            }
        }

        this.basePlane.thinInstanceSetBuffer("matrix", this.positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("split", splitArr, 1);
        this.basePlane.thinInstanceSetBuffer("splitColor1", color1Arr, 4);
        this.basePlane.thinInstanceSetBuffer("splitColor2", color2Arr, 4);
    }
}
