class CurvedScreen {
    constructor(csvData, { arcAngle, radius, height }, scene) {
        this.arcAngle = arcAngle;
        this.radius = radius;
        this.height = height;
        this.numRows = csvData.length;
        this.numCols = Object.keys(csvData[0]).length;
        this.matrices = [];

        this.arcLength = this.radius * this.arcAngle;

        this.cellWidth = this.arcLength / this.numCols;
        this.cellHeight = this.height / this.numRows;





    }

    computeCellPositions() {

        const startAngle = -this.arcAngle / 2;
        const colStepAngle = this.arcAngle / this.numCols;
        for (let row = 0; row < this.numRows; row++) {
            for (let column = 0; column < this.numCols; column++) {
                const cellAngle = startAngle + (column * colStepAngle) + (colStepAngle / 2);
                const x = this.radius * Math.sin(cellAngle);
                const z = this.radius * Math.cos(cellAngle) - this.radius;
                const y = (row - this.numRows / 2 + 0.5) * this.cellHeight;
                const scaling = new BABYLON.Vector3(1, 1, 1);
                const rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(cellAngle, 0, 0);
                const translation = new BABYLON.Vector3(x, y, z);
                const finalMatrix = BABYLON.Matrix.Compose(scaling, rotationQuaternion, translation);

                this.matrices.push(...finalMatrix.asArray());
            }

        }
        return this.matrices;
    }

}

export default CurvedScreen;