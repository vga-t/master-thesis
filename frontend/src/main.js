import * as BABYLON from "babylonjs";
import { heatMapConfig, HeatMapVisualization } from "./Visualization/HeatMap.js";
import { twoToneConfig, TwoToneVisualization } from "./Visualization/TwoTone.js";
import { InteractionManager } from "../Interaction/InteractionManager.js";

// import BarsVisualization from "./Visualization/bars.js";


import SceneManager from "./sceneManager.js";
import loadCSV from "./dataLoader.js";
import LCVDSLayout from "./LCVDSLayout.js";


const csvData = await loadCSV("http://localhost:8000/csv");
const sceneManager = new SceneManager("renderCanvas");
const scene = sceneManager.scene;
const layout = new LCVDSLayout(csvData, { arcAngle: 2 * Math.PI / 3, radius: 6, height: 4, groundOffset: 0.5 });
console.log("Column metadata:", layout.columnMetadata); // new: inspect inferred types
const heatMap = new HeatMapVisualization(layout, { heatMapConfig }, scene);
const twoTone = new TwoToneVisualization(layout, { twoToneConfig }, scene);
const xrHelper = await sceneManager.setupXR().catch("Cannot set XR up");
// const bars = new BarsVisualization(layout, scene);
// bars.render(6);
heatMap.render(6);
heatMap.basePlane.isVisible = false;
let currentVis = twoTone;
currentVis.render(6);
const interaction = new InteractionManager(layout, { heatMap, twoTone }, xrHelper);


document.addEventListener("keypress", event => {
    switch (event.key) {
        case "2":
            if (currentVis != heatMap) {
                currentVis.basePlane.isVisible = false;
                currentVis = heatMap;
                currentVis.basePlane.isVisible = true;
            }
            break;
        case "1":
            if (currentVis != twoTone) {
                currentVis.basePlane.isVisible = false;
                currentVis = twoTone;
                currentVis.basePlane.isVisible = true;
            };
            break;
        default:
            alert("Press 1 or 2 to switch visualization!");
            break;

    }
})

// scene.debugLayer.show();


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



