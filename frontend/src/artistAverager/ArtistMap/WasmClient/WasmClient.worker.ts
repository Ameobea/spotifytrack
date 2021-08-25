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
    const allArtistData = this.engine.get_all_artist_data(this.ctxPtr);
    return Comlink.transfer(allArtistData, [allArtistData.buffer]);
  }

  public ping() {
    return true;
  }

  /**
   * Returns set of draw commands to execute
   */
  public handleNewPosition(x: number, y: number, z: number) {
    const drawCommands = this.engine.handle_new_position(this.ctxPtr, x, y, z);
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
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
    const drawCommands = this.engine.handle_received_artist_names(
      this.ctxPtr,
      artistIDs,
      curX,
      curY,
      curZ
    );
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  /**
   * Returns set of draw commands to execute
   */
  public onMusicFinishedPlaying(artistID: number, [curX, curY, curZ]: [number, number, number]) {
    const drawCommands = this.engine.on_music_finished_playing(
      this.ctxPtr,
      artistID,
      curX,
      curY,
      curZ
    );
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  /**
   * Returns the new connection data buffer to be rendered
   */
  public handleArtistRelationshipData(
    artistIDs: Uint32Array,
    relationshipData: Uint8Array
  ): Float32Array {
    const connectionData = this.engine.handle_artist_relationship_data(
      this.ctxPtr,
      artistIDs,
      relationshipData
    );
    return Comlink.transfer(connectionData, [connectionData.buffer]);
  }
}

const init = async () => {
  const engine = await engineModule;
  Comlink.expose(new WasmClient(engine));
};

init();
