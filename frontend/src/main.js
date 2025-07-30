import * as BABYLON from "babylonjs";
import Papa from "papaparse";
import Color from "colorjs.io";



let csvData;
Papa.parse("http://localhost:8000/csv",
    {
        download: true,
        header: true,
        complete: (results) => {
            console.log("Parsing complete");
            csvData = results.data;
            console.log(`row size: ${csvData.length}, column size:${Object.keys(csvData[0]).length}`);
            createScene(csvData.slice(0, 50));
            // createScene(csvData);
        },
        error: (error) => {
            console.error("Error parsing CSV:", error);
        }
    }
)

// const colorComponentRange = [35,65];
const colorComponentRange = [30, 90];

const redColor = new Color("hsl", [0, 100, 0], 1);
const yellowColor = new Color("hsl", [60, 100, 0.5], 1);
const greenColor = new Color("hsl", [120, 100, 0.5], 1);
const blueColor = new Color("hsl", [240, 100, 0.5], 1);
const cyanColor = new Color("hsl", [180, 100, 0.5], 1);

let r, g, b;

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
    const curvature = 50;
    const cellHeight = 1;
    const cellWidth = 2;
    const basePlane = BABYLON.MeshBuilder.CreatePlane("basePlane", { height: cellHeight, width: cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE });
    basePlane.position = new BABYLON.Vector3(0, 3, 0);
    const planeMaterial = new BABYLON.StandardMaterial("planeMaterial", scene);
    basePlane.material = planeMaterial;
    basePlane.isVisible = true;
    // Prepare thin instance buffers
    const matrices = [];
    const colorsArr = [];
    // Calculate instance data
    let columnsCount = Object.keys(csv[0]).length;
    const minCellYPos = 0;
    const maxCellYPos = (columnsCount - 1) * cellWidth;
    let CellXPos = csv.length;
    console.log(csv[0]);

    for (let row of csv) {
        let CellYPos = 0;
        let colIndex = 0;
        for (let column in row) {
            colIndex++;
            const x = CellYPos;
            const y = CellXPos;
            const z = -curvature * Math.sin((CellYPos - minCellYPos) / (maxCellYPos - minCellYPos) * Math.PI);
            const matrix = BABYLON.Matrix.Translation(x, y, z);
            matrices.push(...matrix.asArray());
            const [r, g, b] = colorMapping(row[column], colIndex % colorListLength);
            colorsArr.push(r, g, b, 1);
            CellYPos += cellWidth;
        }
        CellXPos -= cellHeight;
    }
    // Apply thin instance buffers
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

    console.log(`row size: ${csv.length}, column size:${Object.keys(csv[0]).length}`)
    var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -10), scene);
    camera.attachControl(canvas, true);
    camera.position.z = 100;
    camera.setTarget(BABYLON.Vector3.Zero());
    var light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), scene);
    light.intensity = 0.7;

    engine.runRenderLoop(() => {
        scene.render();
    });
    renderVisualization(csv, scene);
    // const ground = BABYLON.CreateGround("ground",{ height:50, width: 50,sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene)
    const ground = BABYLON.MeshBuilder.CreateGround("ground", {
        height: 500,
        width: 500, subdivisions: 1
    }, scene);
    ground.position.x = 101.22;
    ground.position.y = -10;
    ground.position.z = -28.75;
    const xr = await scene.createDefaultXRExperienceAsync({
        floorMeshes: [ground]
    });
    const featuresManager = xr.baseExperience.featuresManager;
    const pointerSelection = featuresManager.enableFeature(
        BABYLON.WebXRFeatureName.POINTER_SELECTION,
        "latest",
        { xrInput: xr.input }
    );
    scene.debugLayer.show();




    console.log("Red → X-axis \nGreen → Y-axis \nBlue → Z-axis");
    //scene.debugLayer.show();

    window.addEventListener("resize", () => {
        engine.resize();
    });

    return scene;
}
// function tryHttp() {
//     fetch("http://localhost:8000/process")
//         .then(res => {
//             if (!res.ok) throw new Error("Something went wrong!");
//             return res.json();
//         })
//         .then(data => console.log(data))
//         .catch(err => console.error(err));

// }
