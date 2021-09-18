import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import * as Comlink from 'comlink';
import { UnimplementedError, UnreachableException } from 'ameo-utils';
import type { Scale } from 'chroma-js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';

import { fetchPackedArtistPositions, getAllTopArtistInternalIDsForUser } from '../api';
import {
  BASE_ARTIST_GEOMETRY_SIZE,
  BASE_CONNECTION_COLOR,
  getArtistSize,
  MOVEMENT_SPEED_UNITS_PER_SECOND,
  SECONDS_BETWEEN_POSITION_UPDATES,
  ARTIST_GEOMETRY_OPACITY,
  DEFAULT_FOV,
  getArtistColor,
  BLOOMED_CONNECTION_OPACITY,
  BLOOM_PARAMS,
  SHIFT_SPEED_MULTIPLIER,
  MAX_ARTIST_PLAY_CLICK_DISTANCE,
  ARTIST_GEOMETRY_DETAIL,
  PLAYING_ARTIST_COLOR,
  CAMERA_PIVOT_COEFFICIENT,
  CAMERA_OVERRIDE_TARGET_TOLERANCE,
  AMBIENT_LIGHT_COLOR,
  getArtistFlyToDurationMs,
} from './conf';
import DataFetchClient, { ArtistMapDataWithId, ArtistRelationshipData } from './DataFetchClient';
import { MovementInputHandler } from './MovementInputHandler';
import type { WasmClient } from './WasmClient/WasmClient.worker';
import { UIEventRegistry } from './OverlayUI/OverlayUI';
import MusicManager from './MusicManager';

interface ThreeExtra {
  PointerLockControls: typeof import('three/examples/jsm/controls/PointerLockControls')['PointerLockControls'];
  RenderPass: typeof import('three/examples/jsm/postprocessing/RenderPass')['RenderPass'];
  ShaderPass: typeof import('three/examples/jsm/postprocessing/ShaderPass')['ShaderPass'];
  UnrealBloomPass: typeof import('three/examples/jsm/postprocessing/UnrealBloomPass')['UnrealBloomPass'];
  EffectComposer: typeof import('three/examples/jsm/postprocessing/EffectComposer')['EffectComposer'];
}

const dataFetchClient = new DataFetchClient();

const getInitialArtistIDsToRender = async (): Promise<number[]> => {
  // This will eventually be fetched from the API or something, probably.
  // prettier-ignore
  return [912, 65, 643, 7801598, 57179651, 9318669, 248, 1339641, 515, 3723925, 486, 3323512, 3140393, 31, 725, 11, 170, 64, 14710, 634, 2, 132, 331787, 86, 93, 9241776, 68, 10176774, 331777, 108578, 110569, 110030, 817, 9301916, 137, 67, 85966964];
};

const wasmClient = Comlink.wrap<WasmClient>(
  new Worker(new URL('./WasmClient/WasmClient.worker', import.meta.url))
);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForWasmClientInitialization = async () => {
  while (true) {
    const success = await Promise.race([wasmClient.ping(), delay(50)] as const);
    if (success) {
      return;
    }
  }
};

export const initArtistMapInst = async (canvas: HTMLCanvasElement): Promise<ArtistMapInst> => {
  const [
    ,
    { THREE, PointerLockControls, RenderPass, ShaderPass, UnrealBloomPass, EffectComposer },
  ] = await Promise.all([
    fetchPackedArtistPositions().then(async (packedArtistPositions) => {
      // The wasm client web worker needs to do some async initialization.  Wait for it to do that so we
      // don't leak our requests into the ether
      await waitForWasmClientInitialization();

      // Populate the wasm client running in a web worker with the fetched packed artist positions
      const packed = new Uint8Array(packedArtistPositions);
      return wasmClient.decodeAndRecordPackedArtistPositions(
        Comlink.transfer(packed, [packed.buffer])
      );
    }),
    import('./lazyThree').then((mod) => mod.default),
  ] as const);
  const initialArtistIDsToRenderPromise = getInitialArtistIDsToRender();
  const THREE_EXTRA: ThreeExtra = {
    PointerLockControls,
    RenderPass,
    ShaderPass,
    UnrealBloomPass,
    EffectComposer,
  };

  const allArtistData = await wasmClient.getAllArtistData();

  const inst = new ArtistMapInst(THREE, THREE_EXTRA, canvas, allArtistData);
  // Render initial artists
  const initialArtistIDsToRender = await initialArtistIDsToRenderPromise.then((ids) => {
    // Optimization to allow us to start fetching artist data as soon as we have the IDs regardless of whether we've
    // finished fetching the wasm client, three, packed artist positions, etc.
    dataFetchClient.getOrFetchArtistData(ids);
    dataFetchClient.fetchArtistRelationships(ids);

    return ids;
  });

  // Set highlighted artists.
  // TODO: Should be user-specific with OAuth flow etc.
  // getAllTopArtistInternalIDsForUser('tt65cl3nc7wxnzgyzlm447571').then((artistIDs) =>
  getAllTopArtistInternalIDsForUser('ameobea').then((artistIDs) =>
    inst.setHighlightedArtistIDs(artistIDs)
  );

  await inst.renderArtists(initialArtistIDsToRender);
  return inst;
};

