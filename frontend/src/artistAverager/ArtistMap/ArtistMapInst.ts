import { UnreachableException } from 'ameo-utils';

import type { Artist } from 'src/types';
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { fetchPackedArtistPositions, getArtistsByInternalIDs } from '../api';
import { BASE_ARTIST_COLOR, MOVEMENT_SPEED_UNITS_PER_SECOND } from './conf';
import { MovementInputHandler } from './MovementInputHandler';

interface ThreeExtra {
  PointerLockControls: typeof import('three/examples/jsm/controls/PointerLockControls');
  Stats: typeof import('three/examples/jsm/libs/stats.module.js');
  RenderPass: typeof import('three/examples/jsm/postprocessing/RenderPass');
  ShaderPass: typeof import('three/examples/jsm/postprocessing/ShaderPass');
  UnrealBloomPass: typeof import('three/examples/jsm/postprocessing/UnrealBloomPass');
  EffectComposer: typeof import('three/examples/jsm/postprocessing/EffectComposer');
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
    RenderPass,
    ShaderPass,
    UnrealBloomPass,
    EffectComposer,
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
    import('three/examples/jsm/postprocessing/RenderPass'),
    import('three/examples/jsm/postprocessing/ShaderPass'),
    import('three/examples/jsm/postprocessing/UnrealBloomPass'),
    import('three/examples/jsm/postprocessing/EffectComposer'),
  ] as const);
  const initialArtistIDsToRenderPromise = getInitialArtistIDsToRender();
  const THREE_EXTRA: ThreeExtra = {
    PointerLockControls,
    Stats,
    RenderPass,
    ShaderPass,
    UnrealBloomPass,
    EffectComposer,
  };

  const inst = new ArtistMapInst(THREE, THREE_EXTRA, wasmClient, ctxPtr, totalArtistCount, canvas);
  // Render initial artists
  const initialArtistIDsToRender = await initialArtistIDsToRenderPromise.then((ids) => {
    // Optimization to allow us to start fetching artist data as soon as we have the IDs regardless of whether we've
    // finished fetching the wasm client, three, packed artist positions, etc.
    // fetchAndCacheArtistData(ids);

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
  private bloomComposer: EffectComposer;
  private finalComposer: EffectComposer;
  private clock: THREE.Clock;
  private stats: ReturnType<ThreeExtra['Stats']['default']>;

  private totalArtistCount: number;
  private renderedArtistIDs: Set<number> = new Set();
  private renderedArtistLabelsByID: Map<
    number,
    { mesh: THREE.Mesh; pos: THREE.Vector3; width: number }
  > = new Map();
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // TODO: Remove
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.clock = new THREE.Clock();

    this.camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 2000);
    this.camera.position.set(1.4, -0.7, 1);
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
      const geometry = new this.THREE.IcosahedronGeometry(0.01, 6);
      const material = new this.THREE.MeshPhongMaterial({
        color: BASE_ARTIST_COLOR,
        // wireframe: true,
        shininess: 38,
        // fog: true,
        specular: 0x996633,
        reflectivity: 1,
      });
      const meshes = new this.THREE.InstancedMesh(geometry, material, 50);
      meshes.count = 0;
      return meshes;
    })();
    this.scene.add(this.artistMeshes);

    this.initBloomPass();

    this.animate();
  }

  // Adapted from:
  // https://github.com/mrdoob/three.js/blob/master/examples/webgl_postprocessing_unreal_bloom_selective.html
  private initBloomPass() {
    const params = {
      bloomStrength: 3.3,
      bloomThreshold: 0,
      bloomRadius: 0.45,
    };

    const renderScene = new this.THREE_EXTRA.RenderPass.RenderPass(this.scene, this.camera);

    const bloomPass = new this.THREE_EXTRA.UnrealBloomPass.UnrealBloomPass(
      new this.THREE.Vector2(this.renderer.domElement.width, this.renderer.domElement.height),
      params.bloomStrength,
      params.bloomRadius,
      params.bloomThreshold
    );
    bloomPass.threshold = params.bloomThreshold;
    bloomPass.strength = params.bloomStrength;
    bloomPass.radius = params.bloomRadius;

    this.bloomComposer = new this.THREE_EXTRA.EffectComposer.EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(bloomPass);

    const finalPass = new this.THREE_EXTRA.ShaderPass.ShaderPass(
      new this.THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
        },
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
			    uniform sampler2D bloomTexture;

			    varying vec2 vUv;

			    void main() {
				    gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
			    }
        `,
        defines: {},
      }),
      'baseTexture'
    );
    finalPass.needsSwap = true;

    this.finalComposer = new this.THREE_EXTRA.EffectComposer.EffectComposer(this.renderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(finalPass);
  }

  private loadFont(): Promise<THREE.Font> {
    return new Promise((resolve) => {
      const fontLoader = new this.THREE.FontLoader();
      fontLoader.load('/optimer_regular.typeface.json', resolve);
    });
  }

  public renderArtists(artistInternalIDs: number[]) {
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

    // Kick off request to fetch artist names etc. asynchronously
    fetchAndCacheArtistData(artistInternalIDs).then(async () => {
      const font = await this.loadFont();

      // Generate + render labels for artists that don't yet have them
      const textMaterial = new this.THREE.MeshBasicMaterial({ color: 0xffffff });

      artistsToRender.forEach((id, i) => {
        if (this.renderedArtistLabelsByID.has(id)) {
          return;
        }

        const artist = ArtistsByInternalID.get(id);
        if (typeof artist === 'string' || !artist) {
          console.log({ ArtistsByInternalID });
          throw new UnreachableException(
            `Artist id=${id} should have been fetched by now; found=${artist}`
          );
        }

        const textGeometry = new this.THREE.TextGeometry(artist.name, {
          font,
          size: 0.02,
          height: 0.002,
          curveSegments: 1,
        });
        const textMesh = new this.THREE.Mesh(textGeometry, textMaterial);
        // Create a bounding box to measure the text so we can know how wide it is in order to
        // accurately center it
        const bbox = new this.THREE.Box3().setFromObject(textMesh);
        const dims = new this.THREE.Vector3();
        bbox.getSize(dims);
        const width = dims.x;

        const pos = [
          artistPositions[i * 3],
          artistPositions[i * 3 + 1],
          artistPositions[i * 3 + 2],
        ] as const;
        textMesh.position.set(pos[0], pos[1] + 0.02, pos[2]);
        this.scene.add(textMesh);

        this.renderedArtistLabelsByID.set(id, {
          mesh: textMesh,
          pos: new this.THREE.Vector3(pos[0], pos[1], pos[2]),
          width,
        });
      });
    });

    const matrix = new this.THREE.Matrix4();
    matrix.makeScale(5, 5, 5);
    const artistColor = new this.THREE.Color(/* BASE_ARTIST_COLOR */);
    artistsToRender.forEach((_id, i) => {
      const pos = [
        artistPositions[i * 3],
        artistPositions[i * 3 + 1],
        artistPositions[i * 3 + 2],
      ] as const;

      // matrix.makeScale(i * 0.5, i * 0.5, i * 0.5);
      matrix.setPosition(...pos);
      this.artistMeshes.setMatrixAt(startIx + i, matrix);
      this.artistMeshes.setColorAt(startIx + i, artistColor);

      const light = new this.THREE.PointLight(
        new this.THREE.Color(0x66ef66),
        0.0165,
        undefined,
        0.2
      );
      light.shadow.mapSize.width = 1024;
      light.shadow.mapSize.height = 1024;
      light.position.x = pos[0];
      light.position.y = pos[1];
      light.position.z = pos[2];
      this.scene.add(light);
    });
    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceColor!.needsUpdate = true;

    console.log('Total rendered artist count: ', this.artistMeshes.count);
  }

  private darkenNonBloomed() {
    this.renderedArtistLabelsByID.forEach(({ mesh }) => {
      (mesh as any).materialOld = mesh.material;
      mesh.material = new this.THREE.MeshBasicMaterial({ color: 0x000000 });
    });
  }

  private restoreNonBloomed() {
    this.renderedArtistLabelsByID.forEach(({ mesh }) => {
      mesh.material = (mesh as any).materialOld;
    });
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

    // Make all labels appear above their respective artists and face the camera
    this.renderedArtistLabelsByID.forEach(({ mesh, pos, width }) => {
      const cameraOffset = this.camera.position.clone().sub(pos);
      const inverseCameraPos = pos.clone().sub(cameraOffset.multiplyScalar(2));

      mesh.matrix.copy(mesh.matrix.lookAt(pos, inverseCameraPos, this.camera.up));
      mesh.matrix.setPosition(
        pos
          .clone()
          // Move the label towards the camera
          .add(
            cameraOffset
              .clone()
              .normalize()
              .multiplyScalar(width * 1.4 + 0.05)
          )
          // Move the label up with respect to the camera, less distance the closer it is
          .add(this.camera.up.clone().multiplyScalar(0.09))
          // And move it left to center it
          .add(
            this.camera.up
              .clone()
              .cross(cameraOffset)
              .normalize()
              .multiplyScalar(-0.5 * width)
          )
      );
      mesh.matrixAutoUpdate = false;
    });

    this.darkenNonBloomed();
    this.bloomComposer.render();
    this.restoreNonBloomed();
    this.finalComposer.render();
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    this.render();
  }
}
