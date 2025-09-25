

export class CartesianDistortionController {
    constructor(targets = []) {
        this.targets = targets;
        this.enabled = false;
        this.focus = { x: 0.5, y: 0.5 };
        this.D = 0.0; 
    }

    addTarget(target) { this.targets.push(target); }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.targets.forEach(t => t?.setCartesianEnabled?.(enabled));
    }

    toggle() { this.setEnabled(!this.enabled); }

    setFocus(xNorm, yNorm) {
        this.focus = { x: Math.max(0, Math.min(1, xNorm)), y: Math.max(0, Math.min(1, yNorm)) };
        this.targets.forEach(t => t?.setCartesianFocus?.(this.focus.x, this.focus.y));
    }

    setD(d) {
        this.D = Math.max(0.1, d);
        this.targets.forEach(t => t?.setCartesianD?.(this.D));
    }

    nudgeD(delta) {
        this.setD(this.D + delta);
    }
}

export default CartesianDistortionController;
