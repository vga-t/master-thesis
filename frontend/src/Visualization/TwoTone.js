import * as BABYLON from "babylonjs";
import Color from "colorjs.io";


export const twoToneConfig = {
    minValue: 0,
    maxValue: 1,
    colorMapping(value, paletteList, colIndex, intervals = 4) {
        const { minValue, maxValue } = this;

        // clamp input value
        const v = Math.max(minValue, Math.min(maxValue, value));
        // pick the original palette for this column
        const orig = paletteList[colIndex % paletteList.length];
        const P = orig.length;

        // build a small palette of (intervals + 1) stops evenly spaced
        const stops = [];
        for (let j = 0; j <= intervals; j++) {
            const idx = Math.round(j * (P - 1) / intervals);
            stops.push(orig[idx]);
        }
        const scaled = (v - minValue) / (maxValue - minValue) * intervals;
        let i = Math.floor(scaled);
        if (i >= intervals) i = intervals - 1;
        const t = scaled - i;

        const c1 = stops[i];
        const c2 = stops[i + 1];
        return { c1, c2, splitRatio: t };
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
        this.layout = layout;
        this.config = twoToneConfig;
        this.scene = scene;

        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "basePlaneTwoTone",
            { height: layout.cellHeight, width: layout.cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            scene
        );


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
                    if (vUV.x > vSplit) {
                        gl_FragColor = vColor1;
                    } else {
                        gl_FragColor = vColor2;
                    }
                }
            `;
        }

        const shaderMat = new BABYLON.ShaderMaterial("twoToneMat", scene, {
            vertex: "twoTone",
            fragment: "twoTone"
        }, {
            attributes: ["position", "uv", "world0", "world1", "world2", "world3", "split", "splitColor1", "splitColor2"],
            uniforms: ["viewProjection"]
        });

        this.basePlane.material = shaderMat;

        this._lastPaletteCount = 6;
        this._lastIntervals = undefined;
        this._removeObserver = this.layout.addObserver(snapshot => this._handleLayoutUpdate(snapshot));
    }

    _handleLayoutUpdate(snapshot) {
        this.render(this._lastPaletteCount, this._lastIntervals, snapshot);
    }

    render(paletteCount = 6, intervals = undefined, snapshot = this.layout.getVisibleSnapshot()) {
        this._lastPaletteCount = paletteCount;
        this._lastIntervals = intervals;

        if (!snapshot || snapshot.rowCount === 0 || snapshot.colCount === 0) {
            this.basePlane.thinInstanceSetBuffer("matrix", new Float32Array(0), 16);
            this.basePlane.thinInstanceSetBuffer("split", new Float32Array(0), 1);
            this.basePlane.thinInstanceSetBuffer("splitColor1", new Float32Array(0), 4);
            this.basePlane.thinInstanceSetBuffer("splitColor2", new Float32Array(0), 4);
            return;
        }

        const { positionMatrix, normalizedData, columnKeys, columnIndices, colCount } = snapshot;

        const splitArr = new Float32Array(normalizedData.length);
        const color1Arr = new Float32Array(normalizedData.length * 4);
        const color2Arr = new Float32Array(normalizedData.length * 4);
        const neutralColor = [1, 1, 1];
        const paletteListRaw = this.config.colorList.slice(0, Math.max(1, paletteCount));
        const paletteList = paletteListRaw.length ? paletteListRaw : this.config.colorList;

        for (let idx = 0; idx < normalizedData.length; idx++) {
            const value = normalizedData[idx];
            const colIndex = idx % colCount;
            const colKey = columnKeys[colIndex];
            const meta = this.layout.columnMetadata[colKey];
            const globalCol = columnIndices[colIndex];

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
                    const categoryIndex = meta.categories.length > 1 ? Math.round(value * (meta.categories.length - 1)) : 0;
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
            color1Arr[offset + 3] = 1;

            color2Arr[offset + 0] = (colorTwo[0] ?? neutralColor[0]) / 255;
            color2Arr[offset + 1] = (colorTwo[1] ?? neutralColor[1]) / 255;
            color2Arr[offset + 2] = (colorTwo[2] ?? neutralColor[2]) / 255;
            color2Arr[offset + 3] = 1;
        }

        this.basePlane.thinInstanceSetBuffer("matrix", positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("split", splitArr, 1);
        this.basePlane.thinInstanceSetBuffer("splitColor1", color1Arr, 4);
        this.basePlane.thinInstanceSetBuffer("splitColor2", color2Arr, 4);
    }

    dispose() {
        this._removeObserver?.();
        this.basePlane.dispose();
    }
}
