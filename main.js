import * as BABYLON from "babylonjs";
import Papa from "papaparse";


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
                        createScene(csvData.slice(0,50));
                    },
                    error: (error) => {
                        console.error("Error parsing CSV:", error);
                    }
                }
            )



async function createScene(csv) { 
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new BABYLON.Scene(engine);

    // Access the WebGL context from Babylon's engine
    const gl = engine._gl; // Undocumented, but works across versions
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        console.log("GPU Vendor:", vendor);
        console.log("GPU Renderer:", renderer);
    } else {
        console.log("WEBGL_debug_renderer_info not supported");
    }

    console.log(`row size: ${csv.length}, column size:${Object.keys(csv[0]).length}`)
    var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -10), scene);
    camera.attachControl(canvas, true);
    camera.position.z = 100;
    camera.setTarget(BABYLON.Vector3.Zero());
    var light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), scene);
    light.intensity = 0.7;

    const basePlane = BABYLON.MeshBuilder.CreatePlane("basePlane", {height:1, width:2, sideOrientation:BABYLON.Mesh.DOUBLESIDE});
    basePlane.position = new BABYLON.Vector3(0,3,0);
    const planeMaterial = new BABYLON.StandardMaterial("planeMaterial",scene);
    planeMaterial.diffuseColor = new BABYLON.Color3(0,1,0);
    // planeMaterial.wireframe = true;
    basePlane.material = planeMaterial;
    basePlane.isVisible = true;
    basePlane.registerInstancedBuffer("color", 4);
    basePlane.instancedBuffers.color = new BABYLON.Color4(1,.5,1,1);

    let rowsCount = csv.length;
    let columnsCount = Object.keys(csv[0]).length;
    console.log(`row size: ${csv.length}, column size:${Object.keys(csv[0]).length}`)
    console.log(`row size: ${rowsCount}, column size:${columnsCount}`)
    for (let row of csv) {
        columnsCount = 0;
        for (let column in row){
            
            let newInstance = basePlane.createInstance("instance"+row+column);
            newInstance.position.x = columnsCount;
            newInstance.position.y = rowsCount;
            newInstance.position.z = 0;
            
            newInstance.alwaysSelectAsActiveMesh = true;
            newInstance.instancedBuffers.color = new BABYLON.Color4(1,Math.random(),Math.random(),1);
            columnsCount+=2;
        }
        rowsCount-=1;

    }

   
    // const ground = BABYLON.CreateGround("ground",{ height:50, width: 50,sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene)
    const ground = BABYLON.MeshBuilder.CreateGround("ground", {
    height: 500,
    width: 500,subdivisions:1
    }, scene);
    ground.position.x =  101.22;
    ground.position.y = -10;
    ground.position.z = -28.75;
    const xr = await scene.createDefaultXRExperienceAsync({
        floorMeshes: [ground]
    });

    scene.debugLayer.show();
    engine.runRenderLoop(() => {
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
    });

    return scene;
}
