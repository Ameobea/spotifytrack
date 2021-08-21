import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { fetchPackedArtistPositions } from '../api';
import {
  ARTIST_GEOMETRY_SIZE,
  ARTIST_LABEL_TEXT_SIZE,
  BASE_ARTIST_COLOR,
  MOVEMENT_SPEED_UNITS_PER_SECOND,
} from './conf';
import DataFetchClient, {
  ArtistMapDataWithId,
  ArtistRelationshipDataWithId,
} from './DataFetchClient';
import { MovementInputHandler } from './MovementInputHandler';

interface ThreeExtra {
  PointerLockControls: typeof import('three/examples/jsm/controls/PointerLockControls');
  Stats: typeof import('three/examples/jsm/libs/stats.module.js');
  RenderPass: typeof import('three/examples/jsm/postprocessing/RenderPass');
  ShaderPass: typeof import('three/examples/jsm/postprocessing/ShaderPass');
  UnrealBloomPass: typeof import('three/examples/jsm/postprocessing/UnrealBloomPass');
  EffectComposer: typeof import('three/examples/jsm/postprocessing/EffectComposer');
}

const dataFetchClient = new DataFetchClient();

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
    dataFetchClient.getOrFetchArtistData(ids);
    dataFetchClient.getOrFetchArtistRelationships(ids);

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
  private font: THREE.Font;
  private clock: THREE.Clock;
  private stats: ReturnType<ThreeExtra['Stats']['default']>;

  private totalArtistCount: number;
  private renderedArtistIDs: Set<number> = new Set();
  private renderedConnections: Set<string> = new Set();
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

    this.camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 200_000);
    this.camera.position.set(1.4, -0.7, 1);
    this.camera.lookAt(0, 0, 0);

    this.movementInputHandler = new MovementInputHandler();

    this.scene = new THREE.Scene();
    this.scene.fog = new this.THREE.Fog(0x000000, 1, 12_000);

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
      const geometry = new this.THREE.IcosahedronGeometry(ARTIST_GEOMETRY_SIZE, 3);
      const material = new this.THREE.MeshPhongMaterial({
        color: BASE_ARTIST_COLOR,
        // wireframe: true,
        shininess: 38,
        // fog: true,
        specular: 0x996633,
        reflectivity: 1,
      });
      const meshes = new this.THREE.InstancedMesh(geometry, material, 100000);
      meshes.count = 0;
      return meshes;
    })();
    this.scene.add(this.artistMeshes);

    this.initBloomPass();

    this.initAsync();

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

  private async initAsync() {
    this.font = await this.loadFont();

    // We're now able to actually render artist labels, so register the data fetch client callbacks
    dataFetchClient.registerCallbacks(
      (data) => this.handleArtistData(data),
      (data) => this.handleArtistRelationships(data)
    );
  }

  private handleArtistData(artistData: ArtistMapDataWithId[]) {
    // TODO: Decide if we actually want to render artist names or not based on distance or something

    const artistIDs = artistData.map((datum) => datum.id);
    const artistPositions = this.wasmClient.get_artist_positions(
      this.ctxPtr,
      new Uint32Array(artistIDs)
    );
    artistData.forEach(({ id: artistID, name }, i) => {
      if (Number.isNaN(artistPositions[i * 3])) {
        return;
      }

      const position = new this.THREE.Vector3(
        artistPositions[i * 3],
        artistPositions[i * 3 + 1],
        artistPositions[i * 3 + 2]
      );
      this.renderArtistLabel(artistID, name, position);
    });
    // dataFetchClient.getOrFetchArtistRelationships(artistIDs);
  }

  private handleArtistRelationships(artistRelationships: ArtistRelationshipDataWithId[]) {
    // TODO: Decide if we actually want to render the artists or not based on distance or something

    // TODO: Render connections between artists

    const allArtistIDs = Array.from(
      new Set(artistRelationships.flatMap((datum) => [datum.id, ...datum.relatedArtists])).values()
    );
    this.renderArtists(allArtistIDs);
    const artistPositions = this.wasmClient.get_artist_positions(
      this.ctxPtr,
      new Uint32Array(allArtistIDs)
    );
    artistRelationships.forEach(({ id, relatedArtists }) => {
      const posIx = allArtistIDs.indexOf(id);
      if (Number.isNaN(artistPositions[posIx * 3])) {
        return;
      }

      const artistPosition = new this.THREE.Vector3(
        artistPositions[posIx * 3],
        artistPositions[posIx * 3 + 1],
        artistPositions[posIx * 3 + 2]
      );

      relatedArtists.forEach((relatedID) => {
        const relatedPosIx = allArtistIDs.indexOf(relatedID);
        if (Number.isNaN(artistPositions[relatedPosIx])) {
          return;
        }
        const relatedPosition = new this.THREE.Vector3(
          artistPositions[relatedPosIx * 3],
          artistPositions[relatedPosIx * 3 + 1],
          artistPositions[relatedPosIx * 3 + 2]
        );

        this.renderConnection(id, artistPosition, relatedID, relatedPosition);
      });
    });

    dataFetchClient.getOrFetchArtistData(allArtistIDs);
    // dataFetchClient.getOrFetchArtistRelationships(allArtistIDs);
  }

  private async renderArtistLabel(
    artistID: number,
    artistName: string,
    artistPosition: THREE.Vector3
  ) {
    if (this.renderedArtistLabelsByID.has(artistID)) {
      return;
    }

    const textMaterial = new this.THREE.MeshBasicMaterial({ color: 0xff2333 });
    const textGeometry = new this.THREE.TextGeometry(artistName, {
      font: this.font,
      size: ARTIST_LABEL_TEXT_SIZE,
      height: 0.2,
      curveSegments: 1,
    });
    const textMesh = new this.THREE.Mesh(textGeometry, textMaterial);
    // Create a bounding box to measure the text so we can know how wide it is in order to
    // accurately center it
    const bbox = new this.THREE.Box3().setFromObject(textMesh);
    const dims = new this.THREE.Vector3();
    bbox.getSize(dims);
    const width = dims.x;

    // The label's position is set every frame in the render function
    this.scene.add(textMesh);

    this.renderedArtistLabelsByID.set(artistID, {
      mesh: textMesh,
      pos: artistPosition,
      width,
    });
  }

  public renderConnection(
    artist1ID: number,
    artist1Pos: THREE.Vector3,
    artist2ID: number,
    artist2Pos: THREE.Vector3
  ) {
    if (
      this.renderedConnections.has(`${artist1ID}-${artist2ID}`) ||
      this.renderedConnections.has(`${artist2ID}-${artist1ID}`)
    ) {
      return;
    }
    this.renderedConnections.add(`${artist1ID}-${artist2ID}`);

    const lineMaterial = new this.THREE.LineBasicMaterial({
      color: 0x2288ee,
      transparent: true,
      opacity: 0.1,
      linewidth: 2,
    });
    const lineGeometry = new this.THREE.BufferGeometry().setFromPoints([artist1Pos, artist2Pos]);
    const lineMesh = new this.THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(lineMesh);
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

    const matrix = new this.THREE.Matrix4();
    matrix.makeScale(5, 5, 5);
    const artistColor = new this.THREE.Color(/* BASE_ARTIST_COLOR */);
    artistsToRender.forEach((_id, i) => {
      if (Number.isNaN(artistPositions[i * 3])) {
        return;
      }

      const pos = [
        artistPositions[i * 3],
        artistPositions[i * 3 + 1],
        artistPositions[i * 3 + 2],
      ] as const;

      matrix.setPosition(...pos);
      this.artistMeshes.setMatrixAt(startIx + i, matrix);
      this.artistMeshes.setColorAt(startIx + i, artistColor);

      // TODO: Need to limit the amount of created lights
      // const light = new this.THREE.PointLight(
      //   new this.THREE.Color(0x66ef66),
      //   0.0165,
      //   undefined,
      //   0.2
      // );
      // light.shadow.mapSize.width = 1024;
      // light.shadow.mapSize.height = 1024;
      // light.position.x = pos[0];
      // light.position.y = pos[1];
      // light.position.z = pos[2];
      // this.scene.add(light);
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
    const { forward, sideways } = this.movementInputHandler.getDirectionVector();
    this.controls.moveRight(sideways * MOVEMENT_SPEED_UNITS_PER_SECOND);
    this.controls.getObject().position.add(
      this.controls
        .getDirection(VEC3_IDENTITY)
        .clone()
        .multiplyScalar(MOVEMENT_SPEED_UNITS_PER_SECOND * forward)
    );

    // Make all labels appear above their respective artists and face the camera
    this.renderedArtistLabelsByID.forEach(({ mesh, pos, width }) => {
      const cameraOffset = this.camera.position.clone().sub(pos);
      const inverseCameraPos = pos.clone().sub(cameraOffset.multiplyScalar(2));

      mesh.matrix.copy(mesh.matrix.lookAt(pos, inverseCameraPos, this.camera.up));
      mesh.matrix.setPosition(
        pos
          .clone()
          // Move the label up with respect to the camera, less distance the closer it is
          .add(this.camera.up.clone().multiplyScalar(8))
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
