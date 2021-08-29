import {
  MUSIC_DISTANCE_ROLLOFF_FACTOR,
  SHIFT_SPEED_MULTIPLIER,
  SPEED_BOOST_MUSIC_DISTANCE_ROLLOFF_FACTOR,
} from './conf';

class MovementInputFlags {
  public up = false;
  public down = false;
  public right = false;
  public left = false;
  public shift = false;
  public descend = false;
  public ascend = false;
}

export class MovementInputHandler {
  private inputs: MovementInputFlags = new MovementInputFlags();

  constructor(setSoundRolloffFactor: (newRolloffFactor: number) => void) {
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
        case 'ShiftLeft':
        case 'ShiftRight':
          this.inputs.shift = true;
          // Movement speed is increased so increase sound rolloff factor so sound can be heard for longer
          setSoundRolloffFactor(SPEED_BOOST_MUSIC_DISTANCE_ROLLOFF_FACTOR);
          break;
        case 'KeyQ':
        case 'Space':
          this.inputs.ascend = true;
          break;
        case 'KeyZ':
          this.inputs.descend = true;
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
        case 'ShiftLeft':
        case 'ShiftRight':
          this.inputs.shift = false;
          // Movement speed is restored to normal.  Restore the sound travel distance to normal as well.
          setSoundRolloffFactor(MUSIC_DISTANCE_ROLLOFF_FACTOR);
          break;
        case 'KeyQ':
        case 'Space':
          this.inputs.ascend = false;
          break;
        case 'KeyZ':
          this.inputs.descend = false;
          break;
        default:
        // pass
      }
    });
  }

  public getDirectionVector(): { forward: number; sideways: number; up: number } {
    return {
      sideways:
        (-+this.inputs.left + +this.inputs.right) *
        (this.inputs.shift ? SHIFT_SPEED_MULTIPLIER : 1),
      forward:
        (-+this.inputs.down + +this.inputs.up) * (this.inputs.shift ? SHIFT_SPEED_MULTIPLIER : 1),
      up:
        (-+this.inputs.descend + +this.inputs.ascend) *
        (this.inputs.shift ? SHIFT_SPEED_MULTIPLIER : 1),
    };
  }
}
