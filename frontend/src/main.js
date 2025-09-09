import * as BABYLON from "babylonjs";
import { heatMapConfig, HeatMapVisualization } from "./Visualization/HeatMap.js";
import { twoToneConfig, TwoToneVisualization } from "./Visualization/TwoTone.js";
import { barsConfig, BarsVisualization } from "./Visualization/bars.js";


import SceneManager from "./sceneManager.js";
import loadCSV from "./dataLoader.js";
import LCVDSLayout from "./LCVDSLayout.js";


const csvData = await loadCSV("http://localhost:8000/csv");
const sceneManager = new SceneManager("renderCanvas");
const scene = sceneManager.scene;
const layout = new LCVDSLayout(csvData, { arcAngle: 2 * Math.PI / 3, radius: 3.2, height: 1.5, groundOffset: 0.5 });
console.log("Column metadata:", layout.columnMetadata); // new: inspect inferred types
const heatMap = new HeatMapVisualization(layout, { heatMapConfig }, scene);
const twoTone = new TwoToneVisualization(layout, { twoToneConfig }, scene);
twoTone.render();




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



