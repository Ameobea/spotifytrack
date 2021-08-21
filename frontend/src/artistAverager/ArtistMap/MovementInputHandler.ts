class MovementInputFlags {
  public up = false;
  public down = false;
  public right = false;
  public left = false;
}

export class MovementInputHandler {
  private inputs: MovementInputFlags = new MovementInputFlags();

  constructor() {
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

  public getDirectionVector(): { forward: number; sideways: number } {
    return {
      sideways: -+this.inputs.left + +this.inputs.right,
      forward: -+this.inputs.down + +this.inputs.up,
    };
  }
}
