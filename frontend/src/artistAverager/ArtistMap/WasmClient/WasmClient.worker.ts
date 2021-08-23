import * as Comlink from 'comlink';

const engineModule = import('./engine');

export class WasmClient {
  private engine: typeof import('./engine');
  private ctxPtr: number;

  constructor(engine: typeof import('./engine')) {
    this.engine = engine;
    this.ctxPtr = engine.create_artist_map_ctx();
  }

  /**
   * Returns the total number of artists in the embedding
   */
  public decodeAndRecordPackedArtistPositions(packed: Uint8Array): number {
    return this.engine.decode_and_record_packed_artist_positions(this.ctxPtr, packed);
  }

  public getAllArtistData(): Float32Array {
    return this.engine.get_all_artist_data(this.ctxPtr);
  }

  public ping() {
    return true;
  }

  /**
   * Returns set of draw commands to execute
   */
  public handleNewPosition(x: number, y: number, z: number) {
    return this.engine.handle_new_position(this.ctxPtr, x, y, z);
  }

  /**
   * Returns set of draw commands to execute
   */
  public handleReceivedArtistNames(
    artistIDs: Uint32Array,
    curX: number,
    curY: number,
    curZ: number
  ) {
    return this.engine.handle_received_artist_names(this.ctxPtr, artistIDs, curX, curY, curZ);
  }
}

const init = async () => {
  const engine = await engineModule;
  Comlink.expose(new WasmClient(engine));
};

init();
