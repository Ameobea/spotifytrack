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
    console.log('decode');
    return this.engine.decode_and_record_packed_artist_positions(this.ctxPtr, packed);
  }

  public getArtistPositions(artistIDs: Uint32Array): Float32Array {
    return this.engine.get_artist_positions(this.ctxPtr, artistIDs);
  }

  public getAllArtistPositions(): Float32Array {
    return this.engine.get_all_artist_positions(this.ctxPtr);
  }

  public ping() {
    return true;
  }
}

const init = async () => {
  const engine = await engineModule;
  Comlink.expose(new WasmClient(engine));
};

init();
