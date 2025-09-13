export class InteractionManager {
    constructor(layout, { heatMap, twoTone }, xrHelper) {
        this.xrHelper = xrHelper;
        this.heatMap = heatMap;
        this.twoTone = twoTone;
        heatMap.basePlane.isPickable = true;
        twoTone.basePlane.isPickable = true;
        this._setupVRInteraction();


    }
    _setupVRInteraction() {
        if (this.xrHelper) {
            console.log("Browser supports WebXR");
            this.xrHelper.input.onControllerAddedObservable.add((controller) => {
                console.log("Controller added:", controller);
                controller.onMotionControllerInitObservable.add((motionController) => {
                    console.log("Motion controller initialized:", motionController);
                    const triggerComponent = motionController.getComponentOfType("xr-standard-trigger");
                    const squeezeComponent = motionController.getComponentOfType("xr-standard-squeeze");
                    const aComponent = motionController.getComponentOfType("a-button");
                    const bComponent = motionController.getComponentOfType("b-button");
                    const xComponent = motionController.getComponentOfType("x-button");
                    const yComponent = motionController.getComponentOfType("y-button");
                    const menuComponent = motionController.getComponentOfType("menu-button");
                    console.log("Button that is not supported:", triggerComponent && squeezeComponent && aComponent && bComponent && xComponent && bComponent && yComponent && menuComponent);
                })
            })

        }

    }


}