let VEC3_IDENTITY: THREE.Vector3;

enum DrawCommand {
  AddLabel = 0,
  RemoveLabel = 1,
  AddArtistGeometry = 2,
  RemoveArtistGeometry = 3,
  FetchArtistLabel = 4,
  StartPlayingMusic = 5,
  StopPlayingMusic = 6,
}

interface AutoFlyState {
  path: THREE.Curve<THREE.Vector3>;
  startTime: number;
  flightDurationMs: number;
}

interface LookAtState {
  target: THREE.Vector3;
  pivotCoefficient: number;
}

export class ArtistMapInst {
  public THREE: typeof import('three');
  public THREE_EXTRA: ThreeExtra;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private isPointerLocked = false;
  private bloomPass: UnrealBloomPass;
  private bloomComposer: EffectComposer;
  private finalComposer: EffectComposer;
  private clock: THREE.Clock;
  private timeElapsed = 0;
  private secondSinceLastPositionUpdate = 0;
  private chroma: typeof import('chroma-js');
  private connectionColorScale: Scale;

  private renderedArtistBufferIndicesByArtistID: Map<number, number> = new Map();
  private artistIDByRenderedArtistBufferIndex: Map<number, number> = new Map();
  private bloomedConnectionsGeometry: THREE.BufferGeometry;
  private bloomedConnectionsMesh: THREE.Line;
  private nonBloomedConnectionsGeometry: THREE.BufferGeometry;
  private nonBloomedConnectionsMesh: THREE.Line;
  private artistDataByID: Map<number, { pos: THREE.Vector3; popularity: number }> = new Map();
  private pendingDrawCommands: Uint32Array[] = [];
  private artistMeshes: THREE.InstancedMesh;
  private playingArtistScale = 1;
  private playingArtistGeometry: THREE.Mesh | null = null;
  private movementInputHandler: MovementInputHandler;
  private lastCameraDirection: THREE.Vector3;
  private lastCameraPosition: THREE.Vector3;
  private forceLabelsUpdate = false;
  private wasmPositionHandlerIsRunning = false;
  private highlightedArtistIDs: Set<number> = new Set();
  private raycaster: THREE.Raycaster;
  private enableRaycasting = false;
  private cameraOverrides: {
    movement: AutoFlyState | null;
    direction: LookAtState | null;
  } = {
    movement: null,
    direction: null,
  };

  private musicManager: MusicManager;

  public getLabelPosition(labelID: string | number) {
    if (typeof labelID === 'string') {
      // TODO
      throw new UnimplementedError();
    }

    const artistData = this.artistDataByID.get(labelID);
    if (!artistData) {
      throw new Error(`Artist ${labelID} is missing`);
    }

    // Check to see if it is in front of or behind the camera
    const offsetToCamera = this.camera.position.clone().sub(artistData.pos.clone()).normalize();
    const cameraDirection = this.camera.getWorldDirection(artistData.pos.clone()).clone();
    const angle = offsetToCamera.dot(cameraDirection);
    const isInFrontOfCamera = angle < 0;

    const point = artistData.pos.clone();
    point.project(this.camera);

    const canvas = this.renderer.domElement;
    return {
      x: (0.5 + point.x / 2) * (canvas.width / window.devicePixelRatio),
      y: (0.5 - point.y / 2) * (canvas.height / window.devicePixelRatio),
      isInFrontOfCamera,
      distance: this.camera.position.distanceTo(artistData.pos),
      popularity: artistData.popularity,
    };
  }

