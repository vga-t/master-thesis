import * as BABYLON from "babylonjs";

const BACKEND_URL = "http://localhost:8000";
const SURFACE_OFFSET = 0.02;
const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;

export default class EmbeddedVisualization {
    constructor(scene) {
        this.scene = scene;
        this._material = new BABYLON.StandardMaterial("embeddedVizMaterial", scene);
        this._material.backFaceCulling = false;
        this._material.alpha = 0.98;
        this._material.disableDepthWrite = true;
        this._material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this._material.useAlphaFromDiffuseTexture = true;

        // Create placeholder texture
        this._texture = new BABYLON.DynamicTexture("embeddedVizTexture", {
            width: TEXTURE_WIDTH,
            height: TEXTURE_HEIGHT
        }, scene, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
        this._texture.hasAlpha = true;
        this._texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this._texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this._material.diffuseTexture = this._texture;

        this._planeMesh = null;
        this._ribbonMesh = null;
        this._lastRibbonPointCount = 0;
        this._ctx = this._texture.getContext();
        this._clearTexture();

        // Caching for performance
        this._lastRequestKey = null;
        this._pendingRequest = null;
        this._imageTexture = null;

        // Menu elements
        this._menuMesh = null;
        this._menuVisible = false;
        this._currentMode = "parallel"; // parallel | line
        this._currentGeometry = null;
        this._currentRowIndices = null;
        this._currentColIndices = null;

        // Callback when mode is selected
        this.onModeSelected = null;
    }

    /**
     * Show the visualization for the selected subtable
     * @param {Object} options - Configuration options
     * @param {Object} options.layout - The layout object
     * @param {number[]} options.rowIndices - Global row indices
     * @param {number[]} options.colIndices - Global column indices  
     * @param {Object} options.geometry - The geometry for positioning
     * @param {string} options.mode - "parallel" | "line" | "auto"
     * @param {boolean} options.showMenu - Whether to show the selection menu
     */
    show({ layout, rowIndices, colIndices, geometry, mode = "parallel", showMenu = true }) {
        if (!layout || !Array.isArray(rowIndices) || !rowIndices.length || !Array.isArray(colIndices) || !colIndices.length) {
            this.hide();
            return;
        }

        this._currentGeometry = geometry;
        this._currentRowIndices = rowIndices;
        this._currentColIndices = colIndices;

        // Determine chart type
        let chartType = mode;
        if (mode === "auto") {
            chartType = colIndices.length > 4 ? "parallel" : "line";
        }
        this._currentMode = chartType;

        // Show menu if requested
        if (showMenu) {
            this._showMenu(geometry);
        }

        // Fetch visualization from backend
        this._fetchVisualization(rowIndices, colIndices, chartType, geometry);
    }

    /**
     * Update visualization with a new mode without changing selection
     */
    setMode(mode) {
        if (!this._currentRowIndices || !this._currentColIndices || !this._currentGeometry) {
            return;
        }

        const chartType = mode === "auto"
            ? (this._currentColIndices.length > 4 ? "parallel" : "line")
            : mode;

        if (chartType === this._currentMode) {
            return; // No change needed
        }

        this._currentMode = chartType;
        this._fetchVisualization(
            this._currentRowIndices,
            this._currentColIndices,
            chartType,
            this._currentGeometry
        );
    }

    /**
     * Fetch visualization image from backend
     */
    async _fetchVisualization(rowIndices, colIndices, chartType, geometry) {
        // Create request key for caching
        const requestKey = `${chartType}:${rowIndices.join(',')}:${colIndices.join(',')}`;

        // Skip if same request is pending or completed
        if (this._lastRequestKey === requestKey && !this._pendingRequest) {
            return;
        }

        // Cancel any pending request
        if (this._pendingRequest) {
            this._pendingRequest.cancelled = true;
        }

        // Show loading state
        this._showLoading();
        this._applyGeometry(geometry);

        const request = { cancelled: false };
        this._pendingRequest = request;

        try {
            const response = await fetch(`${BACKEND_URL}/visualization`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    row_indices: rowIndices,
                    column_indices: colIndices,
                    chart_type: chartType
                })
            });

