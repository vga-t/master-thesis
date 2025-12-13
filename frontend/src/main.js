import { heatMapConfig, HeatMapVisualization } from "./Visualization/HeatMap.js";
import { twoToneConfig, TwoToneVisualization } from "./Visualization/TwoTone.js";
import { InteractionManager } from "./Interaction/InteractionManager.js";
import AudioManager from "./audioManager.js";
import ColumnHeaders from "./Visualization/ColumnHeader.js";
import SceneManager from "./sceneManager.js";
import loadCSV from "./dataLoader.js";
import LCVDSLayout from "./LCVDSLayout.js";

// Initial layout parameters (can be changed via 3D sliders)
let currentLayoutParams = {
    radius: 10,
    arcAngle: 120, // in degrees
    height: 5
};

// const BACKEND_URL = "http://localhost:8000";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";



// Initialize Scene
const sceneManager = new SceneManager("renderCanvas", currentLayoutParams.radius);
const scene = sceneManager.scene;
const xrHelper = await sceneManager.setupXR(currentLayoutParams.radius).catch(e => console.warn("Cannot set XR up", e));
sceneManager.setupMultiRayCasting(xrHelper);

// Global variables for visualization components
let layout;
let heatMap;
let twoTone;
let columnHeaders;
let interaction;
let currentVis;
let twoTonePaletteCount = 6;
let twoToneIntervals = 6;
const MIN_TWOTONE_INTERVALS = 1;
const MAX_TWOTONE_INTERVALS = Math.max(1, (twoToneConfig.colorList?.[0]?.length ?? 2) - 1);


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

    // Create Layout using current parameters
    const columnCount = csvData.length ? Object.keys(csvData[0]).length : 0;
    layout = new LCVDSLayout(csvData, {
        arcAngle: currentLayoutParams.arcAngle * Math.PI / 180,
        radius: currentLayoutParams.radius,
        height: currentLayoutParams.height,
        groundOffset: 0.1,
        viewportRows: Math.min(csvData.length || 1, 250),
        viewportCols: Math.min(columnCount || 1, 45)
    });
    layout.createCollisionSurface(scene);
    console.log("No of rows:", csvData.length);
    console.log("No of columns:", Object.keys(csvData[0]).length);
    console.log("No of cells", csvData.length * Object.keys(csvData[0]).length);

    // Create Visualizations
    heatMap = new HeatMapVisualization(layout, { heatMapConfig }, scene);
    twoTone = new TwoToneVisualization(layout, { twoToneConfig }, scene);
    columnHeaders = new ColumnHeaders(layout, scene);

    // Render default
    heatMap.render();
    heatMap.basePlane.isVisible = false;

    currentVis = twoTone;
    currentVis.render(twoTonePaletteCount, twoToneIntervals);
    currentVis.basePlane.isVisible = true;

    // Interaction with layout change callback
    interaction = new InteractionManager(layout, { heatMap, twoTone }, xrHelper, scene, {
        onLayoutParametersChange: handleLayoutParametersChange
    });
}

/**
 * Handle layout parameter changes from the 3D sliders.
 * Uses optimized layout update instead of full reconstruction.
 * @param {Object} params - { arcAngle (radians), radius, height }
 */
function handleLayoutParametersChange(params) {
    // Update current params (convert arcAngle back to degrees for storage)
    currentLayoutParams = {
        arcAngle: params.arcAngle * 180 / Math.PI,
        radius: params.radius,
        height: params.height
    };

    // Use the optimized layout parameter update
    if (layout) {
        layout.setLayoutParameters({
            arcAngle: params.arcAngle,
            radius: params.radius,
            height: params.height
        });
    }
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
        case "9":
            if (twoToneIntervals > MIN_TWOTONE_INTERVALS) {
                twoToneIntervals -= 1;
                if (twoTone) {
                    twoTone.render(twoTonePaletteCount, twoToneIntervals);
                }
            }
            break;
        case "0":
            if (twoToneIntervals < MAX_TWOTONE_INTERVALS) {
                twoToneIntervals += 1;
                if (twoTone) {
                    twoTone.render(twoTonePaletteCount, twoToneIntervals);
                }
            }
            break;
        case "2":
            if (currentVis != heatMap) {
                if (currentVis.mesh) currentVis.mesh.isVisible = false;
                if (currentVis.basePlane) currentVis.basePlane.isVisible = false;
                currentVis = heatMap;
                currentVis.basePlane.isVisible = true;
                currentVis.catchUp();
                interaction.setVisualizationMode("heatmap");
            }
            break;
        case "1":
            if (currentVis != twoTone) {
                if (currentVis.mesh) currentVis.mesh.isVisible = false;
                if (currentVis.basePlane) currentVis.basePlane.isVisible = false;
                currentVis = twoTone;
                currentVis.basePlane.isVisible = true;
                currentVis.catchUp();
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


