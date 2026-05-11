# Master Thesis - VR Data Visualization Framework

This project is a prototype for the Master's thesis: **AI-assisted Interactive Visualization on Large Curved Virtual Display Surfaces**. 

Built with Babylon.js and WebXR, this interactive data-visualization framework explores solutions to challenges when analyzing massive tabular datasets (CSV). While it supports desktop viewing, a Head-Mounted Display (HMD) is required to experience the full embodied interaction model. The prototype has been tested with Meta headsets Compatability with other headsets is not guaranteed.

## 1. Implemented Thesis Concepts

This prototype implements several core concepts from the thesis:
* **Egocentric Cylindrical Layout (LCVDS):** Renders datasets on a cylindrical curved surface to eliminate region bias and maintain equidistant viewing angles.
* **Distance-Adaptive Encodings:** Features Two-Tone Pseudo-Coloring (TTPC) for near-field precision and a HeatMap mode for far-field visual aggregation.
* **Focus+Context (1D Distortion):** Allows users to dynamically stretch specific rows or columns, making dense cells legible and acting as target enlargement to prevent VR selection errors.
* **Overview-Driven Multi-Scale Navigation (World in Miniature):** Implements a wrist-mounted minimap (Overview). It features a synchronized viewfinder that users can drag to navigate the dataset or resize to trigger geometric zooming on the main wall. The panel is fully adjustable, resizable, and can be detached from the wrist and placed anywhere in the 3D environment.


## 2. Quick Start (Install and Run)

### Prerequisites

* Node.js 
* npm (comes with Node.js; handles downloading Vite and all dependencies automatically)
* A modern WebXR-compatible browser (tested on Chrome and Edge)

### Installation

1. Open a terminal in the project root.
2. Go to the frontend folder:

    ```bash
    cd frontend
    ```

3. Install all dependencies (this automatically installs Vite and Babylon.js):

    ```bash
    npm install
    ```

### Run the app (Local Development)

From the `frontend` directory:

    npm run dev

Vite will print a local URL in the terminal, typically:
* http://localhost:5173/

Open that URL in your browser. Click on the enter VR mode at the bottom end.


## 3. Project Structure (Relevant Parts)

* `frontend/public/csv/`: Local datasets used by the application.
* `frontend/src/main.js`: Application entry point, visualization lifecycle, and keyboard event listeners.
* `frontend/src/LCVDSLayout.js`: Core mathematical layout engine for the cylindrical surface and Focus+Context algorithms.
* `frontend/src/Interaction/`: Interaction logic (selection, focus+context, controller mapping).
* `frontend/src/Visualization/`: Rendering modules for TwoTone, HeatMap, and the Overview minimap.
* `frontend/src/sceneManager.js`: Babylon.js scene configuration and WebXR initialization.
* `frontend/src/dataLoader.js`: PapaParse integration for large CSV files.

## 4. Data Source

By default, the app loads a heterogeneous tabular dataset:
* `frontend/public/csv/Leukemia.csv`

If you want to load a different dataset, change the `CSV_FILE_PATH` variable in `frontend/src/main.js`.

## 5. Visualization Modes

The framework includes two main visual representations tailored for distance-adaptive readability:

1. **TwoTone (Two-Tone Pseudo-Coloring)** - Default on startup.
2. **HeatMap** 

You can switch between them while running.

## 6. Desktop Controls (Keyboard)

When the app is open in the browser, the following debug controls are active:

* `1`: Switch to TwoTone view.
* `2`: Switch to HeatMap view.
* `9`: Decrease TwoTone interval count (simulates distance-adaptive rendering).
* `0`: Increase TwoTone interval count.
* `R`: Toggle microphone recording for SRQ voice commands.
* `U`: Reload local CSV data and reinitialize the visualization.

## 7. VR Interaction Tutorial


### 7.1 Right Controller (Exploration & Selection)
* **Trigger (hold + drag):** Perform a spatial rubber-band selection to define a Region of Interest (ROI) on the LCVDS.
* **Trigger (double-click release):** Reset interaction state (clears selection overlays/focus state).
* **Squeeze:**
    * *If pointing at Overview/sliders:* Grabs/interacts with the wrist-mounted Overview or layout sliders.
    * *Otherwise:* Starts focus stroke gesture (Focus+Context).
* **A button:** Pan/reposition the active focus region across the dataset.
* **B button:** Show/hide the wrist-mounted Overview (World in Miniature) and attached layout sliders.

### 7.2 Left Controller (Navigation)

* **Thumbstick:**
    * *Normal mode:* Scroll rows/columns globally in the dataset viewport.
    * *Focus mode active:* Adjust focus distortion magnitude.
        * Y axis changes row focus share.
        * X axis changes column focus share.
* **X button:** Clear all embedded parallel-coordinate plots (PCPs) and restore hidden cells to the LCVDS.

### 7.3 Focus+Context Gestures

Using the right-controller squeeze on the data plane:

* **Horizontal stroke** (touching multiple columns): Create/update a column focus region.
* **Vertical stroke** (row swipe): Create a row focus region.
* **Row swipe behavior:**
    * *First swipe:* Defines the first row-focused region.
    * *Second swipe:* Defines a second row-focused region for comparison.
    * *Third swipe:* Clears row focus regions.
* Use the **A button** (right controller) to pan the focus block after creating it.

### 7.4 in-situ Visualizaiton

* Drag a rectangular rubber-band selection with the right trigger to isolate a specific data subset.
* On release, an embedded parallel-coordinates plot (PCP) is generated from the selected region and placed in your personal zone (Staging Shelf).
* Multiple PCPs can coexist for proximal comparison.
* Use the **Left X button** to clear all PCPs quickly.

### 7.5 Wrist-Mounted Overview (World in Miniature)

Toggle the Overview with the **Right B button**. It provides global spatial awareness ("Desert Fog" prevention) and supports:

* Moving the panel within your personal space.
* Resizing via corner handles.
* Viewport drag to navigate through dataset extents quickly without scrolling.
* Viewport resize handles to change visible rows/columns on the main wall (Geometric Zooming).
* Detach handle for floating placement (can be docked back to the wrist).

## 8. LCVDS Layout Sliders

When the Overview is visible, 3 sliders are available to adjust the geometry of the Large Curved Virtual Display Surface:

1. **Arc Angle** (10-360 degrees)
2. **Radius** (2-100 m)
3. **Height** (1-50 m)

You can drag the slider handles or click the tracks to jump values. These update layout geometry in real time with throttled performance updates.

## 9. Typical User Workflow

1. Start the app with `npm run dev` and open the localhost URL.
2. Enter the VR session from the browser (if headset/runtime is connected).
3. Toggle the Overview (Right B) and tune the LCVDS layout sliders for comfort.
4. Scroll through rows/columns using the left thumbstick or Overview viewfinder.
5. Switch visualization modes (keyboard 1/2) depending on viewing distance.
6. Use rubber-band selection to extract subsets and create embedded PCP(s) in your personal zone.
7. Apply Focus+Context gestures for detailed in-situ inspection.

## 10. Build for Production

When you are ready to deploy the framework to a static web host (like GitHub Pages or Netlify), run the build command from the `frontend` directory:

    npm run build
After the build completes, a new directory named dist/ will be created in the project root. This folder contains the minified, production-ready assets (HTML, JS, CSS, and your CSV data). You only need to upload the contents of the dist/ folder to your web host.

To preview the production build locally before uploading:

    npm run preview