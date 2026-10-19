import * as BABYLON from "babylonjs";


// Slider configuration
const SLIDER_WIDTH = 0.25;
const SLIDER_HEIGHT = 0.015;
const SLIDER_DEPTH = 0.008;
const SLIDER_SPACING = 0.045;
const SLIDER_OFFSET_Y = 0.04; // Distance above minimap

const HANDLE_SIZE = 0.025;
const LABEL_HEIGHT = 0.018;

// Default ranges for each parameter
const SLIDER_CONFIGS = {
    arcAngle: {
        label: "Arc Angle",
        min: 10,
        max: 360,
        default: 180,
        unit: "°",
        color: new BABYLON.Color3(0.2, 0.6, 1.0),     // Blue
        emissive: new BABYLON.Color3(0.1, 0.3, 0.5)
    },
    radius: {
        label: "Radius",
        min: 2,
        max: 100,
        default: 6,
        unit: "m",
        color: new BABYLON.Color3(0.3, 0.9, 0.4),     // Green
        emissive: new BABYLON.Color3(0.15, 0.45, 0.2)
    },
    height: {
        label: "Height",
        min: 1,
        max: 50,
        default: 5,
        unit: "m",
        color: new BABYLON.Color3(1.0, 0.6, 0.2),     // Orange
        emissive: new BABYLON.Color3(0.5, 0.3, 0.1)
    }
};

// Throttle settings for performance
const UPDATE_THROTTLE_MS = 50; // Limit layout updates to 20fps max
const VISUAL_UPDATE_THROTTLE_MS = 16; // Visual updates at 60fps

class LCVDSSliders {
    constructor(minimapRoot, scene, options = {}) {
        this.scene = scene;
        this.minimapRoot = minimapRoot;

        // Callbacks
        this._onLayoutChange = options.onLayoutChange || null;

        // Current values
        this._values = {
            arcAngle: options.initialArcAngle ?? SLIDER_CONFIGS.arcAngle.default,
            radius: options.initialRadius ?? SLIDER_CONFIGS.radius.default,
            height: options.initialHeight ?? SLIDER_CONFIGS.height.default
        };

        // Throttling state
        this._lastLayoutUpdate = 0;
        this._pendingUpdate = null;
        this._lastVisualUpdate = 0;

        // Interaction state
        this._activeSlider = null;
        this._dragStartValue = 0;
        this._dragStartLocalX = 0;

        // Create root node anchored to minimap
        this.root = new BABYLON.TransformNode("lcvdsSlidersRoot", scene);
        this.root.parent = minimapRoot;
        this.root.position = new BABYLON.Vector3(0, 0, 0);

        // Container for all sliders
        this.sliderContainer = new BABYLON.TransformNode("sliderContainer", scene);
        this.sliderContainer.parent = this.root;

        // Store slider meshes
        this.sliders = {};

        // Create sliders
        this._createSliders();

        // Observable for external updates
        this._observers = new Set();
    }

    _createSliders() {
        const sliderKeys = ["arcAngle", "radius", "height"];

        sliderKeys.forEach((key, index) => {
            const config = SLIDER_CONFIGS[key];
            const yOffset = SLIDER_OFFSET_Y + (sliderKeys.length - 1 - index) * SLIDER_SPACING;

            const slider = this._createSingleSlider(key, config, yOffset);
            this.sliders[key] = slider;

            // Apply initial handle/fill/value text once the slider is registered.
            this._updateSliderVisual(key);
        });
    }

