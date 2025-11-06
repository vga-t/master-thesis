import { heatMapConfig, HeatMapVisualization } from "./Visualization/HeatMap.js";
import { twoToneConfig, TwoToneVisualization } from "./Visualization/TwoTone.js";
import { InteractionManager } from "./Interaction/InteractionManager.js";
import AudioManager from "./audioManager.js";
import ColumnHeaders from "./Visualization/ColumnHeader.js";


import SceneManager from "./sceneManager.js";
import loadCSV from "./dataLoader.js";
import LCVDSLayout from "./LCVDSLayout.js";

const radius = 6;
const arcAngle = 180;
const BACKEND_URL = "http://localhost:8000";
const csvData = await loadCSV(BACKEND_URL + "/csv");
// const canvas = document.getElementById("renderCanvas");
const sceneManager = new SceneManager("renderCanvas", radius);
const scene = sceneManager.scene;
const columnCount = csvData.length ? Object.keys(csvData[0]).length : 0;
const layout = new LCVDSLayout(csvData, {
    arcAngle: arcAngle * Math.PI / 180,
    radius: radius,
    height: 5,
    groundOffset: 0.1,
    viewportRows: Math.min(csvData.length || 1, 300),
    viewportCols: Math.min(columnCount || 1, 20)
});
console.log("Column metadata:", layout.columnMetadata);
const heatMap = new HeatMapVisualization(layout, { heatMapConfig }, scene);
const twoTone = new TwoToneVisualization(layout, { twoToneConfig }, scene);
const columnHeaders = new ColumnHeaders(layout, scene);
const xrHelper = await sceneManager.setupXR(radius).catch("Cannot set XR up");
sceneManager.setupMultiRayCasting(xrHelper);

heatMap.render();
heatMap.basePlane.isVisible = false;
let currentVis = twoTone;
currentVis.render(6, 6);
const interaction = new InteractionManager(layout, { heatMap, twoTone }, xrHelper, scene);
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
        case "R":
        case "r":
            audioManager.toggleRecording();
            break;
        default:
            alert("Press 1 (TwoTone) or 2 (HeatMap) to switch visualization!");
            break;

    }
})

scene.debugLayer.show();