            if (request.cancelled) return;

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const blob = await response.blob();
            if (request.cancelled) return;

            // Create image URL and load texture
            const imageUrl = URL.createObjectURL(blob);

            // Dispose old image texture if exists
            if (this._imageTexture) {
                this._imageTexture.dispose();
                this._imageTexture = null;
            }

            // Create new texture from image
            this._imageTexture = new BABYLON.Texture(
                imageUrl,
                this.scene,
                false, // noMipmap
                true,  // invertY - flip vertically to correct orientation
                BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                () => {
                    // On load callback
                    URL.revokeObjectURL(imageUrl);
                    if (!request.cancelled) {
                        this._material.diffuseTexture = this._imageTexture;
                        this._imageTexture.hasAlpha = true;
                        this._imageTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
                        this._imageTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
                        this._applyGeometry(geometry);
                        this._lastRequestKey = requestKey;
                    }
                },
                () => {
                    // On error callback
                    URL.revokeObjectURL(imageUrl);
                    console.error("Failed to load visualization texture");
                    this._showError("Failed to load visualization");
                }
            );

            this._pendingRequest = null;

        } catch (error) {
            console.error("Error fetching visualization:", error);
            if (!request.cancelled) {
                this._showError("Error loading visualization");
            }
            this._pendingRequest = null;
        }
    }

    /**
     * Show loading indicator on texture
     */
    _showLoading() {
        this._material.diffuseTexture = this._texture;
        const ctx = this._ctx;
        if (!ctx) return;
        this._clearTexture();
        ctx.fillStyle = "#E5E7EB";
        ctx.font = "34px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText("Loading visualization...", TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
        this._texture.update(false);
    }

    /**
     * Show error message on texture
     */
    _showError(message) {
        this._material.diffuseTexture = this._texture;
        const ctx = this._ctx;
        if (!ctx) return;
        this._clearTexture();
        ctx.fillStyle = "#F87171";
        ctx.font = "34px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText(message, TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
        this._texture.update(false);
    }

    /**
     * Show the visualization type selection menu
     */
    _showMenu(geometry) {
        if (!geometry) return;

        // Create menu if not exists
        if (!this._menuMesh) {
            this._createMenu();
        }

        // Position menu above the visualization
        const center = geometry.center;
        const normal = geometry.normal;
        if (center && normal) {
            const menuOffset = normal.scale(SURFACE_OFFSET * 2);
            const heightOffset = geometry.heightVec
                ? geometry.heightVec.clone().normalize().scale(-0.15)
                : new BABYLON.Vector3(0, 0.15, 0);

            this._menuMesh.position = center.add(menuOffset).add(heightOffset);

            // Orient menu to face same direction as visualization
            const basisY = geometry.heightVec.clone().normalize();
            const basisZ = normal.clone().normalize();
            const rotation = BABYLON.Quaternion.FromLookDirectionLH(basisZ, basisY);
            this._menuMesh.rotationQuaternion = rotation;
        }

        this._updateMenuHighlight(this._currentMode);
        this._menuMesh.setEnabled(true);
        this._menuVisible = true;
    }

    /**
     * Create the menu GUI
     */
    _createMenu() {
        // Create a small plane for the menu
        this._menuMesh = BABYLON.MeshBuilder.CreatePlane("vizMenu", {
            width: 0.4,
            height: 0.12,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, this.scene);

        // Create menu texture
        this._menuTexture = new BABYLON.DynamicTexture("vizMenuTexture", {
            width: 512,
            height: 150
        }, this.scene, false);
        this._menuTexture.hasAlpha = true;
        this._menuCtx = this._menuTexture.getContext();

        const menuMaterial = new BABYLON.StandardMaterial("vizMenuMaterial", this.scene);
        menuMaterial.diffuseTexture = this._menuTexture;
        menuMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
        menuMaterial.backFaceCulling = false;
        menuMaterial.useAlphaFromDiffuseTexture = true;

        this._menuMesh.material = menuMaterial;
        this._menuMesh.renderingGroupId = 2;
        this._menuMesh.isPickable = true;
        this._menuMesh.setEnabled(false);

        // Store button bounds for interaction
        const buttonWidth = 220;
        const gap = 20;
        const startX = (512 - buttonWidth * 2 - gap) / 2;

        this._menuMesh.metadata = {
            isVizMenu: true,
            buttons: [
                { mode: "parallel", x: startX / 512, width: buttonWidth / 512 },
                { mode: "line", x: (startX + buttonWidth + gap) / 512, width: buttonWidth / 512 }
            ]
        };
    }

    /**
     * Handle menu click - call this from interaction manager
     * @param {BABYLON.PickingInfo} pickInfo - The picking info from ray cast
     * @returns {boolean} Whether a menu button was clicked
     */
    handleMenuClick(pickInfo) {
        if (!pickInfo || !pickInfo.hit || pickInfo.pickedMesh !== this._menuMesh) {
            return false;
        }

        const uv = pickInfo.getTextureCoordinates();
        if (!uv) return false;

        const buttons = this._menuMesh.metadata?.buttons;
        if (!buttons) return false;

        for (const btn of buttons) {
            if (uv.x >= btn.x && uv.x <= btn.x + btn.width) {
                this.setMode(btn.mode);
                this._updateMenuHighlight(btn.mode);
                if (this.onModeSelected) {
                    this.onModeSelected(btn.mode);
                }
                return true;
            }
        }

        return false;
    }

    /**
     * Update menu button highlights
     */
    _updateMenuHighlight(selectedMode) {
        if (!this._menuCtx) return;

        const ctx = this._menuCtx;

        // Redraw menu with updated highlights
        ctx.clearRect(0, 0, 512, 150);

        ctx.fillStyle = "rgba(30, 41, 59, 0.95)";
        ctx.beginPath();
        ctx.roundRect(0, 0, 512, 150, 16);
        ctx.fill();

        const buttonWidth = 220;
        const buttonHeight = 100;
        const gap = 20;
        const startX = (512 - buttonWidth * 2 - gap) / 2;
        const startY = (150 - buttonHeight) / 2;

        // Parallel Coordinates button
        ctx.fillStyle = selectedMode === "parallel" ? "#4F46E5" : "#475569";
        ctx.beginPath();
        ctx.roundRect(startX, startY, buttonWidth, buttonHeight, 10);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 24px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText("Parallel", startX + buttonWidth / 2, startY + 45);
        ctx.font = "18px Segoe UI";
        ctx.fillText("Coordinates", startX + buttonWidth / 2, startY + 75);

        // Line Chart button
        ctx.fillStyle = selectedMode === "line" ? "#4F46E5" : "#475569";
        ctx.beginPath();
        ctx.roundRect(startX + buttonWidth + gap, startY, buttonWidth, buttonHeight, 10);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 24px Segoe UI";
        ctx.fillText("Line", startX + buttonWidth + gap + buttonWidth / 2, startY + 45);
        ctx.font = "18px Segoe UI";
        ctx.fillText("Chart", startX + buttonWidth + gap + buttonWidth / 2, startY + 75);

        this._menuTexture.update(false);
    }

    hide() {
        this._planeMesh?.setEnabled(false);
        this._ribbonMesh?.setEnabled(false);
        this._hideMenu();

        // Cancel any pending request
        if (this._pendingRequest) {
            this._pendingRequest.cancelled = true;
            this._pendingRequest = null;
        }

        // Clear cached request
        this._lastRequestKey = null;
        this._currentRowIndices = null;
        this._currentColIndices = null;
        this._currentGeometry = null;
    }

    _hideMenu() {
        if (this._menuMesh) {
            this._menuMesh.setEnabled(false);
        }
        this._menuVisible = false;
    }

    dispose() {
        this.hide();
        this._planeMesh?.dispose();
        this._planeMesh = null;
        this._ribbonMesh?.dispose();
        this._ribbonMesh = null;
        this._texture?.dispose();
        this._texture = null;
        this._imageTexture?.dispose();
        this._imageTexture = null;
        this._menuMesh?.dispose();
        this._menuMesh = null;
        this._menuTexture?.dispose();
        this._menuTexture = null;
        this._ctx = null;
        this._menuCtx = null;
    }

    _clearTexture() {
        const ctx = this._ctx;
        if (!ctx) return;
        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
        ctx.textAlign = "left";
    }

    _applyGeometry(geometry) {
        if (!geometry) {
            this.hide();
            return;
        }

        const canUseRibbon = geometry.topEdge?.length >= 2 && geometry.bottomEdge?.length >= 2;
        if (canUseRibbon) {
            this._applyCurvedGeometry(geometry);
        } else {
            this._applyPlanarGeometry(geometry);
        }
    }

    _applyCurvedGeometry(geometry) {
        const topPath = geometry.topEdge.map(point => point.add(geometry.normal.scale(SURFACE_OFFSET)));
        const bottomPath = geometry.bottomEdge.map(point => point.add(geometry.normal.scale(SURFACE_OFFSET)));
        const pathArray = [bottomPath, topPath];

        if (!this._ribbonMesh || this._lastRibbonPointCount !== topPath.length) {
            this._ribbonMesh?.dispose();
            this._ribbonMesh = BABYLON.MeshBuilder.CreateRibbon("embeddedVizRibbon", {
                pathArray,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                updatable: true
            }, this.scene);
            this._ribbonMesh.isPickable = false;
            this._ribbonMesh.renderingGroupId = 2;
            this._ribbonMesh.material = this._material;
            this._lastRibbonPointCount = topPath.length;
        } else {
            BABYLON.MeshBuilder.CreateRibbon(null, {
                pathArray,
                instance: this._ribbonMesh
            });
        }
        this._ribbonMesh.setEnabled(true);
        this._planeMesh?.setEnabled(false);
    }

    _applyPlanarGeometry(geometry) {
        const widthLen = geometry.widthVec?.length() ?? 0;
        const heightLen = geometry.heightVec?.length() ?? 0;
        if (widthLen <= 0 || heightLen <= 0) {
            this.hide();
            return;
        }

        const plane = this._ensurePlaneMesh();
        const basisY = geometry.heightVec.clone().normalize();
        const basisZ = geometry.normal.clone().normalize();
        const rotation = BABYLON.Quaternion.FromLookDirectionLH(basisZ, basisY);
        plane.rotationQuaternion = rotation;
        plane.scaling.x = widthLen;
        plane.scaling.y = heightLen;
        plane.position = geometry.center.add(basisZ.scale(SURFACE_OFFSET));
        plane.setEnabled(true);
        this._ribbonMesh?.setEnabled(false);
    }

    _ensurePlaneMesh() {
        if (this._planeMesh) return this._planeMesh;
        this._planeMesh = BABYLON.MeshBuilder.CreatePlane("embeddedVizPlane", {
            width: 1,
            height: 1,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, this.scene);
        this._planeMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
        this._planeMesh.isPickable = false;
        this._planeMesh.renderingGroupId = 2;
        this._planeMesh.material = this._material;
        this._planeMesh.setEnabled(false);
        return this._planeMesh;
    }

    /**
     * Get the menu mesh for interaction detection
     */
    getMenuMesh() {
        return this._menuMesh;
    }

    /**
     * Check if menu is visible
     */
    isMenuVisible() {
        return this._menuVisible;
    }

    /**
     * Get current mode
     */
    getCurrentMode() {
        return this._currentMode;
    }
}
