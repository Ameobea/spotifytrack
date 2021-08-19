import { UnreachableException } from 'ameo-utils';

import type { Artist } from 'src/types';
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { fetchPackedArtistPositions, getArtistsByInternalIDs } from '../api';
import { BASE_ARTIST_COLOR, MOVEMENT_SPEED_UNITS_PER_SECOND } from './conf';
import { MovementInputHandler } from './MovementInputHandler';

interface ThreeExtra {
  PointerLockControls: typeof import('three/examples/jsm/controls/PointerLockControls');
  Stats: typeof import('three/examples/jsm/libs/stats.module.js');
}

const ArtistsByInternalID: Map<number, Artist | 'FETCHING' | null> = new Map();

const fetchAndCacheArtistData = async (artistIDs: number[]) => {
  const artistIDsToFetch = artistIDs.filter((id) => !ArtistsByInternalID.has(id));
  if (artistIDsToFetch.length === 0) {
    return;
  }

  artistIDsToFetch.forEach((id) => ArtistsByInternalID.set(id, 'FETCHING'));

  const artists = await getArtistsByInternalIDs(artistIDsToFetch);
  if (artists.length !== artistIDsToFetch.length) {
    throw new UnreachableException('API error; expected to return exact length requested');
  }

  artists.forEach((artist, i) => {
    const internalID = artistIDsToFetch[i];
    if (ArtistsByInternalID.get(internalID) !== 'FETCHING') {
      throw new UnreachableException('Fetch logic invariant violation');
    }
    ArtistsByInternalID.set(internalID, artist);
  });
};

const getInitialArtistIDsToRender = async (): Promise<number[]> => {
  // This will eventually be fetched from the API or something, probably.
  // prettier-ignore
  return [912, 65, 643, 7801598, 57179651, 9318669, 248, 1339641, 515, 3723925, 486, 3323512, 3140393, 31, 725, 11, 170, 64, 14710, 634, 2, 132, 331787, 86, 93, 9241776, 68, 10176774, 331777, 108578, 110569, 110030, 817, 9301916, 137, 67, 85966964];
};

export const initArtistMapInst = async (canvas: HTMLCanvasElement): Promise<ArtistMapInst> => {
  const [
    { wasmClient, totalArtistCount, ctxPtr },
    THREE,
    PointerLockControls,
    Stats,
  ] = await Promise.all([
    Promise.all([import('./WasmClient/engine'), fetchPackedArtistPositions()] as const).then(
      ([wasmClient, packedArtistPositions]) => {
        // Initialize the Wasm context + populate it with the fetched packed artist positions
        const ctxPtr = wasmClient.create_artist_map_ctx();
        const totalArtistCount = wasmClient.decode_and_record_packed_artist_positions(
          ctxPtr,
          new Uint8Array(packedArtistPositions)
        );
        return { wasmClient, totalArtistCount, ctxPtr };
      }
    ),
    import('three'),
    import('three/examples/jsm/controls/PointerLockControls'),
    import('three/examples/jsm/libs/stats.module'),
  ] as const);
  const initialArtistIDsToRenderPromise = getInitialArtistIDsToRender();
  const THREE_EXTRA: ThreeExtra = { PointerLockControls, Stats };

  const inst = new ArtistMapInst(THREE, THREE_EXTRA, wasmClient, ctxPtr, totalArtistCount, canvas);
  // Render initial artists
  const initialArtistIDsToRender = await initialArtistIDsToRenderPromise.then((ids) => {
    // Optimization to allow us to start fetching artist data as soon as we have the IDs regardless of whether we've
    // finished fetching the wasm client, three, packed artist positions, etc.
    fetchAndCacheArtistData(ids);

    return ids;
  });

  inst.renderArtists(initialArtistIDsToRender);
  return inst;
};

let VEC3_IDENTITY: THREE.Vector3;

export class ArtistMapInst {
  public THREE: typeof import('three');
  public THREE_EXTRA: ThreeExtra;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private isPointerLocked = false;
  private clock: THREE.Clock;
  private stats: ReturnType<ThreeExtra['Stats']['default']>;

  private totalArtistCount: number;
  private renderedArtistIDs: Set<number> = new Set();
  private artistMeshes: THREE.InstancedMesh;
  private movementInputHandler: MovementInputHandler;