  public eventRegistry: UIEventRegistry = new UIEventRegistry({
    getLabelPosition: (labelID: string | number) => this.getLabelPosition(labelID),
    getShouldUpdate: () => {
      const curCameraDirection = this.camera.getWorldDirection(VEC3_IDENTITY).clone();
      const curPosition = this.controls.getObject().position.clone();

      const shouldUpdate =
        this.forceLabelsUpdate ||
        this.lastCameraDirection.x !== curCameraDirection.x ||
        this.lastCameraDirection.y !== curCameraDirection.y ||
        this.lastCameraDirection.z !== curCameraDirection.z ||
        this.lastCameraPosition.x !== curPosition.x ||
        this.lastCameraPosition.y !== curPosition.y ||
        this.lastCameraPosition.z !== curPosition.z;

      this.lastCameraDirection = curCameraDirection;
      this.lastCameraPosition = curPosition;
      this.forceLabelsUpdate = false;
      return shouldUpdate;
    },
    getArtistName: (artistID: number) => {
      const data = dataFetchClient.fetchedArtistDataByID.get(artistID);
      if (!data || data === 'FETCHING') {
        return '';
      }
      return data.name;
    },
    getShouldRenderCrosshair: () => this.enableRaycasting,
    getIfArtistIDsAreInEmbedding: (artistIDs: number[]) =>
      artistIDs.map((id) => this.artistDataByID.has(id)),
    lookAtArtistID: (artistID: number) => {
      const pos = this.artistDataByID.get(artistID)?.pos;
      if (!pos) {
        throw new UnreachableException();
      }

      this.cameraOverrides.direction = { target: pos, pivotCoefficient: CAMERA_PIVOT_COEFFICIENT };
    },
    flyToArtistID: (artistID: number) => {
      const srcPos = this.controls.getObject().position.clone();
      const dstPos = this.artistDataByID.get(artistID)?.pos;
      if (!dstPos) {
        throw new UnreachableException();
      }

      // See written notes for this
      const midpoint = dstPos.clone().add(srcPos).multiplyScalar(0.5);
      const controlPoint1 = midpoint.clone().add(
        midpoint
          .clone()
          .normalize()
          .multiplyScalar(srcPos.distanceTo(dstPos) * 0.4 + 300_000)
      );
      const controlPoint2 = dstPos.clone().add(
        dstPos
          .clone()
          .sub(srcPos.clone())
          .normalize()
          .multiplyScalar(srcPos.distanceTo(dstPos) * 0.05 + 50_000)
      );

      const path = new this.THREE.CubicBezierCurve3(srcPos, controlPoint1, controlPoint2, dstPos);

      this.cameraOverrides.direction = { target: dstPos, pivotCoefficient: 0.937 };
      this.cameraOverrides.movement = {
        path,
        startTime: new Date().getTime(),
        flightDurationMs: getArtistFlyToDurationMs(dstPos.distanceTo(srcPos)),
      };
      console.log(`Flying to ${artistID}`, this.cameraOverrides.movement);
    },
    lockPointer: () => {
      this.controls.lock();
      this.isPointerLocked = true;
    },
  });

  public handleScroll(deltaY: number) {
    const newFOV = Math.max(10, Math.min(120, this.camera.fov + deltaY * 0.08));
    this.camera.fov = newFOV;
    this.eventRegistry.currentFOV = newFOV;
    this.camera.updateProjectionMatrix();
    this.forceLabelsUpdate = true;
  }

  public handlePointerDown(evt: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
    this.musicManager.startCtx();
    const wasLocked = this.isPointerLocked;
    this.isPointerLocked = true;
    this.controls.lock();
    this.scene.add(this.controls.getObject());

    if (!wasLocked) {
      return;
    }

    if (this.enableRaycasting) {
      this.raycaster.setFromCamera(new this.THREE.Vector2(0, 0), this.camera);
      const intersection = this.raycaster.intersectObject(this.artistMeshes, false)[0];
      console.log(intersection);
      if (
        !intersection ||
        intersection.distance > MAX_ARTIST_PLAY_CLICK_DISTANCE ||
        intersection.instanceId === undefined
      ) {
        return;
      }

      const artistID = this.artistIDByRenderedArtistBufferIndex.get(intersection.instanceId);
      if (!artistID) {
        console.error("Artist clicked but isn't tracked in `artistIDByRenderedArtistBufferIndex`");
        return;
      }
      wasmClient
        .handleArtistManualPlay(artistID)
        .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
    }

    if (evt.button === 0) {
      if (this.musicManager.curPlaying) {
        const curPosition = this.controls.getObject().position;
        wasmClient
          .onMusicFinishedPlaying(this.musicManager.curPlaying.artistID, [
            curPosition.x,
            curPosition.y,
            curPosition.z,
          ])
          .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
        this.musicManager.stopPlaying(this.musicManager.curPlaying.artistID);
      }
    } else if (evt.button === 2) {
      // TODO: Play last song
    }
  }

