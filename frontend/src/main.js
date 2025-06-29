import * as BABYLON from "babylonjs";
import Papa from "papaparse";
import Color from "colorjs.io";

let csvData;
Papa.parse("data.csv",
    {
        download: true,
        header: true,
        complete: (results) => {
            console.log("Parsing complete");
            // console.log(results.data.length);
            csvData = results.data
            // window.csvData = results.data.slice(0,403);
            // console.log(window.csvData.length);
            // console.log(window.csvData[0]);
            // console.log(csvData[1]);
            console.log(`row size: ${csvData.length}, column size:${Object.keys(csvData[0]).length}`)
            createScene(csvData.slice(0, 50));
        },
        error: (error) => {
            console.error("Error parsing CSV:", error);
        }
    }
)

// const colorComponentRange = [35,65];
const colorComponentRange = [30,90];

const redColor = new Color("hsl", [0, 100, 0], 1);
const yellowColor = new Color("hsl", [60, 100, 0.5], 1);
const greenColor = new Color("hsl", [120, 100, 0.5], 1);
const blueColor = new Color("hsl", [240, 100, 0.5], 1);
const cyanColor = new Color("hsl", [180, 100, 0.5], 1);

let r,g,b;

const colorList = [redColor, yellowColor, greenColor, blueColor, cyanColor];
const colorListLength = colorList.length;

function colorMapping(dataValue,colorIndex) {
    const lightnessValue = colorComponentRange[0] * (1 - dataValue) + colorComponentRange[1] * dataValue;
    colorList[colorIndex].l = lightnessValue;
    return colorList[colorIndex].srgb;
}


async function createScene(csv) {
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new BABYLON.Scene(engine);

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

    const cellHeight = 1;
    const cellWidth = 2;
    let CellXPos = csv.length;
    let CellYPos;
    //let CellYPos = Object.keys(csv[0]).length;

    const basePlane = BABYLON.MeshBuilder.CreatePlane("basePlane", { height: cellHeight, width: cellWidth, sideOrientation: BABYLON.Mesh.DOUBLESIDE });
    basePlane.position = new BABYLON.Vector3(0, 3, 0);
    const planeMaterial = new BABYLON.StandardMaterial("planeMaterial", scene);
    basePlane.material = planeMaterial;
    basePlane.isVisible = true;
    basePlane.registerInstancedBuffer("color", 4);
    basePlane.instancedBuffers.color = new BABYLON.Color4(0, 1, 1, 1);

    let columnsCount;
    

    const axesViewer = new BABYLON.AxesViewer(scene, 10);
    // console.log(`row size: ${csv.length}, column size:${Object.keys(csv[0]).length}`)
    // console.log(`row size: ${rowsCount}, column size:${columnsCount}`)
    console.log(csv[0])
    // const curvatureParameter = 50;
    engine.runRenderLoop(() => {
        scene.render();
    });
    
    for (let row of csv) {
        CellYPos = 0;
        columnsCount = 0;
        for (let column in row) {
            columnsCount++;
            let newInstance = basePlane.createInstance("instance" + row + column);
            newInstance.position.x = CellYPos;
            newInstance.position.y = CellXPos;
            // newInstance.position.z = curvatureParameter*Math.sin(columns/columnsCount*Math.PI);
            // await new Promise(resolve => setTimeout(resolve, 5))
            newInstance.alwaysSelectAsActiveMesh = true;
            [r, g, b] = colorMapping(row[column],columnsCount%colorListLength);
            newInstance.instancedBuffers.color = new BABYLON.Color4(r, g, b, 1);
            CellYPos += cellWidth;
        }
        CellXPos -= cellHeight;

    }


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


    console.log("Red → X-axis \nGreen → Y-axis \nBlue → Z-axis");
    //scene.debugLayer.show();

    window.addEventListener("resize", () => {
        engine.resize();
    });

    return scene;
}
