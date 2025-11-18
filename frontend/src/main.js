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

// Initialize Scene
const sceneManager = new SceneManager("renderCanvas", radius);
const scene = sceneManager.scene;
const xrHelper = await sceneManager.setupXR(radius).catch(e => console.warn("Cannot set XR up", e));
sceneManager.setupMultiRayCasting(xrHelper);

// Global variables for visualization components
let layout;
let heatMap;
let twoTone;
let columnHeaders;
let interaction;
let currentVis;

// Audio Manager
const audioManager = new AudioManager();

audioManager.onAudioData = (blob) => {
    console.log("Sending audio to backend...");
    const formData = new FormData();
    formData.append("file", blob, "recording.wav");

    fetch(BACKEND_URL + "/process-audio", {
        method: "POST",
        body: formData,
    })
        .then(response => response.json())
        .then(data => {
            console.log("Response from backend:", data);
            audioManager.generateSpeech(data.message || "Updating visualization");
            reloadVisualization();
        })
        .catch(error => {
            console.error("Error sending audio:", error);
            audioManager.generateSpeech("Error processing audio");
        });
};

async function initVisualization(csvData) {
    // Dispose existing
    if (heatMap) heatMap.dispose();
    if (twoTone) twoTone.dispose();
    if (columnHeaders) columnHeaders.dispose();
    if (interaction) interaction.dispose();

    // Create Layout
    const columnCount = csvData.length ? Object.keys(csvData[0]).length : 0;
    layout = new LCVDSLayout(csvData, {
        arcAngle: arcAngle * Math.PI / 180,
        radius: radius,
        height: 5,
        groundOffset: 0.1,
        viewportRows: Math.min(csvData.length || 1, 150),
        viewportCols: Math.min(columnCount || 1, 30)
    });

    // Create Visualizations
    heatMap = new HeatMapVisualization(layout, { heatMapConfig }, scene);
    twoTone = new TwoToneVisualization(layout, { twoToneConfig }, scene);
    columnHeaders = new ColumnHeaders(layout, scene);

    // Render default
    heatMap.render();
    heatMap.basePlane.isVisible = false;

    currentVis = twoTone;
    currentVis.render(6, 6);
    currentVis.basePlane.isVisible = true;

    // Interaction
    interaction = new InteractionManager(layout, { heatMap, twoTone }, xrHelper, scene);
}

async function reloadVisualization() {
    try {
        const csvData = await loadCSV(BACKEND_URL + "/csv");
        await initVisualization(csvData);
    } catch (e) {
        console.error("Failed to reload visualization", e);
    }
}

// Initial Load
const initialData = await loadCSV(BACKEND_URL + "/csv");
await initVisualization(initialData);

// Event Listeners
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
        case "u":
        case "U":
            fetch(BACKEND_URL + "/undo", { method: "POST" })
                .then(res => res.json())
                .then(data => {
                    console.log(data.message);
                    audioManager.generateSpeech("Undoing last action");
                    reloadVisualization();
                });
            break;
        default:
            // alert("Press 1 (TwoTone) or 2 (HeatMap) to switch visualization!");
            break;
    }
});

scene.debugLayer.show();