  public setHighlightedArtistIDs(artistIDs: number[]) {
    // Wasm client is the source of truth for what artists are rendered.  We indicate to it that highlighted artists have changed
    // and let it deal with dispatching draw commands to re-render them and possibly de-render the old ones.
    const curPosition = this.controls.getObject().position;
    wasmClient
      .setHighlightedArtists(
        new Uint32Array(artistIDs),
        curPosition.x,
        curPosition.y,
        curPosition.z
      )
      .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));

    // Setting these here allows us to know whether or not an artist is highlighted during rendering.  We don't do that now, but
    // will do it once the draw commands returned above are processed.
    this.highlightedArtistIDs = new Set(artistIDs);
  }

  private buildInstancedArtistMeshes() {
    const geometry = new this.THREE.IcosahedronGeometry(
      BASE_ARTIST_GEOMETRY_SIZE,
      ARTIST_GEOMETRY_DETAIL
    );
    const instanceColorBuffer = new Float32Array(100000 * 3);
    const instanceColor = new this.THREE.InstancedBufferAttribute(instanceColorBuffer, 3);
    instanceColor.count = 0;
    geometry.setAttribute('instanceColor', instanceColor);

    const material = new this.THREE.MeshPhongMaterial({
      transparent: true,
      opacity: ARTIST_GEOMETRY_OPACITY,
      depthWrite: true,
      blending: this.THREE.AdditiveBlending,
    });
    const meshes = new this.THREE.InstancedMesh(geometry, material, 100000);
    meshes.instanceColor = instanceColor;

    meshes.count = 0;
    return meshes;
  }

  constructor(
    THREE: typeof import('three'),
    THREE_EXTRA: ThreeExtra,
    canvas: HTMLCanvasElement,
    allArtistData: Float32Array
  ) {
    this.THREE = THREE;
    this.THREE_EXTRA = THREE_EXTRA;
    VEC3_IDENTITY = new THREE.Vector3();
    this.lastCameraDirection = VEC3_IDENTITY.clone();

    import('chroma-js').then((chroma) => {
      this.chroma = chroma.default;
      this.connectionColorScale = this.chroma.scale(['red', 'green', 'blue']).domain([0, 1]);
    });

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // TODO: Remove
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.clock = new THREE.Clock();

    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_FOV,
      canvas.width / canvas.height,
      0.1,
      1200_000
    );
    this.camera.position.set(
      (Math.random() - 0.5) * 80_000,
      (Math.random() - 0.5) * 80_000,
      (Math.random() - 0.5) * 80_000
    );
    // this.camera.position.set(-55323.035, -7979.134, -33066.244);
    this.camera.lookAt(0, 0, 0);

    this.raycaster = new THREE.Raycaster();

    this.movementInputHandler = new MovementInputHandler((newRolloffFactor) =>
      this.musicManager.setRolloffFactor(newRolloffFactor)
    );

    this.scene = new THREE.Scene();
    this.scene.fog = new this.THREE.Fog(0x000000, 1, 9_472_000);

    const light = new THREE.AmbientLight(AMBIENT_LIGHT_COLOR);
    this.scene.add(light);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.bloomPass.setSize(window.innerWidth, window.innerHeight);
      this.bloomComposer.setSize(window.innerWidth, window.innerHeight);
      this.forceLabelsUpdate = true;
    });

    this.controls = new THREE_EXTRA.PointerLockControls(this.camera, canvas);
    this.controls.addEventListener('unlock', () => {
      if (this.isPointerLocked) {
        this.isPointerLocked = false;
        this.scene.remove(this.controls.getObject());
      }

      this.eventRegistry.onPointerUnlocked();
    });
    this.controls.addEventListener('lock', () => {
      this.eventRegistry.onPointerLocked();
    });

    this.artistMeshes = this.buildInstancedArtistMeshes();
    this.scene.add(this.artistMeshes);

    this.bloomedConnectionsGeometry = new this.THREE.BufferGeometry();
    const bloomedLineMaterial = new this.THREE.LineBasicMaterial({
      color: BASE_CONNECTION_COLOR,
      transparent: true,
      depthWrite: false,
      opacity: BLOOMED_CONNECTION_OPACITY,
      // blending: this.THREE.CustomBlending,
      // blendEquation: this.THREE.AddEquation,
      // blendSrc: this.THREE.SrcAlphaFactor,
      // blendDst: this.THREE.DstAlphaFactor,
    });
    this.bloomedConnectionsMesh = new this.THREE.Line(
      this.bloomedConnectionsGeometry,
      bloomedLineMaterial
    );
    this.scene.add(this.bloomedConnectionsMesh);

    this.nonBloomedConnectionsGeometry = new this.THREE.BufferGeometry();
    const nonBloomedLineMaterial = new this.THREE.LineBasicMaterial({
      color: 0xa1fc03,
      transparent: true,
      opacity: 0.0,
    });
    this.nonBloomedConnectionsMesh = new this.THREE.Line(
      this.nonBloomedConnectionsGeometry,
      nonBloomedLineMaterial
    );
    this.scene.add(this.nonBloomedConnectionsMesh);

    const artistCount = allArtistData.length / 5;
    const artistPointsPositionsAttribute = new this.THREE.BufferAttribute(
      new Float32Array(artistCount * 3),
      3
    );
    artistPointsPositionsAttribute.needsUpdate = true;

    const allArtistDataU32 = new Uint32Array(allArtistData.buffer);
    for (let i = 0; i < artistCount; i++) {
      const artistID = allArtistDataU32[i * 5];
      this.artistDataByID.set(artistID, {
        pos: new THREE.Vector3(
          allArtistData[i * 5 + 1],
          allArtistData[i * 5 + 2],
          allArtistData[i * 5 + 3]
        ),
        popularity: allArtistDataU32[i * 5 + 4],
      });

      artistPointsPositionsAttribute.setXYZ(
        i * 4,
        allArtistData[i * 4 + 1],
        allArtistData[i * 4 + 2],
        allArtistData[i * 4 + 3]
      );
    }

    this.initBloomPass();

    this.musicManager = new MusicManager();

    dataFetchClient.registerCallbacks(
      (data) => this.handleArtistData(data),
      (data) => this.handleArtistRelationships(data)
    );

    this.animate();
  }

  // Adapted from:
  // https://github.com/mrdoob/three.js/blob/master/examples/webgl_postprocessing_unreal_bloom_selective.html
  private initBloomPass() {
    const renderScene = new this.THREE_EXTRA.RenderPass(this.scene, this.camera);

    this.bloomPass = new this.THREE_EXTRA.UnrealBloomPass(
      new this.THREE.Vector2(this.renderer.domElement.width, this.renderer.domElement.height),
      BLOOM_PARAMS.bloomStrength,
      BLOOM_PARAMS.bloomRadius,
      BLOOM_PARAMS.bloomThreshold
    );
    this.bloomPass.threshold = BLOOM_PARAMS.bloomThreshold;
    this.bloomPass.strength = BLOOM_PARAMS.bloomStrength;
    this.bloomPass.radius = BLOOM_PARAMS.bloomRadius;

    this.bloomComposer = new this.THREE_EXTRA.EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(this.bloomPass);

    const finalPass = new this.THREE_EXTRA.ShaderPass(
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

    this.finalComposer = new this.THREE_EXTRA.EffectComposer(this.renderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(finalPass);
  }

  private async handleArtistData(artistData: ArtistMapDataWithId[]) {
    const curPos = this.controls.getObject().position;
    wasmClient
      .handleReceivedArtistNames(
        new Uint32Array(artistData.map(({ id }) => id)),
        curPos.x,
        curPos.y,
        curPos.z
      )
      .then((drawCommands) => {
        if (drawCommands.length === 0) {
          return;
        }

        this.pendingDrawCommands.push(drawCommands);
      });
  }

  private async handleArtistRelationships(relationshipData: ArtistRelationshipData) {
    const artistIDs = new Uint32Array(relationshipData.artistIDs);
    const packedRelationshipData = new Uint8Array(relationshipData.res);

    const bytesToSkip = artistIDs.length + (artistIDs.length % 4);
    const u32Offset = bytesToSkip / 4;
    const allArtistIDs = new Uint32Array(packedRelationshipData.buffer).subarray(u32Offset);
    const artistIDsToRecursivelyRequest = [...new Set(allArtistIDs)].filter((id) =>
      this.artistDataByID.has(id)
    );

    wasmClient
      .handleArtistRelationshipData(
        Comlink.transfer(artistIDs, [artistIDs.buffer]),
        Comlink.transfer(packedRelationshipData, [packedRelationshipData.buffer])
      )
      .then((connectionsDataBuffer) => {
        this.bloomedConnectionsGeometry.setAttribute(
          'position',
          new this.THREE.BufferAttribute(connectionsDataBuffer, 3)
        );
        this.bloomedConnectionsGeometry.boundingSphere?.set(
          new this.THREE.Vector3(0, 0, 0),
          1_000_000_000
        );
      });

    // Recursively fetch artist IDs to grow the graph
    if (artistIDsToRecursivelyRequest.length > 0) {
      dataFetchClient.fetchArtistRelationships(artistIDsToRecursivelyRequest);
    }
  }

  public renderArtists(artistsToRender: number[]) {
    // Skip artists that are already rendered
    const newArtistCount = artistsToRender.filter(
      (id) => id !== null && id !== undefined && !this.renderedArtistBufferIndicesByArtistID.has(id)
    ).length;

    const startIx = this.artistMeshes.count;
    this.artistMeshes.count = startIx + newArtistCount;
    if (this.artistMeshes.instanceColor) {
      this.artistMeshes.instanceColor.count = startIx + newArtistCount;
    }

    const matrix = new this.THREE.Matrix4();

    let newRenderedArtistCount = 0;
    artistsToRender.forEach((id) => {
      const artistData = this.artistDataByID.get(id);
      if (!artistData) {
        throw new UnreachableException(`Artist ${id} has no pos`);
      }

      const isHighlighted = this.highlightedArtistIDs.has(id);
      const isPlaying = this.musicManager.curPlaying?.artistID === id;
      const size = getArtistSize(artistData.popularity, isHighlighted, isPlaying);
      matrix.makeScale(size, size, size);
      matrix.setPosition(artistData.pos);

      const existingBufferIndex = this.renderedArtistBufferIndicesByArtistID.get(id);
      const bufferIndex = existingBufferIndex ?? startIx + newRenderedArtistCount;
      if (existingBufferIndex === undefined) {
        newRenderedArtistCount += 1;
      }

      this.artistMeshes.setMatrixAt(bufferIndex, matrix);
      const color = new this.THREE.Color(getArtistColor(isHighlighted, isPlaying));
      this.artistMeshes.setColorAt(bufferIndex, color);

      this.renderedArtistBufferIndicesByArtistID.set(id, bufferIndex);
      this.artistIDByRenderedArtistBufferIndex.set(bufferIndex, id);
    });

    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceColor!.needsUpdate = true;
  }

  public removeArtists(artistInternalIDs: number[]) {
    const artistsToRemove = artistInternalIDs.filter((id) =>
      this.renderedArtistBufferIndicesByArtistID.has(id)
    );

    const matrix = new this.THREE.Matrix4();
    const color = new this.THREE.Color();
    artistsToRemove.forEach((id) => {
      const targetBufferIndex = this.renderedArtistBufferIndicesByArtistID.get(id);
      const idOfLastArtist = this.artistIDByRenderedArtistBufferIndex.get(
        this.artistMeshes.count - 1
      );
      if (
        targetBufferIndex === null ||
        targetBufferIndex === undefined ||
        idOfLastArtist === null ||
        idOfLastArtist === undefined
      ) {
        throw new UnreachableException();
      }

      this.renderedArtistBufferIndicesByArtistID.delete(id);
      this.artistIDByRenderedArtistBufferIndex.delete(targetBufferIndex);

      if (idOfLastArtist !== id) {
        // Swap the last element into the position of the one that's being removed
        this.artistMeshes.getMatrixAt(this.artistMeshes.count - 1, matrix);
        this.artistMeshes.setMatrixAt(targetBufferIndex, matrix);
        this.artistMeshes.getColorAt(this.artistMeshes.count - 1, color);
        this.artistMeshes.setColorAt(targetBufferIndex, color);
        this.artistIDByRenderedArtistBufferIndex.set(targetBufferIndex, idOfLastArtist);
        this.renderedArtistBufferIndicesByArtistID.set(idOfLastArtist, targetBufferIndex);
      }

      this.artistMeshes.count -= 1;
    });

    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceColor!.needsUpdate = true;
  }

  private darkenNonBloomed() {
    (this.nonBloomedConnectionsMesh.material as THREE.LineBasicMaterial).color.set(0);
  }

  private restoreNonBloomed() {
    (this.nonBloomedConnectionsMesh
      .material as THREE.LineBasicMaterial).color = new this.THREE.Color(0xa1fc03);
    (this.nonBloomedConnectionsMesh.material as THREE.LineBasicMaterial).needsUpdate = true;
    (this.bloomedConnectionsMesh
      .material as THREE.LineBasicMaterial).color = this.getConnectionColor();
    (this.bloomedConnectionsMesh.material as THREE.LineBasicMaterial).needsUpdate = true;
  }

  private getConnectionColor(): THREE.Color {
    // if (!this.chroma || !this.connectionColorScale) {
    return new this.THREE.Color(BASE_CONNECTION_COLOR);
    // }

    const partial = this.timeElapsed / 20;
    const [r, g, b] = this.connectionColorScale(partial - Math.floor(partial)).gl();
    return new this.THREE.Color(r, g, b);
  }

  private maybeAnimatePlayingArtist() {
    if (!this.playingArtistGeometry) {
      return;
    }

    const gain = this.musicManager.getCurPlayingMusicVolume();
    if (!Number.isFinite(gain)) {
      throw new UnreachableException('Bad gain returned from music manager: ' + gain);
    }
    const scale = Math.pow(2, gain * 12.4);
    // Low-pass filter the scale to avoid it flickering
    this.playingArtistScale = this.playingArtistScale * 0.7 + scale * 0.3;
    const newMatrix = new this.THREE.Matrix4();
    const pos = this.playingArtistGeometry.position.clone();
    newMatrix.makeScale(this.playingArtistScale, this.playingArtistScale, this.playingArtistScale);
    newMatrix.setPosition(pos);
    this.playingArtistGeometry.matrix.copy(newMatrix);
  }

  private render(forward: number) {
    if (
      this.secondSinceLastPositionUpdate > SECONDS_BETWEEN_POSITION_UPDATES &&
      !this.wasmPositionHandlerIsRunning
    ) {
      this.secondSinceLastPositionUpdate = 0;
      this.wasmPositionHandlerIsRunning = true;

      const curPos = this.controls.getObject().position;
      const projectedNextPos = this.controls.getObject().position.clone();
      projectedNextPos.add(
        this.controls
          .getDirection(VEC3_IDENTITY)
          .clone()
          .multiplyScalar(
            MOVEMENT_SPEED_UNITS_PER_SECOND *
              0.15 *
              (this.movementInputHandler.isSpeedBoosted() ? SHIFT_SPEED_MULTIPLIER : 1) *
              forward
          )
      );

      wasmClient
        .handleNewPosition(
          curPos.x,
          curPos.y,
          curPos.z,
          projectedNextPos.x,
          projectedNextPos.y,
          projectedNextPos.z
        )
        .then((commands) => {
          this.wasmPositionHandlerIsRunning = false;
          if (commands.length === 0) {
            return;
          }
          this.pendingDrawCommands.push(commands);
        });
    }

    const cameraDirection = this.camera.getWorldDirection(new this.THREE.Vector3());
    const cameraUp = this.camera.up;
    this.musicManager.setListenerPosition(
      this.controls.getObject().position,
      cameraDirection,
      cameraUp
    );

    this.maybeAnimatePlayingArtist();

    this.darkenNonBloomed();
    this.bloomComposer.render();
    this.restoreNonBloomed();
    this.finalComposer.render();
  }

  private removePlayingArtistGeometry(artistID: number) {
    if (!this.playingArtistGeometry) {
      // Trigger the old geometry to come back to normal size
      this.renderArtists([artistID]);
      return;
    }

    this.scene.remove(this.playingArtistGeometry);
    this.playingArtistGeometry = null;

    // Trigger the old geometry to come back to normal size
    this.renderArtists([artistID]);
  }

  private createPlayingArtistGeometry(artistID: number) {
    if (this.playingArtistGeometry) {
      console.error('A playing artist geometry already exists');
      this.scene.remove(this.playingArtistGeometry);
    }

    const artistData = this.artistDataByID.get(artistID)!;
    if (!artistData) {
      throw new UnreachableException(`Missing data for artist id=${artistID}`);
    }
    const size = getArtistSize(artistData.popularity, true, false) * 1.3;
    const geometry = new this.THREE.IcosahedronGeometry(size, ARTIST_GEOMETRY_DETAIL + 2);
    const material = new this.THREE.MeshPhongMaterial({
      color: new this.THREE.Color(PLAYING_ARTIST_COLOR),
      opacity: 0.7,
      transparent: true,
    });
    this.playingArtistGeometry = new this.THREE.Mesh(geometry, material);
    this.playingArtistGeometry.position.copy(artistData.pos);
    this.playingArtistGeometry.matrixAutoUpdate = false;
    this.scene.add(this.playingArtistGeometry);

    // Trigger the old geometry to have a very tiny size
    this.renderArtists([artistID]);
  }

  private processDrawCommands(commands: Uint32Array) {
    if (commands.length % 2 !== 0) {
      throw new UnreachableException('Invalid command count');
    }

    const cmdCount = commands.length / 2;

    const artistIDsToRender = [];
    const artistIDsToRemove = [];
    const artistIDsToFetch = [];

    for (let i = 0; i < cmdCount; i++) {
      const command = commands[i * 2] as DrawCommand;
      const artistID = commands[i * 2 + 1];

      switch (command) {
        case DrawCommand.AddLabel: {
          const label = dataFetchClient.fetchedArtistDataByID.get(artistID);
          if (label === 'FETCHING' || label === undefined) {
            throw new UnreachableException('Must have fetched label by now');
          } else if (label === null) {
            console.log('Missing artist name for id=', artistID);
            // Spotify API must have missing data for this artist
            break;
          }

          const artistData = this.artistDataByID.get(artistID);
          if (!artistData) {
            throw new UnreachableException(`Missing data for artist id=${artistID}`);
          }

          const nameData = dataFetchClient.fetchedArtistDataByID.get(artistID);
          if (!nameData || nameData === 'FETCHING') {
            throw new UnreachableException('Must have fetched name by now');
          }

          this.eventRegistry.createLabel(artistID, nameData.name);
          this.forceLabelsUpdate = true;

          break;
        }
        case DrawCommand.RemoveLabel: {
          this.eventRegistry.deleteLabel(artistID);

          break;
        }
        case DrawCommand.AddArtistGeometry: {
          artistIDsToRender.push(artistID);
          break;
        }
        case DrawCommand.RemoveArtistGeometry: {
          artistIDsToRemove.push(artistID);
          break;
        }
        case DrawCommand.FetchArtistLabel: {
          artistIDsToFetch.push(artistID);
          break;
        }
        case DrawCommand.StartPlayingMusic: {
          const artistPos = this.artistDataByID.get(artistID)!.pos;
          const onEnded = () => {
            this.removePlayingArtistGeometry(artistID);

            wasmClient
              .onMusicFinishedPlaying(artistID, [artistPos.x, artistPos.y, artistPos.z])
              .then((commands) => {
                this.pendingDrawCommands.push(commands);
              });
          };

          this.musicManager.startPlaying(artistID, artistPos, onEnded).then(() => {
            const isActuallyPlaying = this.musicManager.curPlaying?.artistID === artistID;
            if (!isActuallyPlaying) {
              return;
            }

            this.eventRegistry.curPlaying = artistID;

            // Playing has actually started; color the artist to indicate that it's playing
            this.createPlayingArtistGeometry(artistID);
          });
          break;
        }
        case DrawCommand.StopPlayingMusic: {
          this.eventRegistry.curPlaying = null;
          this.musicManager.stopPlaying(artistID);
          this.removePlayingArtistGeometry(artistID);
          break;
        }
        default: {
          throw new UnreachableException();
        }
      }
    }

    if (artistIDsToRemove.length > 0) {
      this.removeArtists(artistIDsToRemove);
    }

    if (artistIDsToRender.length > 0) {
      this.renderArtists(artistIDsToRender);
    }

    if (artistIDsToFetch.length > 0) {
      dataFetchClient.getOrFetchArtistData(artistIDsToFetch);
    }

    this.eventRegistry.flush();
  }

  private animate() {
    this.pendingDrawCommands.forEach((commands) => this.processDrawCommands(commands));
    this.pendingDrawCommands = [];

    if (this.cameraOverrides.direction) {
      const cameraDirection = this.camera.getWorldDirection(new this.THREE.Vector3());
      const targetDirection = this.cameraOverrides.direction.target
        .clone()
        .sub(this.camera.position.clone())
        .normalize();
      const pivotCoefficient = this.cameraOverrides.direction.pivotCoefficient;
      const newLookDirection = new this.THREE.Vector3(
        cameraDirection.x * pivotCoefficient + targetDirection.x * (1 - pivotCoefficient),
        cameraDirection.y * pivotCoefficient + targetDirection.y * (1 - pivotCoefficient),
        cameraDirection.z * pivotCoefficient + targetDirection.z * (1 - pivotCoefficient)
      );
      this.camera.lookAt(this.camera.position.clone().add(newLookDirection));

      // If we're close enough to the target and not currently flying, stop overriding the camera
      if (!this.cameraOverrides.movement) {
        const totalDiff = newLookDirection.distanceTo(targetDirection);
        if (totalDiff < CAMERA_OVERRIDE_TARGET_TOLERANCE) {
          this.cameraOverrides.direction = null;
        }
      }
    }
    if (this.cameraOverrides.movement) {
      const curTime = new Date().getTime();
      const progress =
        (curTime - this.cameraOverrides.movement.startTime) /
        this.cameraOverrides.movement.flightDurationMs;
      if (progress >= 1) {
        console.log('Camera movement finished');
        this.cameraOverrides.movement = null;
        // this.cameraOverrides.direction = null;
      } else {
        const newPos = this.cameraOverrides.movement.path.getPoint(progress);
        const endPoint = this.cameraOverrides.movement.path.getPoint(1);
        if (newPos.distanceTo(endPoint) > 960) {
          this.camera.position.set(newPos.x, newPos.y, newPos.z);
        }
      }
    }

    const timeDelta = this.clock.getDelta();
    this.timeElapsed += timeDelta;
    this.secondSinceLastPositionUpdate += timeDelta;

    const { forward, sideways, up } = this.movementInputHandler.getDirectionVector();
    this.controls.moveRight(sideways * MOVEMENT_SPEED_UNITS_PER_SECOND * timeDelta);
    this.controls
      .getObject()
      .position.add(
        this.controls
          .getDirection(VEC3_IDENTITY)
          .clone()
          .multiplyScalar(MOVEMENT_SPEED_UNITS_PER_SECOND * timeDelta * forward)
      )
      .add(this.camera.up.clone().multiplyScalar(MOVEMENT_SPEED_UNITS_PER_SECOND * timeDelta * up));

    this.render(forward);

    requestAnimationFrame(() => this.animate());
  }
}
