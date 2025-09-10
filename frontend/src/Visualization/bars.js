import * as BABYLON from "babylonjs";

export class BarsVisualization {
    constructor(layout, scene) {
        const { positionMatrix, dataArray } = layout.computeCellPositions();
        this.positionMatrix = positionMatrix;
        this.dataArray = dataArray;
        this.layout = layout;
        this.scene = scene;
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.numCols = layout.numCols;
        this.numRows = layout.numRows;

        // 1) Create one template plane
        this.basePlane = BABYLON.MeshBuilder.CreatePlane("barPlane", {
            width: this.cellWidth,
            height: this.cellHeight,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);

        // 2) Inject custom shaders
        BABYLON.Effect.ShadersStore["barsVertexShader"] = `
            precision highp float;
            attribute vec3 position;
            attribute vec2 uv;
            attribute vec4 world0;
            attribute vec4 world1;
            attribute vec4 world2;
            attribute vec4 world3;
            attribute float split;
            attribute vec4 leftColor;
            uniform mat4 viewProjection;
            varying vec2 vUV;
            varying float vSplit;
            varying vec4 vLeftColor;
            void main() {
                vUV        = uv;
                vSplit     = split;
                vLeftColor = leftColor;        
                mat4 world = mat4(world0, world1, world2, world3);
                gl_Position = viewProjection * world * vec4(position, 1.0);
            }
        `;
        BABYLON.Effect.ShadersStore["barsFragmentShader"] = `
            precision highp float;
            varying vec2 vUV;
            varying float vSplit;
            varying vec4 vLeftColor;
            void main() {
                if (vUV.x < vSplit) {
                    gl_FragColor = vLeftColor;
                } else {
                    gl_FragColor = vec4(0.827, 0.827, 0.827, 0.9);
                }
            }
        `;

        const mat = new BABYLON.ShaderMaterial("barsMat", scene, {
            vertex: "bars",
            fragment: "bars"
        }, {
            attributes: [
                "position", "uv",
                "world0", "world1", "world2", "world3",
                "split", "leftColor"       // ← add it here
            ],
            uniforms: ["viewProjection"]
        });
        mat.backFaceCulling = false;  
        this.basePlane.material = mat;
    }

    render(numColors = 6) {
        const colors = [[107, 174, 214],
        [116, 196, 118],
        [150, 150, 150],
        [253, 141, 60],
        [158, 154, 200],
        [251, 106, 74]];
        const splitArr = [];
        const colorArr = [];
        console.log(this.dataArray.slice(0, 14));
        for (let i = 0; i < this.dataArray.length; i++) {
            const index = (i % this.numCols) % numColors;
            let t = this.dataArray[i];
            if (t == null || isNaN(t)) { t = 1.0; }         
            t = Math.max(0, Math.min(1, t));
            splitArr.push(t);
            colorArr.push(colors[index][0] / 255, colors[index][1] / 255, colors[index][2] / 255, 1);



        }

        this.basePlane.thinInstanceSetBuffer("matrix", this.positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("split", splitArr, 1);
        this.basePlane.thinInstanceSetBuffer("leftColor", colorArr, 4);
    }

    dispose() {
        this.basePlane.dispose();
    }
}

export default BarsVisualization;

