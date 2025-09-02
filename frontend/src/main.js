import * as BABYLON from "babylonjs";
import Color from "colorjs.io";

import SceneManager from "./SceneManager.js";
import loadCSV from "./dataLoader.js";
import LCVDSLayout from "./LCVDSLayout.js";


const csvData = await loadCSV("http://localhost:8000/csv");
const sceneManager = new SceneManager("renderCanvas");
const scene = sceneManager.scene;
const layout = new LCVDSLayout(csvData, { arcAngle: Math.PI * 0.5, radius: 3.5, height: 1.8 }, scene);


// sceneManager.scene.debugLayer.show();

const colorComponentRange = [35, 65];

const redColor = new Color("hsl", [0, 100, 0], 1);
const yellowColor = new Color("hsl", [60, 100, 0.5], 1);
const greenColor = new Color("hsl", [120, 100, 0.5], 1);
const blueColor = new Color("hsl", [240, 100, 0.5], 1);
const cyanColor = new Color("hsl", [180, 100, 0.5], 1);

// let r, g, b;

const colorList = [redColor, yellowColor, greenColor, blueColor, cyanColor];
const colorListLength = colorList.length;

function colorMapping(dataValue, colorIndex) {
    const lightnessValue = colorComponentRange[0] * (1 - dataValue) + colorComponentRange[1] * dataValue;
    colorList[colorIndex].l = lightnessValue;
    return colorList[colorIndex].srgb;
}

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.lang = "en-US";
recognition.interimResults = false;
recognition.maxAlternatives = 1;
let isRecording = false;
let fullTranscript;

document.addEventListener("keypress", event => {
    if (event.key.toLowerCase() == "r") {
        isRecording = !isRecording;
        if (isRecording) {
            recognition.start();
            console.log("Start recording");
        }
        else {
            recognition.stop();
            console.log("Stop recording");
        }
    }
    if (event.key.toLowerCase() == "d") {
        const baseMesh = scene.getMeshByName("basePlane");
        if (baseMesh) {
            baseMesh.dispose();
            console.log("Removing base mesh and all its instances!");
        }
        else { console.error("No base mesh found to remove!"); }
    }

})

recognition.addEventListener("result", (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        fullTranscript += transcript + " ";
    }
    console.log(`Full transcript:${fullTranscript}`);
    fullTranscript = "";
})


function renderVisualization(csv, scene) {
    // --- Parameters for the new curved display ---
    // User-defined parameters
    const cellWidth = 5;               // Width of each cell
    const cellHeight = 5;              // Height of each cell
    const arcAngle = 0.5 * Math.PI;    // Total arc angle in radians (90 degrees as an example)

    // Determine grid dimensions
    const numRows = csv.length;
    const numCols = Object.keys(csv[0]).length;

    // Compute the radius needed so that the arc length (radius * arcAngle) equals the total width of the cells
    const radius = (numCols * cellWidth) / arcAngle;

    // Calculate angle increment for columns
    const colStepAngle = arcAngle / numCols;
    const startAngle = -arcAngle / 2;

    // Create the base plane mesh as the template for thin instances
    const basePlane = BABYLON.MeshBuilder.CreatePlane("basePlane", { height: cellHeight, width: cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    basePlane.position = new BABYLON.Vector3(0, 3, 0);
    const planeMaterial = new BABYLON.StandardMaterial("planeMaterial", scene);
    basePlane.material = planeMaterial;
    basePlane.isVisible = true;

    // Prepare buffers for thin instances
    const matrices = [];
    const colorsArr = [];

    let rowIndex = 0;
    for (let row of csv) {
        let colIndex = 0;
        for (let column in row) {
            // Calculate the cell's angle along the arc, centered within its column segment
            const cellAngle = startAngle + (colIndex * colStepAngle) + (colStepAngle / 2);

            // Compute position on the arc
            const x = radius * Math.sin(cellAngle);
            // Adjust z so that when angle=0 the cell is at z = 0
            const z = radius * Math.cos(cellAngle) - radius;
            // Center rows vertically using cellHeight
            const y = (rowIndex - numRows / 2 + 0.5) * cellHeight;

            // Create a transformation matrix with rotation so cell is tangent to the arc
            const scaling = new BABYLON.Vector3(1, 1, 1);
            // Rotation: Rotate around Y axis by cellAngle so the cell faces outward along the arc
            const rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(cellAngle, 0, 0);
            const translation = new BABYLON.Vector3(x, y, z);
            const finalMatrix = BABYLON.Matrix.Compose(scaling, rotationQuaternion, translation);

            matrices.push(...finalMatrix.asArray());

            // Compute color for the cell
            const [r, g, b] = colorMapping(row[column], (colIndex) % colorListLength);
            colorsArr.push(r, g, b, 1);

            colIndex++;
        }
        rowIndex++;
    }

    // Apply thin instance buffers: 16 floats per matrix, 4 floats per color
    basePlane.thinInstanceSetBuffer("matrix", matrices, 16);
    basePlane.thinInstanceSetBuffer("color", colorsArr, 4);
}
const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

async function createScene(csv) {


    // // Access the WebGL context from Babylon's engine
    // const gl = engine._gl; // Undocumented, but works across versions
    // const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    // if (debugInfo) {
    //     const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
    //     const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    //     console.log("GPU Vendor:", vendor);
    //     console.log("GPU Renderer:", renderer);
    // } else {
    //     console.log("WEBGL_debug_renderer_info not supported");
    // }

    // console.log(`row size: ${csv.length}, column size:${Object.keys(csv[0]).length}`)
    // // --- Parameters for the new curved display ---
    // const cellWidth = 5;
    // const cellHeight = 5;
    // const arcAngle = 0.5 * Math.PI;
    // const numRows = csv.length;
    // const numCols = Object.keys(csv[0]).length;
    // const radius = (numCols * cellWidth) / arcAngle;
    // // Calculate the lowest y (bottom row)
    // const minY = (-numRows / 2 + 0.5) * cellHeight;
    // // Calculate the center of the grid
    // const centerY = 0;
    // const centerX = 0;
    // const centerZ = 0;

    // Place camera at a radius distance from center, gazing toward the grid
    // var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(radius * 1.2, centerY, 0), scene);
    // camera.attachControl(canvas, true);
    // camera.setTarget(new BABYLON.Vector3(centerX, centerY, centerZ));

    // var light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), scene);
    // light.intensity = 0.7;

    // engine.runRenderLoop(() => {
    //     scene.render();
    // });
    renderVisualization(csv, scene);

    // // Place the ground just below the lowest row
    // const ground = BABYLON.MeshBuilder.CreateGround("ground", {
    //     height: 500,
    //     width: 500, subdivisions: 1
    // }, scene);
    // ground.position.x = 0;
    // ground.position.y = minY - 1;
    // ground.position.z = 0;

    // const xr = await scene.createDefaultXRExperienceAsync({
    //     floorMeshes: [ground]
    // });
    const featuresManager = xr.baseExperience.featuresManager;
    const pointerSelection = featuresManager.enableFeature(
        BABYLON.WebXRFeatureName.POINTER_SELECTION,
        "latest",
        { xrInput: xr.input }
    );

    // console.log("Red → X-axis \nGreen → Y-axis \nBlue → Z-axis");
    // scene.debugLayer.show();

    // window.addEventListener("resize", () => {
    //     engine.resize();
    // });

    return scene;
}