    _createSingleSlider(key, config, yOffset) {
        const sliderGroup = new BABYLON.TransformNode(`slider_${key}`, this.scene);
        sliderGroup.parent = this.sliderContainer;
        sliderGroup.position.y = yOffset;
        sliderGroup.position.z = -0.02; // In front of minimap (towards the user)

        // Create track (background bar)
        const track = BABYLON.MeshBuilder.CreateBox(`sliderTrack_${key}`, {
            width: SLIDER_WIDTH,
            height: SLIDER_HEIGHT,
            depth: SLIDER_DEPTH
        }, this.scene);
        track.parent = sliderGroup;
        track.isPickable = true;
        track.metadata = { lcvdsSlider: true, kind: "track", sliderKey: key };

        const trackMat = new BABYLON.StandardMaterial(`sliderTrackMat_${key}`, this.scene);
        trackMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        trackMat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        trackMat.specularColor = BABYLON.Color3.Black();
        trackMat.disableLighting = true;
        track.material = trackMat;

        // Create filled portion (shows current value)
        const fill = BABYLON.MeshBuilder.CreateBox(`sliderFill_${key}`, {
            width: SLIDER_WIDTH,
            height: SLIDER_HEIGHT * 0.8,
            depth: SLIDER_DEPTH * 0.5
        }, this.scene);
        fill.parent = sliderGroup;
        fill.position.z = -(SLIDER_DEPTH * 0.3); // In front of track (towards user)
        fill.isPickable = false;

        const fillMat = new BABYLON.StandardMaterial(`sliderFillMat_${key}`, this.scene);
        fillMat.diffuseColor = config.color.clone();
        fillMat.emissiveColor = config.emissive.clone();
        fillMat.specularColor = BABYLON.Color3.Black();
        fillMat.disableLighting = true;
        fill.material = fillMat;

        // Create handle (draggable sphere)
        const handle = BABYLON.MeshBuilder.CreateSphere(`sliderHandle_${key}`, {
            diameter: HANDLE_SIZE,
            segments: 12
        }, this.scene);
        handle.parent = sliderGroup;
        handle.position.z = -(SLIDER_DEPTH + 0.008); // In front of track (towards user)
        handle.isPickable = true;
        handle.metadata = { lcvdsSlider: true, kind: "handle", sliderKey: key };

        const handleMat = new BABYLON.StandardMaterial(`sliderHandleMat_${key}`, this.scene);
        handleMat.diffuseColor = config.color.clone().scale(1.2);
        handleMat.emissiveColor = config.emissive.clone().scale(1.5);
        handleMat.specularColor = BABYLON.Color3.Black();
        handleMat.disableLighting = true;
        handle.material = handleMat;

        // Create label text using plane with dynamic texture for better VR readability
        const labelPlane = this._createLabelPlane(key, config.label, sliderGroup);

        // Create value display
        const valuePlane = this._createValuePlane(key, sliderGroup);

        return {
            group: sliderGroup,
            track,
            fill,
            handle,
            labelPlane,
            valuePlane,
            config
        };
    }

    _createLabelPlane(key, labelText, parent) {
        const planeWidth = 0.08;
        const planeHeight = LABEL_HEIGHT;

        const labelPlane = BABYLON.MeshBuilder.CreatePlane(`sliderLabel_${key}`, {
            width: planeWidth,
            height: planeHeight,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, this.scene);
        labelPlane.parent = parent;
        labelPlane.position.x = -SLIDER_WIDTH / 2 - planeWidth / 2 - 0.01;
        labelPlane.position.z = -0.005; // In front of slider (towards user)
        labelPlane.isPickable = false;

        // Create dynamic texture for label
        const resolution = 256;
        const texture = new BABYLON.DynamicTexture(`sliderLabelTexture_${key}`, {
            width: resolution,
            height: Math.round(resolution * (planeHeight / planeWidth))
        }, this.scene, true);
        texture.hasAlpha = true;

        const ctx = texture.getContext();
        ctx.clearRect(0, 0, texture.getSize().width, texture.getSize().height);
        ctx.fillStyle = "white";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, texture.getSize().width - 10, texture.getSize().height / 2);
        texture.update();

        const labelMat = new BABYLON.StandardMaterial(`sliderLabelMat_${key}`, this.scene);
        labelMat.diffuseTexture = texture;
        labelMat.emissiveTexture = texture;
        labelMat.useAlphaFromDiffuseTexture = true;
        labelMat.disableLighting = true;
        labelMat.backFaceCulling = false;
        labelPlane.material = labelMat;

        return labelPlane;
    }

