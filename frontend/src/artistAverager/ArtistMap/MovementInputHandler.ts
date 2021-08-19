class MovementInputFlags {
  public up = false;
  public down = false;
  public right = false;
  public left = false;
}

export class MovementInputHandler {
  private inputs: MovementInputFlags = new MovementInputFlags();
  private directionVector: THREE.Vector3;

  constructor(directionVector: THREE.Vector3) {
    this.directionVector = directionVector;
    this.directionVector.setY(0);

    window.addEventListener('keydown', (evt) => {
      switch (evt.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.inputs.up = true;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.inputs.left = true;
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.inputs.down = true;
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.inputs.right = true;
          break;
        default:
        // pass
      }
    });
    window.addEventListener('keyup', (evt) => {
      switch (evt.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.inputs.up = false;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.inputs.left = false;
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.inputs.down = false;
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.inputs.right = false;
          break;
        default:
        // pass
      }
    });
  }

  public getDirectionVector(): THREE.Vector3 {
    this.directionVector.setX(-+this.inputs.left + +this.inputs.right);
    this.directionVector.setZ(-+this.inputs.down + +this.inputs.up);
    this.directionVector.normalize();
    return this.directionVector;
  }
}
