import { heatMapConfig, HeatMapVisualization } from "./Visualization/HeatMap.js";
import CurvedHeatMapVisualization from "./Visualization/CurvedHeatMap.js";
import CurvedTwoToneVisualization from "./Visualization/CurvedTwoTone.js";
import CartesianDistortionController from "./Interaction/CartesianDistortion.js";
import { twoToneConfig, TwoToneVisualization } from "./Visualization/TwoTone.js";
import { InteractionManager } from "./Interaction/InteractionManager.js";
import AudioManager from "./audioManager.js";


import SceneManager from "./sceneManager.js";
import loadCSV from "./dataLoader.js";
import LCVDSLayout from "./LCVDSLayout.js";
const radius = 6;
const BACKEND_URL = "http://localhost:8000";
const csvData = await loadCSV(BACKEND_URL + "/csv");
const sceneManager = new SceneManager("renderCanvas");
const scene = sceneManager.scene;
const columnCount = csvData.length ? Object.keys(csvData[0]).length : 0;
const layout = new LCVDSLayout(csvData, {
    arcAngle: 2 * Math.PI / 3,
    radius: radius,
    height: 3,
    groundOffset: 0.1,
    viewportRows: Math.min(csvData.length || 1, 200),
    viewportCols: Math.min(columnCount || 1, 150)
});
console.log("Column metadata:", layout.columnMetadata);
const heatMap = new HeatMapVisualization(layout, { heatMapConfig }, scene);
const curvedHeat = new CurvedHeatMapVisualization(layout, { heatMapConfig }, scene);
const curvedTwoTone = new CurvedTwoToneVisualization(layout, { twoToneConfig }, scene);
const twoTone = new TwoToneVisualization(layout, { twoToneConfig }, scene);
const xrHelper = await sceneManager.setupXR(radius).catch("Cannot set XR up");
sceneManager.setupMultiRayCasting(xrHelper);

heatMap.render();
heatMap.basePlane.isVisible = false;
curvedHeat.mesh.isVisible = false;
curvedTwoTone.mesh.isVisible = false;
let currentVis = twoTone;
const cartesian = new CartesianDistortionController([curvedHeat, curvedTwoTone]);
currentVis.render(6);
const interaction = new InteractionManager(layout, { heatMap, twoTone, curvedHeat, curvedTwoTone, cartesian }, xrHelper, scene);
const audioManager = new AudioManager();

audioManager.onTranscript = (transcript) => {
    console.log(`Sending to backend: "${transcript}"`);

    fetch(BACKEND_URL + "/process", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: transcript }),
    })
        .then(response => response.json())
        .then(data => {
            console.log("Response from backend:", data.message);

            // Use an asynchronous function here for changing the state of the environment before speech is synthesized in the environment.
            audioManager.generateSpeech(data.message);

        })
        .catch(error => {
            console.error("Error sending to backend:", error);
        });
};

document.addEventListener("keypress", event => {
    switch (event.key) {
        case "2":
            if (currentVis != heatMap) {
                if (currentVis.mesh) currentVis.mesh.isVisible = false;
                if (currentVis.basePlane) currentVis.basePlane.isVisible = false;
                currentVis = heatMap;
                currentVis.basePlane.isVisible = true;
                interaction.setVisualizationMode("heatmap");
            }
            break;
        case "1":
            if (currentVis != twoTone) {
                if (currentVis.mesh) currentVis.mesh.isVisible = false;
                if (currentVis.basePlane) currentVis.basePlane.isVisible = false;
                currentVis = twoTone;
                currentVis.basePlane.isVisible = true;
                interaction.setVisualizationMode("twotone");
            };
            break;
        case "w":
        case "W":
            cartesian.nudgeD(0.5);
            console.log("Cartesian D:", cartesian.D);
            break;
        case "q":
        case "Q":
            cartesian.nudgeD(-0.5);
            console.log("Cartesian D:", cartesian.D);
            break;
        case "R":
        case "r":
            audioManager.toggleRecording();
            break;
        default:
            alert("Press 1 (TwoTone), 2 (HeatMap), 3 (Curved HeatMap), or 4 (Curved TwoTone) to switch visualization!");
            break;

    }
})

scene.debugLayer.show();


// const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
// recognition.continuous = true;
// recognition.lang = "en-US";
// recognition.interimResults = false;
// recognition.maxAlternatives = 1;
// let isRecording = false;
// let fullTranscript;

// document.addEventListener("keypress", event => {
//     if (event.key.toLowerCase() == "r") {
//         isRecording = !isRecording;
//         if (isRecording) {
//             recognition.start();
//             console.log("Start recording");
//         }
//         else {
//             recognition.stop();
//             console.log("Stop recording");
//         }
//     }
//     if (event.key.toLowerCase() == "d") {
//         const baseMesh = scene.getMeshByName("basePlane");
//         if (baseMesh) {
//             baseMesh.dispose();
//             console.log("Removing base mesh and all its instances!");
//         }
//         else { console.error("No base mesh found to remove!"); }
//     }

// })

// recognition.addEventListener("result", (event) => {
//     for (let i = event.resultIndex; i < event.results.length; i++) {
//         const transcript = event.results[i][0].transcript;
//         fullTranscript += transcript + " ";
//     }
//     console.log(`Full transcript:${fullTranscript}`);
//     fullTranscript = "";
// })