    _createValuePlane(key, parent) {
        const planeWidth = 0.055;
        const planeHeight = LABEL_HEIGHT;

        const valuePlane = BABYLON.MeshBuilder.CreatePlane(`sliderValue_${key}`, {
            width: planeWidth,
            height: planeHeight,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, this.scene);
        valuePlane.parent = parent;
        valuePlane.position.x = SLIDER_WIDTH / 2 + planeWidth / 2 + 0.01;
        valuePlane.position.z = -0.005; // In front of slider (towards user)
        valuePlane.isPickable = false;

        // Create dynamic texture for value display
        const resolution = 192;
        const texture = new BABYLON.DynamicTexture(`sliderValueTexture_${key}`, {
            width: resolution,
            height: Math.round(resolution * (planeHeight / planeWidth))
        }, this.scene, true);
        texture.hasAlpha = true;

        const valueMat = new BABYLON.StandardMaterial(`sliderValueMat_${key}`, this.scene);
        valueMat.diffuseTexture = texture;
        valueMat.emissiveTexture = texture;
        valueMat.useAlphaFromDiffuseTexture = true;
        valueMat.disableLighting = true;
        valueMat.backFaceCulling = false;
        valuePlane.material = valueMat;

        // Store texture reference for updates
        valuePlane.metadata = { valueTexture: texture };

        return valuePlane;
    }

    _updateValueDisplay(key) {
        const slider = this.sliders[key];
        if (!slider?.valuePlane?.metadata?.valueTexture) return;

        const texture = slider.valuePlane.metadata.valueTexture;
        const config = slider.config;
        const value = this._values[key];

        // Format value based on type
        let displayValue;
        if (key === "arcAngle") {
            displayValue = `${Math.round(value)}${config.unit}`;
        } else {
            displayValue = `${value.toFixed(1)}${config.unit}`;
        }

        if (slider._lastDisplayValue === displayValue) {
            return;
        }
        slider._lastDisplayValue = displayValue;

        ctx.clearRect(0, 0, texture.getSize().width, texture.getSize().height);
        ctx.fillStyle = "white";
        ctx.font = "bold 44px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(displayValue, 8, texture.getSize().height / 2);
        texture.update();
    }

    _updateSliderVisual(key) {
        const slider = this.sliders[key];
        if (!slider) return;

        const config = slider.config;
        const value = this._values[key];
        const normalized = (value - config.min) / (config.max - config.min);
        const clampedNorm = Math.max(0, Math.min(1, normalized));

        // Update handle position (min on left, max on right)
        const handleX = (clampedNorm - 0.5) * SLIDER_WIDTH;
        slider.handle.position.x = handleX;

        // Update fill bar (scale and position from left edge)
        const fillWidth = clampedNorm * SLIDER_WIDTH;
        slider.fill.scaling.x = Math.max(0.001, clampedNorm); // Avoid 0 scale
        slider.fill.position.x = -SLIDER_WIDTH / 2 + fillWidth / 2;

        // Update value display
        this._updateValueDisplay(key);
    }

    // Update position relative to minimap dimensions
    updatePosition(minimapWidth, minimapHeight) {
        if (!this.sliderContainer) return;

        // Position sliders above the minimap, centered horizontally
        this.sliderContainer.position.y = minimapHeight / 2 + SLIDER_OFFSET_Y;
        this.sliderContainer.position.x = 0;
    }

    // Get current values
    getValues() {
        return { ...this._values };
    }

    // Set values programmatically
    setValues(values) {
        let changed = false;

        for (const key of ["arcAngle", "radius", "height"]) {
            if (values[key] !== undefined) {
                const config = SLIDER_CONFIGS[key];
                const clamped = Math.max(config.min, Math.min(config.max, values[key]));
                if (clamped !== this._values[key]) {
                    this._values[key] = clamped;
                    this._updateSliderVisual(key);
                    changed = true;
                }
            }
        }

        if (changed) {
            this._notifyLayoutChange();
        }
    }

    // Start drag interaction
    startDrag(sliderKey, controller) {
        if (!this.sliders[sliderKey]) return false;

        this._activeSlider = sliderKey;
        this._dragStartValue = this._values[sliderKey];

        // Get initial controller position in slider local space
        const localPos = this._getLocalPosition(controller);
        this._dragStartLocalX = localPos?.x ?? 0;

        // Visual feedback - highlight handle
        this._setHandleHighlight(sliderKey, true);

        return true;
    }

    // Update drag - called during squeeze/grab
    updateDrag(controller) {
        if (!this._activeSlider) return;

        const now = performance.now();

        // Throttle visual updates
        if (now - this._lastVisualUpdate < VISUAL_UPDATE_THROTTLE_MS) return;
        this._lastVisualUpdate = now;

        const localPos = this._getLocalPosition(controller);
        if (!localPos) return;

        const deltaX = localPos.x - this._dragStartLocalX;
        const config = SLIDER_CONFIGS[this._activeSlider];

        // Convert deltaX to value change
        const valueRange = config.max - config.min;
        const deltaValue = (deltaX / SLIDER_WIDTH) * valueRange;

        let newValue = this._dragStartValue + deltaValue;
        newValue = Math.max(config.min, Math.min(config.max, newValue));

        // Update value
        this._values[this._activeSlider] = newValue;
        this._updateSliderVisual(this._activeSlider);

        // Throttle layout updates
        if (now - this._lastLayoutUpdate >= UPDATE_THROTTLE_MS) {
            this._notifyLayoutChange();
            this._lastLayoutUpdate = now;
        } else {
            // Schedule pending update
            if (this._pendingUpdate) clearTimeout(this._pendingUpdate);
            this._pendingUpdate = setTimeout(() => {
                this._notifyLayoutChange();
                this._lastLayoutUpdate = performance.now();
                this._pendingUpdate = null;
            }, UPDATE_THROTTLE_MS);
        }
    }

    // End drag interaction
    endDrag() {
        if (!this._activeSlider) return;

        // Remove highlight
        this._setHandleHighlight(this._activeSlider, false);

        // Ensure final update is sent
        if (this._pendingUpdate) {
            clearTimeout(this._pendingUpdate);
            this._pendingUpdate = null;
        }
        this._notifyLayoutChange();

        this._activeSlider = null;
        this._dragStartValue = 0;
        this._dragStartLocalX = 0;
    }

    // Click on track to set value directly
    handleTrackClick(sliderKey, hitPoint) {
        if (!this.sliders[sliderKey]) return;

        const localPos = this._worldToLocal(hitPoint);
        if (!localPos) return;

        const config = SLIDER_CONFIGS[sliderKey];
        const sliderGroup = this.sliders[sliderKey].group;

        // Calculate relative X within slider
        const localSliderX = localPos.x - sliderGroup.position.x;
        const normalized = 0.5 + (localSliderX / SLIDER_WIDTH);
        const clamped = Math.max(0, Math.min(1, normalized));

        const newValue = config.min + clamped * (config.max - config.min);
        this._values[sliderKey] = newValue;
        this._updateSliderVisual(sliderKey);
        this._notifyLayoutChange();
    }

    _getLocalPosition(controller) {
        if (!controller?.pointer?.getAbsolutePosition) return null;
        const worldPos = controller.pointer.getAbsolutePosition();
        return this._worldToLocal(worldPos);
    }

    _worldToLocal(worldPoint) {
        if (!worldPoint || !this.sliderContainer) return null;
        if (!this._scratchInvMatrix) {
            this._scratchInvMatrix = new BABYLON.Matrix();
        }
        this.sliderContainer.getWorldMatrix().invertToRef(this._scratchInvMatrix);
        return BABYLON.Vector3.TransformCoordinates(worldPoint, this._scratchInvMatrix);
    }

    _setHandleHighlight(sliderKey, highlighted) {
        const slider = this.sliders[sliderKey];
        if (!slider?.handle?.material) return;

        const config = slider.config;
        if (highlighted) {
            slider.handle.material.emissiveColor = config.emissive.clone().scale(2.5);
            slider.handle.scaling.setAll(1.2);
        } else {
            slider.handle.material.emissiveColor = config.emissive.clone().scale(1.5);
            slider.handle.scaling.setAll(1.0);
        }
    }

    _notifyLayoutChange() {
        const values = this.getValues();

        // Avoid firing redundant layout cycles if values did not change
        if (this._lastNotifiedValues &&
            this._lastNotifiedValues.arcAngle === values.arcAngle &&
            this._lastNotifiedValues.radius === values.radius &&
            this._lastNotifiedValues.height === values.height) {
            return;
        }
        this._lastNotifiedValues = { ...values };

        // Notify callback
        if (this._onLayoutChange) {
            this._onLayoutChange(values);
        }

        // Notify observers
        this._observers.forEach(callback => {
            try {
                callback(values);
            } catch (error) {
                console.error("LCVDSSliders observer error:", error);
            }
        });
    }

    // Add observer for value changes
    addObserver(callback) {
        if (typeof callback !== "function") return () => { };
        this._observers.add(callback);
        return () => this._observers.delete(callback);
    }

    // Check if a mesh is part of this slider system
    isSliderMesh(mesh) {
        return mesh?.metadata?.lcvdsSlider === true;
    }

    // Get slider key from mesh
    getSliderKeyFromMesh(mesh) {
        return mesh?.metadata?.sliderKey ?? null;
    }

    // Get slider kind (track/handle)
    getSliderKindFromMesh(mesh) {
        return mesh?.metadata?.kind ?? null;
    }

    // Set visibility
    setVisible(visible) {
        this.root.setEnabled(!!visible);
    }

    // Dispose all resources
    dispose() {
        if (this._pendingUpdate) {
            clearTimeout(this._pendingUpdate);
            this._pendingUpdate = null;
        }

        this._observers.clear();

        // Dispose textures
        for (const key in this.sliders) {
            const slider = this.sliders[key];
            if (slider.valuePlane?.metadata?.valueTexture) {
                slider.valuePlane.metadata.valueTexture.dispose();
            }
            if (slider.labelPlane?.material?.diffuseTexture) {
                slider.labelPlane.material.diffuseTexture.dispose();
            }
        }

        this.root.dispose();
    }
}

export default LCVDSSliders;