  private wasmClient: typeof import('./WasmClient/engine');
  private ctxPtr: number;

  constructor(
    THREE: typeof import('three'),
    THREE_EXTRA: ThreeExtra,
    wasmClient: typeof import('./WasmClient/engine'),
    ctxPtr: number,
    totalArtistCount: number,
    canvas: HTMLCanvasElement
  ) {
    this.THREE = THREE;
    this.THREE_EXTRA = THREE_EXTRA;
    VEC3_IDENTITY = new THREE.Vector3();

    this.wasmClient = wasmClient;
    this.ctxPtr = ctxPtr;
    this.totalArtistCount = totalArtistCount;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.clock = new THREE.Clock();

    this.camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 2000);
    this.camera.position.set(10, 10, 10);
    this.camera.lookAt(0, 0, 0);

    this.movementInputHandler = new MovementInputHandler(new THREE.Vector3());

    this.scene = new THREE.Scene();
    const light = new THREE.AmbientLight(0x404040); // soft white light
    this.scene.add(light);

    this.controls = new THREE_EXTRA.PointerLockControls.PointerLockControls(this.camera, canvas);
    this.controls.addEventListener('unlock', () => {
      if (this.isPointerLocked) {
        this.isPointerLocked = false;
        this.scene.remove(this.controls.getObject());
      }
    });

    canvas.addEventListener('mousedown', () => {
      if (this.isPointerLocked) {
        return;
      }

      this.isPointerLocked = true;
      this.controls.lock();
      this.scene.add(this.controls.getObject());
    });

    // this.stats = THREE_EXTRA.Stats.default();
    // canvas.appendChild(this.stats.domElement);

    this.artistMeshes = (() => {
      const geometry = new this.THREE.IcosahedronGeometry(0.03, 3);
      const material = new this.THREE.MeshBasicMaterial({
        color: BASE_ARTIST_COLOR,
        wireframe: true,
      });
      const meshes = new this.THREE.InstancedMesh(geometry, material, 50);
      meshes.count = 0;
      return meshes;
    })();
    this.scene.add(this.artistMeshes);

    this.animate();
  }

  public renderArtists(artistInternalIDs: number[]) {
    // Kick off request to fetch artist names etc. asynchronously
    fetchAndCacheArtistData(artistInternalIDs).then(() => {
      // TODO: Update viz??
    });

    // Skip artists that are already rendered
    const artistsToRender = artistInternalIDs.filter((id) => {
      if (!this.renderedArtistIDs.has(id)) {
        this.renderedArtistIDs.add(id);
        return true;
      }
      return false;
    });

    const startIx = this.artistMeshes.count;
    this.artistMeshes.count = startIx + artistsToRender.length;

    const artistPositions = this.wasmClient.get_artist_positions(
      this.ctxPtr,
      new Uint32Array(artistsToRender)
    );

    const matrix = new this.THREE.Matrix4();
    const artistColor = new this.THREE.Color(/* BASE_ARTIST_COLOR */);
    artistsToRender.forEach((_id, i) => {
      const pos = [
        artistPositions[i * 3],
        artistPositions[i * 3 + 1],
        artistPositions[i * 3 + 2],
      ] as const;

      matrix.setPosition(...pos);
      this.artistMeshes.setMatrixAt(startIx + i, matrix);
      this.artistMeshes.setColorAt(startIx + i, artistColor);
    });
    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceColor!.needsUpdate = true;

    console.log('Total rendered artist count: ', this.artistMeshes.count);
  }

  private render() {
    // this.stats.update();
    const movementDirection = this.movementInputHandler.getDirectionVector();
    this.controls.moveForward(movementDirection.z * MOVEMENT_SPEED_UNITS_PER_SECOND);
    this.controls.moveRight(movementDirection.x * MOVEMENT_SPEED_UNITS_PER_SECOND);
    this.controls.getObject().position.y +=
      this.controls.getDirection(VEC3_IDENTITY).y *
      movementDirection.z *
      MOVEMENT_SPEED_UNITS_PER_SECOND;
    this.renderer.render(this.scene, this.camera);
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    this.render();
  }
}
